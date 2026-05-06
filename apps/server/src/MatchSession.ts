import {
  type Bot,
  type BotKind,
  heuristicBot,
  passiveBot,
  runBotTurns,
  simpleBot,
} from '@mahjong/bots';
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

export interface MatchSessionOptions {
  /**
   * How long a seat is held for its owner after they drop. After this
   * elapses without a reconnect the seat is freed (the auto-bot keeps
   * playing) so a new player can take it. Default 60s.
   */
  reconnectGraceMs?: number;
}

interface SerializableSeat {
  playerId: string | null;
  displayName: string | null;
  botKind: BotKind | null;
  disconnectedSinceMs: number | null;
  botAutoInstalled: boolean;
}

/**
 * Plain-object snapshot of a `MatchSession`'s persisted state. Deliberately
 * excludes per-connection runtime fields (`connectionId`,
 * `lastEmittedDeadline`) — clients reconnect via `hello` after restore
 * and the alarm is re-armed by the next `maybeScheduleAlarm` call.
 */
export interface MatchSessionSnapshot {
  version: 1;
  state: GameState;
  hostPlayerId: string | null;
  seats: Record<Seat, SerializableSeat>;
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
  /**
   * Live connection ids of non-seated viewers — clients that joined when
   * the room was full and are now watching. Drives the `viewers` count
   * on every lobby broadcast. Not persisted in the snapshot — clients
   * re-hello after a DO restart and start fresh.
   */
  private spectators: Set<string> = new Set();
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

  /**
   * Serializable snapshot for DO storage. `connectionId` is intentionally
   * omitted — the partyserver runtime hands out fresh ones on the next
   * `hello`, so persisting them across hibernation would point at zombies.
   */
  snapshot(): MatchSessionSnapshot {
    const seats = {} as Record<Seat, SerializableSeat>;
    for (const seat of SEATS) {
      const slot = this.seats[seat];
      seats[seat] = {
        playerId: slot.playerId,
        displayName: slot.displayName,
        botKind: slot.bot?.kind ?? null,
        disconnectedSinceMs: slot.disconnectedSinceMs,
        botAutoInstalled: slot.botAutoInstalled,
      };
    }
    return {
      version: 1,
      state: this.state,
      hostPlayerId: this.hostPlayerId,
      seats,
    };
  }

  /**
   * Rehydrate from a snapshot — used when a hibernated DO comes back to
   * life. All connections start cleared; clients are expected to re-hello.
   * If the alarm was set pre-hibernation, the next `maybeScheduleAlarm`
   * will recompute and re-arm. Snapshots from a different schema version
   * are dropped (room boots fresh rather than mis-restoring).
   */
  restore(snap: MatchSessionSnapshot): void {
    if (snap.version !== 1) {
      console.warn(`MatchSession: ignoring snapshot with unknown version ${snap.version}`);
      return;
    }
    this.state = snap.state;
    this.hostPlayerId = snap.hostPlayerId;
    this.lastEmittedDeadline = null;
    for (const seat of SEATS) {
      const ser = snap.seats[seat];
      this.seats[seat] = {
        playerId: ser.playerId,
        displayName: ser.displayName,
        bot: ser.botKind ? botByKind(ser.botKind) : null,
        connectionId: null,
        disconnectedSinceMs: ser.disconnectedSinceMs,
        botAutoInstalled: ser.botAutoInstalled,
      };
    }
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
    if (this.spectators.delete(connectionId)) changed = true;
    if (!changed) return [];
    const out: Outbound[] = [this.lobbyBroadcast()];
    out.push(...this.runBots());
    out.push(...this.maybeScheduleAlarm());
    return out;
  }

  fireAlarm(nowMs: number): Outbound[] {
    const out: Outbound[] = [];
    out.push(...this.expireGraceTimers(nowMs));
    // Claim resolution timing follows the new ladder (PR A):
    //   - Soft floor (`deadlineMs`): only resolve when every non-discarder
    //     seat is in `submitted`. If any seat is still pending (a real
    //     human deliberating), wait — the alarm will re-fire at hard
    //     fallback.
    //   - Hard fallback (`hardDeadlineMs`): silent seats are auto-passed
    //     and the round resolves regardless of how many were pending.
    //   - When `hardDeadlineMs` is undefined (defensive — production
    //     rules always set it), behave like the old single-deadline alarm
    //     and resolve at any awaitingClaims tick.
    if (this.state.phase === 'awaitingClaims' && this.state.pendingClaims) {
      const pending = this.state.pendingClaims;
      const allSubmitted = SEATS.every((s) => s === pending.discard.from || pending.submitted[s]);
      const hard = pending.hardDeadlineMs;
      const pastHard = hard === undefined ? false : nowMs >= hard;
      const noLadder = hard === undefined;
      if (allSubmitted || pastHard || noLadder) {
        try {
          out.push(this.apply({ t: 'resolveClaims', nowMs }));
          out.push(...this.runBots());
        } catch (e) {
          console.error('alarm reduce error', e);
        }
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
        return this.onChat(connectionId, msg.text);
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
      // Room is full — keep the connection alive as a spectator instead
      // of closing it. The client gets a 'state' with you === 'spectator'
      // (already in the protocol), and the viewer count on lobby
      // broadcasts increments by one.
      this.spectators.add(connectionId);
      return [
        {
          kind: 'sendTo',
          connectionId,
          msg: { t: 'state', state: this.state, you: 'spectator' },
        },
        this.lobbyBroadcast(),
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

  private seatFor(connectionId: string): Seat | null {
    for (const s of SEATS) {
      if (this.seats[s].connectionId === connectionId) return s;
    }
    return null;
  }

  /**
   * Broadcast a chat / emote to all connected clients, tagged with the
   * sender's seat (or 'spectator' if they're connected without one).
   * Server-truncates the text at 280 chars to match `chatSchema`.
   */
  private onChat(connectionId: string, text: string): Outbound[] {
    const trimmed = text.slice(0, 280);
    if (trimmed.length === 0) return [];
    const seat = this.seatFor(connectionId);
    return [
      {
        kind: 'broadcast',
        msg: {
          t: 'chat',
          from: seat ?? 'spectator',
          text: trimmed,
          ts: Date.now(),
        },
      },
    ];
  }

  /** Apply an action through the engine and return its broadcast event. Mutates `this.state`. */
  private apply(action: Action): Outbound {
    const { state: next, events } = reduce(this.state, action);
    this.state = next;
    return this.deltaBroadcast(events);
  }

  /**
   * Compute the soonest deadline across active timers and emit a
   * `scheduleAlarm` for it. Cloudflare DOs only support one scheduled
   * alarm at a time, so we always re-arm to the earliest pending
   * deadline. Skips emission when the deadline matches what's already
   * armed — keeps the MatchRoom's per-action dispatch quiet during
   * steady-state play.
   *
   * Claim-window timing follows the ladder added in PR A:
   *   - All non-discarder seats already in `submitted` (e.g. a discard
   *     nobody can act on, every seat pre-passed in the reducer): arm
   *     for the soft floor (`deadlineMs`) so the round resolves at the
   *     fairness minimum without dragging to the hard fallback.
   *   - At least one seat still pending: arm for the hard fallback
   *     (`hardDeadlineMs`). Connected players get the full ladder to
   *     deliberate; the alarm steps in only if they go silent.
   *   - When `hardDeadlineMs` is undefined (solo / a configurator that
   *     opts out of the ladder), fall back to the soft floor.
   */
  private maybeScheduleAlarm(): Outbound[] {
    let soonest: number | null = null;
    if (this.state.phase === 'awaitingClaims' && this.state.pendingClaims) {
      const pending = this.state.pendingClaims;
      const allSubmitted = SEATS.every((s) => s === pending.discard.from || pending.submitted[s]);
      if (allSubmitted) {
        soonest = pending.deadlineMs;
      } else {
        soonest = pending.hardDeadlineMs ?? pending.deadlineMs;
      }
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
    const seatBots: Record<Seat, Bot | null> = {
      0: this.seats[0].bot,
      1: this.seats[1].bot,
      2: this.seats[2].bot,
      3: this.seats[3].bot,
    };
    runBotTurns(
      () => this.state,
      seatBots,
      (action) => {
        out.push(this.apply(action));
      },
    );
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
      msg: {
        t: 'lobby',
        players,
        host: this.hostPlayerId,
        rules: this.state.rules,
        viewers: this.spectators.size,
      },
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
