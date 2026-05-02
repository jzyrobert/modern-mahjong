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
  /** Server time when the seat's owner disconnected, or null if connected/empty. */
  disconnectedSinceMs: number | null;
  /**
   * True iff `bot` was installed automatically by `detachConnection` (vs.
   * placed deliberately via `seatBot`). Auto-installed bots act as a
   * stand-in until reconnect or grace-expiry; an intentionally-seated bot
   * is permanent for the match.
   */
  botAutoInstalled: boolean;
}

const HOST_ONLY_ACTIONS: ReadonlySet<Action['t']> = new Set(['startHand', 'setRules']);

export type Outbound =
  | { kind: 'sendTo'; connectionId: string; msg: ServerMessage }
  | { kind: 'broadcast'; msg: ServerMessage }
  | { kind: 'closeConnection'; connectionId: string }
  | { kind: 'scheduleAlarm'; deadlineMs: number };

const BOT_TICK_LIMIT = 16;

export interface MatchSessionOptions {
  /**
   * How long a seat is held for its owner after they drop. After this
   * elapses without a reconnect the seat is freed (the auto-bot keeps
   * playing) so a new player can take it. Default 60s.
   */
  reconnectGraceMs?: number;
}

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
    0: emptySeat(),
    1: emptySeat(),
    2: emptySeat(),
    3: emptySeat(),
  };
  private readonly reconnectGraceMs: number;
  /**
   * The deadline currently armed via `scheduleAlarm`, or null if no
   * alarm is set. Cached so we don't re-emit the same `scheduleAlarm`
   * outbound on every action when nothing about the deadline changed.
   */
  private lastEmittedDeadline: number | null = null;

  constructor(opts: MatchSessionOptions = {}) {
    this.reconnectGraceMs = opts.reconnectGraceMs ?? 60_000;
  }

  getState(): GameState {
    return this.state;
  }

  /** Test/seeding helper: place a bot in a specific seat. */
  seatBot(seat: Seat, bot: Bot, displayName?: string): void {
    this.seats[seat] = {
      ...emptySeat(),
      displayName: displayName ?? botDisplayName(bot),
      bot,
    };
  }

  applyClientMessage(connectionId: string, raw: unknown): Outbound[] {
    const r = parseClientMessage(raw);
    if (!r.ok) return [errMsg(connectionId, 'SCHEMA', r.error)];
    return this.handle(connectionId, r.msg);
  }

  detachConnection(connectionId: string, nowMs: number = Date.now()): Outbound[] {
    let changed = false;
    for (const seat of SEATS) {
      const slot = this.seats[seat];
      if (slot.connectionId === connectionId) {
        slot.connectionId = null;
        if (slot.playerId !== null && slot.bot === null) {
          slot.bot = passiveBot;
          slot.botAutoInstalled = true;
          slot.disconnectedSinceMs = nowMs;
        }
        changed = true;
      }
    }
    if (!changed) return [];
    const out: Outbound[] = [this.lobbyBroadcast()];
    out.push(...this.runBots());
    out.push(...this.maybeScheduleAlarm());
    return out;
  }

  fireAlarm(nowMs: number): Outbound[] {
    const out: Outbound[] = [];
    out.push(...this.expireGraceTimers(nowMs));
    // resolveClaims is idempotent — the engine no-ops if we're not in
    // awaitingClaims, otherwise pads missing seats with 'pass' and resolves.
    if (this.state.phase === 'awaitingClaims') {
      try {
        out.push(this.apply({ t: 'resolveClaims', nowMs }));
        out.push(...this.runBots());
      } catch (e) {
        console.error('alarm reduce error', e);
      }
    }
    out.push(...this.maybeScheduleAlarm());
    return out;
  }

  private expireGraceTimers(nowMs: number): Outbound[] {
    let evicted = false;
    for (const seat of SEATS) {
      const slot = this.seats[seat];
      if (slot.disconnectedSinceMs === null) continue;
      if (nowMs - slot.disconnectedSinceMs < this.reconnectGraceMs) continue;
      const wasHost = slot.playerId !== null && slot.playerId === this.hostPlayerId;
      slot.playerId = null;
      slot.displayName = slot.bot ? botDisplayName(slot.bot) : null;
      slot.disconnectedSinceMs = null;
      if (wasHost) this.hostPlayerId = this.firstConnectedPlayerId();
      evicted = true;
    }
    return evicted ? [this.lobbyBroadcast()] : [];
  }

  private firstConnectedPlayerId(): string | null {
    for (const seat of SEATS) {
      const slot = this.seats[seat];
      if (slot.playerId !== null && slot.connectionId !== null) return slot.playerId;
    }
    return null;
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
      ...emptySeat(),
      playerId: msg.playerId,
      displayName: msg.displayName,
      connectionId,
    };
    if (this.hostPlayerId === null) this.hostPlayerId = msg.playerId;

    const out: Outbound[] = [
      { kind: 'sendTo', connectionId, msg: { t: 'state', state: this.state, you: seat } },
      this.lobbyBroadcast(),
    ];
    out.push(...this.maybeScheduleAlarm());
    return out;
  }

  private findOrAssignSeat(playerId: string): Seat | null {
    for (const s of SEATS) {
      if (this.seats[s].playerId === playerId) return s;
    }
    for (const s of SEATS) {
      if (this.seats[s].playerId === null && this.seats[s].bot === null) return s;
    }
    for (const s of SEATS) {
      if (this.seats[s].playerId === null && this.seats[s].botAutoInstalled) return s;
    }
    return null;
  }

  private onAction(connectionId: string, action: Action): Outbound[] {
    if (HOST_ONLY_ACTIONS.has(action.t)) {
      const sender = this.playerIdFor(connectionId);
      if (sender === null || sender !== this.hostPlayerId) {
        return [errMsg(connectionId, 'HOST', 'only the host can perform this action')];
      }
    }
    try {
      const out: Outbound[] = [this.apply(action)];
      out.push(...this.runBots());
      out.push(...this.maybeScheduleAlarm());
      return out;
    } catch (e) {
      if (e instanceof IllegalActionError) {
        return [errMsg(connectionId, e.code, e.message)];
      }
      return [errMsg(connectionId, 'INTERNAL', String(e))];
    }
  }

  private playerIdFor(connectionId: string): string | null {
    for (const s of SEATS) {
      if (this.seats[s].connectionId === connectionId) return this.seats[s].playerId;
    }
    return null;
  }

  /** Apply an action through the engine and return its broadcast event. Mutates `this.state`. */
  private apply(action: Action): Outbound {
    const { state: next, events } = reduce(this.state, action);
    this.state = next;
    return this.deltaBroadcast(events);
  }

  /**
   * Compute the soonest deadline across active timers (claim window +
   * each disconnected seat's grace expiry) and emit a `scheduleAlarm`
   * for it. Cloudflare DOs only support one scheduled alarm at a time,
   * so we always re-arm to the earliest pending deadline. Skips emission
   * when the deadline matches what's already armed — keeps the
   * MatchRoom's per-action dispatch quiet during steady-state play.
   */
  private maybeScheduleAlarm(): Outbound[] {
    let soonest: number | null = null;
    if (this.state.phase === 'awaitingClaims' && this.state.pendingClaims) {
      soonest = this.state.pendingClaims.deadlineMs;
    }
    for (const seat of SEATS) {
      const slot = this.seats[seat];
      if (slot.disconnectedSinceMs === null) continue;
      const deadline = slot.disconnectedSinceMs + this.reconnectGraceMs;
      if (soonest === null || deadline < soonest) soonest = deadline;
    }
    if (soonest === this.lastEmittedDeadline) return [];
    this.lastEmittedDeadline = soonest;
    return soonest !== null ? [{ kind: 'scheduleAlarm', deadlineMs: soonest }] : [];
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
        displayName: slot.displayName ?? (slot.bot ? botDisplayName(slot.bot) : `Seat ${seat}`),
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

function emptySeat(): SeatState {
  return {
    playerId: null,
    displayName: null,
    bot: null,
    connectionId: null,
    disconnectedSinceMs: null,
    botAutoInstalled: false,
  };
}

function botDisplayName(bot: Bot): string {
  return `Bot (${bot.kind})`;
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
