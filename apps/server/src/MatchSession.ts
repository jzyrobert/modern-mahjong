import { type Bot, type BotKind, heuristicBot, passiveBot, simpleBot } from '@mahjong/bots';
import {
  type Action,
  type Claim,
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
  /**
   * Minimum delay between a bot's draw and its discard, in milliseconds.
   * Gives humans time to read what the bot just pulled before the next
   * action fires. Default 3000ms; tests pass 0 to short-circuit the
   * alarm-driven pacing entirely.
   */
  botPaceMs?: number;
}

const DEFAULT_BOT_PACE_MS = 3_000;

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
  /**
   * Server-clock deadline for the currently-pending bot discard, if any.
   * Round-trips through hibernation so a bot that drew right before a
   * DO sleep still discards `botPaceMs` after that draw, not instantly
   * on wake. Older snapshots omit it (defaults to null on restore).
   */
  botActionDeadline?: number | null;
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
  private readonly botPaceMs: number;
  /**
   * Server-clock deadline at which the bot whose turn it currently is
   * should fire its discard. Set when a bot draws (so the felt animates
   * the wall tick) and cleared after the discard fires; null when no
   * bot is mid-turn. The DO alarm is armed for whichever is sooner —
   * this, the claim-window deadline, or a reconnect grace timer.
   */
  private botActionDeadline: number | null = null;
  /**
   * The deadline currently armed via `scheduleAlarm`, or null if no
   * alarm is set. Cached so we don't re-emit the same `scheduleAlarm`
   * outbound on every action when nothing about the deadline changed.
   */
  private lastEmittedDeadline: number | null = null;

  constructor(opts: MatchSessionOptions = {}) {
    this.reconnectGraceMs = opts.reconnectGraceMs ?? 60_000;
    this.botPaceMs = opts.botPaceMs ?? DEFAULT_BOT_PACE_MS;
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
      ...(this.botActionDeadline !== null ? { botActionDeadline: this.botActionDeadline } : {}),
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
    this.botActionDeadline = snap.botActionDeadline ?? null;
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

  /** True when every seat holds a connected human or a bot. */
  private allSeatsFilled(): boolean {
    for (const s of SEATS) {
      const slot = this.seats[s];
      if (slot.playerId === null && slot.bot === null) return false;
    }
    return true;
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
    out.push(...this.runBots(nowMs));
    out.push(...this.maybeScheduleAlarm());
    return out;
  }

  fireAlarm(nowMs: number): Outbound[] {
    const out: Outbound[] = [];
    out.push(...this.expireGraceTimers(nowMs));
    // Claim resolution timing follows the human-anchored ladder:
    //   - Soft floor (`deadlineMs`): only resolve when every non-discarder
    //     *human* seat is in `submitted`. Bot seats don't count toward
    //     the ladder — their decisions land at resolution time, not as
    //     timer pressure on humans.
    //   - Hard fallback (`hardDeadlineMs`): silent humans get auto-passed
    //     by `resolveClaims`, bots get polled-and-applied first, and the
    //     round resolves regardless.
    //   - When `hardDeadlineMs` is undefined (defensive — server rules
    //     always set it), resolve immediately on any awaitingClaims tick.
    if (this.state.phase === 'awaitingClaims' && this.state.pendingClaims) {
      const pending = this.state.pendingClaims;
      const allHumansSubmitted = this.allHumansSubmittedFor(pending);
      const hard = pending.hardDeadlineMs;
      const pastHard = hard === undefined ? false : nowMs >= hard;
      const noLadder = hard === undefined;
      // The DO alarm only fires at or after the armed deadline, so when
      // `allHumansSubmitted` we trust that the scheduler has already
      // observed the soft-floor minimum and resolve unconditionally.
      // Tests that pump `fireAlarm` manually rely on this contract too.
      if (allHumansSubmitted || pastHard || noLadder) {
        try {
          out.push(...this.resolveClaimWindow(nowMs));
          out.push(...this.runBots(nowMs));
        } catch (e) {
          console.error('alarm reduce error', e);
        }
      }
    }
    // Bot pacing: a draw armed `botActionDeadline` and the alarm has
    // now caught up — `runBots(nowMs)` will see `nowMs >= deadline` and
    // fire the discard. Safe to call even when the deadline is in the
    // future or unset (it bails immediately in those cases).
    if (this.botActionDeadline !== null && nowMs >= this.botActionDeadline) {
      try {
        out.push(...this.runBots(nowMs));
      } catch (e) {
        console.error('alarm bot-pace error', e);
      }
    }
    out.push(...this.maybeScheduleAlarm());
    return out;
  }

  /**
   * Whether every non-discarder human seat has either submitted a claim
   * or been pre-passed by the `discard` reducer. Bot seats are skipped —
   * their decisions are polled at resolution time and never gate the
   * claim-window timer.
   */
  private allHumansSubmittedFor(pending: NonNullable<GameState['pendingClaims']>): boolean {
    return SEATS.every(
      (s) =>
        s === pending.discard.from ||
        this.seats[s].bot !== null ||
        pending.submitted[s] !== undefined,
    );
  }

  /**
   * Drive a stuck claim window to completion. First polls every bot seat
   * that hasn't submitted (each picks `pickClaim` → `declareClaim`), then
   * — if the engine hasn't auto-resolved on the last submission — emits
   * an explicit `resolveClaims` so silent humans get padded with passes.
   *
   * Bot picks that turn out to be illegal (e.g. an out-of-band `chi` from
   * a non-next seat — bots shouldn't return these but defence-in-depth)
   * fall back to `pass`.
   */
  private resolveClaimWindow(nowMs: number): Outbound[] {
    const out: Outbound[] = [];
    for (const seat of SEATS) {
      const cur = this.state;
      if (cur.phase !== 'awaitingClaims' || !cur.pendingClaims) break;
      if (seat === cur.pendingClaims.discard.from) continue;
      if (cur.pendingClaims.submitted[seat] !== undefined) continue;
      const bot = this.seats[seat].bot;
      if (!bot) continue;
      let claim: Claim;
      try {
        claim = bot.pickClaim({ state: cur, seat });
      } catch (e) {
        console.error('bot pickClaim threw', e);
        claim = { kind: 'pass' };
      }
      try {
        out.push(this.apply({ t: 'declareClaim', seat, claim }));
      } catch (e) {
        if (e instanceof IllegalActionError) {
          out.push(this.apply({ t: 'declareClaim', seat, claim: { kind: 'pass' } }));
        } else {
          throw e;
        }
      }
    }
    if (this.state.phase === 'awaitingClaims') {
      out.push(this.apply({ t: 'resolveClaims', nowMs }));
    }
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
      case 'seatBot':
        return this.onSeatBot(connectionId, msg.seat, msg.kind);
      case 'unseatBot':
        return this.onUnseatBot(connectionId, msg.seat);
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
    if (action.t === 'startHand' && !this.allSeatsFilled()) {
      return [errMsg(connectionId, 'SEATS', 'all seats must be filled before starting')];
    }
    const nowMs = Date.now();
    try {
      const out: Outbound[] = [this.apply(action)];
      out.push(...this.runBots(nowMs));
      // After a human's `declareClaim` (or any action that left the room
      // in `awaitingClaims`), check whether every human has now weighed
      // in. If yes — and the soft floor has elapsed — poll bots and let
      // the engine resolve. Bots never push the timer themselves.
      out.push(...this.maybeFinishClaimWindow(nowMs));
      out.push(...this.maybeScheduleAlarm());
      return out;
    } catch (e) {
      if (e instanceof IllegalActionError) {
        return [errMsg(connectionId, e.code, e.message)];
      }
      return [errMsg(connectionId, 'INTERNAL', String(e))];
    }
  }

  private maybeFinishClaimWindow(nowMs: number): Outbound[] {
    if (this.state.phase !== 'awaitingClaims' || !this.state.pendingClaims) return [];
    const pending = this.state.pendingClaims;
    if (!this.allHumansSubmittedFor(pending)) return [];
    if (nowMs < pending.deadlineMs) return [];
    const out = this.resolveClaimWindow(nowMs);
    out.push(...this.runBots(nowMs));
    return out;
  }

  private onSeatBot(connectionId: string, seat: Seat, kind: BotKind): Outbound[] {
    const sender = this.playerIdFor(connectionId);
    if (sender === null || sender !== this.hostPlayerId) {
      return [errMsg(connectionId, 'HOST', 'only the host can seat bots')];
    }
    if (this.state.phase !== 'waiting' && this.state.phase !== 'resolved') {
      return [errMsg(connectionId, 'PHASE', 'bot seating only allowed between hands')];
    }
    const slot = this.seats[seat];
    // Don't displace a connected human. An already-seated bot (auto- or
    // host-installed) is fair game — that's the "swap skill" path.
    if (slot.connectionId !== null) {
      return [errMsg(connectionId, 'OCCUPIED', 'seat is held by a connected player')];
    }
    // A disconnected human still inside their reconnect grace also gets
    // protection — the host should call `unseatBot` first if they really
    // mean to evict, but v1 doesn't expose that path. Auto-bot stand-ins
    // (`botAutoInstalled = true`) are reseatable; the host can just pick
    // a stronger brain than `passive`.
    if (slot.playerId !== null && !slot.botAutoInstalled) {
      return [errMsg(connectionId, 'OCCUPIED', 'seat is held for a disconnected player')];
    }
    this.seats[seat] = {
      playerId: null,
      displayName: botDisplayNameByKind(kind),
      bot: botByKind(kind),
      connectionId: null,
      disconnectedSinceMs: null,
      botAutoInstalled: false,
    };
    return [this.lobbyBroadcast()];
  }

  private onUnseatBot(connectionId: string, seat: Seat): Outbound[] {
    const sender = this.playerIdFor(connectionId);
    if (sender === null || sender !== this.hostPlayerId) {
      return [errMsg(connectionId, 'HOST', 'only the host can unseat bots')];
    }
    if (this.state.phase !== 'waiting' && this.state.phase !== 'resolved') {
      return [errMsg(connectionId, 'PHASE', 'bot unseating only allowed between hands')];
    }
    const slot = this.seats[seat];
    if (slot.bot === null) {
      return [errMsg(connectionId, 'EMPTY', 'seat does not hold a bot')];
    }
    // An auto-installed bot is a stand-in for a still-graced human —
    // unseating would forfeit the seat the human is reconnecting to.
    // Defer to the existing grace timer instead.
    if (slot.botAutoInstalled) {
      return [errMsg(connectionId, 'AUTO_BOT', 'cannot unseat a stand-in for a graced player')];
    }
    this.seats[seat] = emptySeat();
    return [this.lobbyBroadcast()];
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
      // Mirror `fireAlarm`'s humans-only ladder: with every human in,
      // arm at the soft floor (we'll poll bots and resolve there).
      // Otherwise wait for the hard fallback.
      if (this.allHumansSubmittedFor(pending)) {
        soonest = pending.deadlineMs;
      } else {
        soonest = pending.hardDeadlineMs ?? pending.deadlineMs;
      }
    }
    if (this.botActionDeadline !== null) {
      if (soonest === null || this.botActionDeadline < soonest) {
        soonest = this.botActionDeadline;
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

  /**
   * Step bot-controlled seats forward through the engine. The draw is
   * applied immediately (so the felt animates the wall tick + the new
   * tile sliding into the bot's hidden hand) but the discard is deferred
   * until `botActionDeadline` elapses — `botPaceMs` of "thinking" between
   * draw and discard so humans can read what the bot pulled.
   *
   * The alarm chains: each bot turn arms a deadline, the DO scheduler
   * fires `fireAlarm` at that deadline, which calls `runBots` again to
   * emit the discard. After the discard the loop continues into the
   * next bot's turn (if any) and arms a new deadline.
   *
   * Tests can pass `botPaceMs: 0` in the constructor to make bot
   * actions fire instantly and synchronously, matching the pre-pacing
   * behaviour for hands the test wants to drive in one shot.
   */
  private runBots(nowMs: number = Date.now()): Outbound[] {
    const out: Outbound[] = [];
    // Safety bound matches the legacy `runBotTurns` loop — a real hand
    // never iterates more than a handful of times per call, but a
    // pathological state shouldn't lock the DO.
    for (let i = 0; i < 16; i++) {
      const state = this.state;
      if (state.phase !== 'turn') {
        // No bot turn in progress — clear any stale pacing deadline.
        this.botActionDeadline = null;
        return out;
      }
      const seat = state.turn;
      const bot = this.seats[seat].bot;
      if (!bot) {
        this.botActionDeadline = null;
        return out;
      }
      // Step 1: bot needs to draw. Apply immediately so the tile is
      // visibly pulled from the wall.
      if (!state.hasDrawn) {
        try {
          out.push(this.apply({ t: 'draw', seat }));
        } catch (e) {
          if (e instanceof IllegalActionError) return out;
          throw e;
        }
        if (this.state.phase !== 'turn') continue; // wall-empty draw
      }
      // Step 2: pace the discard. Arm the deadline if not already set.
      if (this.botActionDeadline === null) {
        this.botActionDeadline = nowMs + this.botPaceMs;
      }
      if (nowMs < this.botActionDeadline) {
        // Wait for the alarm to fire at the deadline.
        return out;
      }
      // Deadline reached: fire the discard.
      this.botActionDeadline = null;
      try {
        out.push(this.apply({ t: 'declareWin', seat, selfDraw: true }));
        continue; // hand resolved (or moved on)
      } catch (e) {
        if (!(e instanceof IllegalActionError)) throw e;
      }
      const tile = bot.pickDiscard({ state: this.state, seat });
      out.push(this.apply({ t: 'discard', seat, tile }));
      // After a discard the engine transitions to `awaitingClaims`,
      // which the loop top will detect and exit on.
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
        ...(slot.bot ? { botKind: slot.bot.kind } : {}),
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

function botDisplayNameByKind(kind: BotKind): string {
  return `Bot (${kind})`;
}

export function botByKind(kind: BotKind): Bot {
  switch (kind) {
    case 'simple':
      return simpleBot;
    case 'heuristic':
      return heuristicBot;
    case 'passive':
      return passiveBot;
  }
}
