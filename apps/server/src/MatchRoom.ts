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
import { type Connection, type ConnectionContext, Server, type WSMessage } from 'partyserver';

interface SeatState {
  playerId: string | null;
  displayName: string | null;
  bot: Bot | null;
  /** Connection ID of the currently-attached client, if any. */
  connectionId: string | null;
}

interface RoomMeta {
  hostPlayerId: string | null;
  seats: Record<Seat, SeatState>;
}

/**
 * Authoritative match room. One Durable Object per match code. Owns the
 * GameState and serializes all action processing through its single-threaded
 * event loop. All claim-window timers run via the DO `alarm()` mechanism so
 * we don't need wall-clock JS timers (which die on hibernation).
 */
export class MatchRoom extends Server {
  static override options = { hibernate: true };

  private state: GameState = emptyState(DEFAULT_RULES);
  private meta: RoomMeta = {
    hostPlayerId: null,
    seats: {
      0: { playerId: null, displayName: null, bot: null, connectionId: null },
      1: { playerId: null, displayName: null, bot: null, connectionId: null },
      2: { playerId: null, displayName: null, bot: null, connectionId: null },
      3: { playerId: null, displayName: null, bot: null, connectionId: null },
    },
  };

  override onStart(): void {
    // Hydrate from durable storage if available — kept simple for the scaffold.
  }

  override onConnect(conn: Connection, ctx: ConnectionContext): void | Promise<void> {
    void ctx;
    // Wait for the client's `hello` to assign a seat / restore an existing one.
    conn.send(JSON.stringify({ t: 'pong' } satisfies ServerMessage));
  }

  override onMessage(conn: Connection, raw: WSMessage): void | Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      this.sendErr(conn, 'PARSE', 'invalid JSON');
      return;
    }
    const r = parseClientMessage(parsed);
    if (!r.ok) {
      this.sendErr(conn, 'SCHEMA', r.error);
      return;
    }
    this.handle(conn, r.msg);
  }

  override onClose(conn: Connection): void | Promise<void> {
    for (const seat of SEATS) {
      if (this.meta.seats[seat].connectionId === conn.id) {
        this.meta.seats[seat].connectionId = null;
        // Disconnect grace handled at a higher level; the lobby reflects it via `connected: false`.
      }
    }
    this.broadcastLobby();
  }

  // ---- protocol handling ------------------------------------------------

  private handle(conn: Connection, msg: ClientMessage): void {
    switch (msg.t) {
      case 'hello':
        this.onHello(conn, msg);
        break;
      case 'action':
        this.onAction(conn, msg.action as Action);
        break;
      case 'chat':
        // No-op stub for v0; would broadcast to other connections in the room.
        break;
      case 'leave':
        conn.close();
        break;
    }
  }

  private onHello(
    conn: Connection,
    msg: { playerId: string; displayName: string; matchCode: string },
  ): void {
    // Reattach existing seat if same playerId.
    let seat: Seat | null = null;
    for (const s of SEATS) {
      if (this.meta.seats[s].playerId === msg.playerId) {
        seat = s;
        break;
      }
    }
    if (seat === null) {
      // Assign first empty seat.
      for (const s of SEATS) {
        if (this.meta.seats[s].playerId === null && this.meta.seats[s].bot === null) {
          seat = s;
          break;
        }
      }
    }
    if (seat === null) {
      this.sendErr(conn, 'FULL', 'room is full');
      conn.close();
      return;
    }

    this.meta.seats[seat].playerId = msg.playerId;
    this.meta.seats[seat].displayName = msg.displayName;
    this.meta.seats[seat].bot = null;
    this.meta.seats[seat].connectionId = conn.id;
    if (this.meta.hostPlayerId === null) this.meta.hostPlayerId = msg.playerId;

    this.send(conn, { t: 'state', state: this.state, you: seat });
    this.broadcastLobby();
  }

  private onAction(conn: Connection, action: Action): void {
    try {
      const { state: next, events } = reduce(this.state, action);
      this.state = next;
      this.broadcastDelta(events);
      // If we just opened a claim window, schedule the deadline alarm.
      if (this.state.phase === 'awaitingClaims' && this.state.pendingClaims) {
        this.scheduleAlarm(this.state.pendingClaims.deadlineMs);
      }
      // Drive bots forward if they own the next decision.
      void this.maybeRunBots();
    } catch (e) {
      if (e instanceof IllegalActionError) {
        this.sendErr(conn, e.code, e.message);
      } else {
        this.sendErr(conn, 'INTERNAL', String(e));
      }
    }
  }

  override async alarm(): Promise<void> {
    // Claim-window deadline reached.
    if (this.state.phase === 'awaitingClaims') {
      try {
        const { state: next, events } = reduce(this.state, {
          t: 'resolveClaims',
          nowMs: Date.now(),
        });
        this.state = next;
        this.broadcastDelta(events);
        await this.maybeRunBots();
      } catch (e) {
        console.error('alarm reduce error', e);
      }
    }
  }

  // ---- bot driver -------------------------------------------------------

  private async maybeRunBots(): Promise<void> {
    // Run a few bot decisions in a loop, but cap to avoid runaway recursion.
    for (let i = 0; i < 16; i++) {
      const acted = this.tickBots();
      if (!acted) break;
    }
  }

  private tickBots(): boolean {
    // Awaiting claims: collect pass/peng/etc. from bot seats.
    if (this.state.phase === 'awaitingClaims' && this.state.pendingClaims) {
      const pending = this.state.pendingClaims;
      let acted = false;
      for (const seat of SEATS) {
        if (seat === this.state.lastDiscard?.from) continue;
        const slot = this.meta.seats[seat];
        if (!slot.bot) continue;
        if (pending.submitted[seat]) continue;
        const claim = slot.bot.pickClaim({ state: this.state, seat });
        const { state: next, events } = reduce(this.state, { t: 'declareClaim', seat, claim });
        this.state = next;
        this.broadcastDelta(events);
        acted = true;
      }
      return acted;
    }
    // Turn phase: if the active seat is a bot, draw + discard.
    if (this.state.phase === 'turn') {
      const seat = this.state.turn;
      const slot = this.meta.seats[seat];
      if (!slot.bot) return false;
      if (!this.state.hasDrawn) {
        const { state: next, events } = reduce(this.state, { t: 'draw', seat });
        this.state = next;
        this.broadcastDelta(events);
      }
      // Try a self-draw win first.
      try {
        const { state: next, events } = reduce(this.state, {
          t: 'declareWin',
          seat,
          selfDraw: true,
        });
        this.state = next;
        this.broadcastDelta(events);
        return true;
      } catch (e) {
        if (!(e instanceof IllegalActionError)) throw e;
      }
      const tile = slot.bot.pickDiscard({ state: this.state, seat });
      const { state: next, events } = reduce(this.state, { t: 'discard', seat, tile });
      this.state = next;
      this.broadcastDelta(events);
      if (this.state.phase === 'awaitingClaims' && this.state.pendingClaims) {
        this.scheduleAlarm(this.state.pendingClaims.deadlineMs);
      }
      return true;
    }
    return false;
  }

  // ---- helpers ----------------------------------------------------------

  private scheduleAlarm(deadlineMs: number): void {
    const ctx = this.ctx;
    if (ctx?.storage?.setAlarm) ctx.storage.setAlarm(deadlineMs);
  }

  private send(conn: Connection, msg: ServerMessage): void {
    conn.send(JSON.stringify(msg));
  }

  private sendErr(conn: Connection, code: string, detail?: string): void {
    const msg: ServerMessage =
      detail !== undefined ? { t: 'error', code, detail } : { t: 'error', code };
    this.send(conn, msg);
  }

  private broadcastDelta(events: Event[]): void {
    const msg: ServerMessage = { t: 'delta', events, state: this.state };
    this.broadcast(JSON.stringify(msg));
  }

  private broadcastLobby(): void {
    const players: PublicPlayer[] = SEATS.map((seat) => ({
      playerId: this.meta.seats[seat].playerId ?? `bot-${seat}`,
      displayName:
        this.meta.seats[seat].displayName ??
        (this.meta.seats[seat].bot ? `Bot (${this.meta.seats[seat].bot!.kind})` : `Seat ${seat}`),
      seat,
      connected: this.meta.seats[seat].connectionId !== null,
      isBot: this.meta.seats[seat].bot !== null,
    }));
    const msg: ServerMessage = {
      t: 'lobby',
      players,
      host: this.meta.hostPlayerId ?? '',
      rules: this.state.rules,
    };
    this.broadcast(JSON.stringify(msg));
  }
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
