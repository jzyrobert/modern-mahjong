import { type Bot, heuristicBot, passiveBot, simpleBot } from '@mahjong/bots';
import {
  type Action,
  DEFAULT_RULES,
  type Event,
  type GameState,
  IllegalActionError,
  SEATS,
  type Seat,
  emptyState,
  reduce,
} from '@mahjong/game-logic';
import {
  type ClientMessage,
  type PublicPlayer,
  type ServerMessage,
  parseClientMessage,
} from '@mahjong/protocol';

interface SeatState {
  playerId: string | null;
  displayName: string | null;
  bot: Bot | null;
  /** Connection ID of the currently-attached client, if any. */
  connectionId: string | null;
}

export type Outbound =
  | { kind: 'sendTo'; connectionId: string; msg: ServerMessage }
  | { kind: 'broadcast'; msg: ServerMessage }
  | { kind: 'closeConnection'; connectionId: string }
  | { kind: 'scheduleAlarm'; deadlineMs: number };

const BOT_TICK_LIMIT = 16;

/**
 * Authoritative match logic, decoupled from the partyserver runtime so it
 * can be unit-tested directly. Every public method returns an `Outbound[]`
 * the caller is expected to dispatch (send to a specific connection,
 * broadcast, close a connection, or arm a scheduler alarm).
 */
export class MatchSession {
  private state: GameState = emptyState(DEFAULT_RULES);
  private hostPlayerId: string | null = null;
  private seats: Record<Seat, SeatState> = {
    0: { playerId: null, displayName: null, bot: null, connectionId: null },
    1: { playerId: null, displayName: null, bot: null, connectionId: null },
    2: { playerId: null, displayName: null, bot: null, connectionId: null },
    3: { playerId: null, displayName: null, bot: null, connectionId: null },
  };

  getState(): GameState {
    return this.state;
  }

  /** Test/seeding helper: place a bot in a specific seat. */
  seatBot(seat: Seat, bot: Bot, displayName?: string): void {
    this.seats[seat] = {
      playerId: null,
      displayName: displayName ?? `Bot (${bot.kind})`,
      bot,
      connectionId: null,
    };
  }

  applyClientMessage(connectionId: string, raw: unknown): Outbound[] {
    const r = parseClientMessage(raw);
    if (!r.ok) return [errMsg(connectionId, 'SCHEMA', r.error)];
    return this.handle(connectionId, r.msg);
  }

  detachConnection(connectionId: string): Outbound[] {
    let changed = false;
    for (const seat of SEATS) {
      if (this.seats[seat].connectionId === connectionId) {
        this.seats[seat].connectionId = null;
        changed = true;
      }
    }
    return changed ? [this.lobbyBroadcast()] : [];
  }

  fireAlarm(nowMs: number): Outbound[] {
    if (this.state.phase !== 'awaitingClaims') return [];
    try {
      const out: Outbound[] = [this.apply({ t: 'resolveClaims', nowMs })];
      out.push(...this.runBots());
      return out;
    } catch (e) {
      console.error('alarm reduce error', e);
      return [];
    }
  }

  private handle(connectionId: string, msg: ClientMessage): Outbound[] {
    switch (msg.t) {
      case 'hello':
        return this.onHello(connectionId, msg);
      case 'action':
        return this.onAction(connectionId, msg.action);
      case 'chat':
        return [];
      case 'leave':
        return [{ kind: 'closeConnection', connectionId }];
    }
  }

  private onHello(
    connectionId: string,
    msg: { playerId: string; displayName: string; matchCode: string },
  ): Outbound[] {
    const seat = this.findOrAssignSeat(msg.playerId);
    if (seat === null) {
      return [
        errMsg(connectionId, 'FULL', 'room is full'),
        { kind: 'closeConnection', connectionId },
      ];
    }
    this.seats[seat] = {
      playerId: msg.playerId,
      displayName: msg.displayName,
      bot: null,
      connectionId,
    };
    if (this.hostPlayerId === null) this.hostPlayerId = msg.playerId;

    return [
      { kind: 'sendTo', connectionId, msg: { t: 'state', state: this.state, you: seat } },
      this.lobbyBroadcast(),
    ];
  }

  private findOrAssignSeat(playerId: string): Seat | null {
    for (const s of SEATS) {
      if (this.seats[s].playerId === playerId) return s;
    }
    for (const s of SEATS) {
      if (this.seats[s].playerId === null && this.seats[s].bot === null) return s;
    }
    return null;
  }

  private onAction(connectionId: string, action: Action): Outbound[] {
    try {
      const out: Outbound[] = [this.apply(action), ...this.maybeScheduleClaimAlarm()];
      out.push(...this.runBots());
      return out;
    } catch (e) {
      if (e instanceof IllegalActionError) {
        return [errMsg(connectionId, e.code, e.message)];
      }
      return [errMsg(connectionId, 'INTERNAL', String(e))];
    }
  }

  /** Apply an action through the engine and return its broadcast event. Mutates `this.state`. */
  private apply(action: Action): Outbound {
    const { state: next, events } = reduce(this.state, action);
    this.state = next;
    return this.deltaBroadcast(events);
  }

  private maybeScheduleClaimAlarm(): Outbound[] {
    if (this.state.phase === 'awaitingClaims' && this.state.pendingClaims) {
      return [{ kind: 'scheduleAlarm', deadlineMs: this.state.pendingClaims.deadlineMs }];
    }
    return [];
  }

  private runBots(): Outbound[] {
    const out: Outbound[] = [];
    for (let i = 0; i < BOT_TICK_LIMIT; i++) {
      const tick = this.tickBotsOnce();
      if (tick.length === 0) break;
      out.push(...tick);
    }
    return out;
  }

  private tickBotsOnce(): Outbound[] {
    const out: Outbound[] = [];
    if (this.state.phase === 'awaitingClaims' && this.state.pendingClaims) {
      const pending = this.state.pendingClaims;
      for (const seat of SEATS) {
        if (seat === this.state.lastDiscard?.from) continue;
        const slot = this.seats[seat];
        if (!slot.bot) continue;
        if (pending.submitted[seat]) continue;
        const claim = slot.bot.pickClaim({ state: this.state, seat });
        out.push(this.apply({ t: 'declareClaim', seat, claim }));
      }
      return out;
    }
    if (this.state.phase === 'turn') {
      const seat = this.state.turn;
      const slot = this.seats[seat];
      if (!slot.bot) return out;
      if (!this.state.hasDrawn) {
        out.push(this.apply({ t: 'draw', seat }));
        if (this.state.phase !== 'turn') return out;
      }
      try {
        out.push(this.apply({ t: 'declareWin', seat, selfDraw: true }));
        return out;
      } catch (e) {
        if (!(e instanceof IllegalActionError)) throw e;
      }
      const tile = slot.bot.pickDiscard({ state: this.state, seat });
      out.push(this.apply({ t: 'discard', seat, tile }));
      out.push(...this.maybeScheduleClaimAlarm());
      return out;
    }
    return out;
  }

  private deltaBroadcast(events: Event[]): Outbound {
    return { kind: 'broadcast', msg: { t: 'delta', events, state: this.state } };
  }

  private lobbyBroadcast(): Outbound {
    const players: PublicPlayer[] = SEATS.map((seat) => {
      const slot = this.seats[seat];
      return {
        playerId: slot.playerId ?? `bot-${seat}`,
        displayName: slot.displayName ?? (slot.bot ? `Bot (${slot.bot.kind})` : `Seat ${seat}`),
        seat,
        connected: slot.connectionId !== null,
        isBot: slot.bot !== null,
      };
    });
    return {
      kind: 'broadcast',
      msg: { t: 'lobby', players, host: this.hostPlayerId, rules: this.state.rules },
    };
  }
}

function errMsg(connectionId: string, code: string, detail?: string): Outbound {
  const msg: ServerMessage =
    detail !== undefined ? { t: 'error', code, detail } : { t: 'error', code };
  return { kind: 'sendTo', connectionId, msg };
}

export function botByKind(kind: 'simple' | 'heuristic' | 'passive'): Bot {
  switch (kind) {
    case 'simple':
      return simpleBot;
    case 'heuristic':
      return heuristicBot;
    case 'passive':
      return passiveBot;
  }
}
