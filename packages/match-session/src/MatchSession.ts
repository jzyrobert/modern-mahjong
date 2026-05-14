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
  type LobbySummary,
  type PublicPlayer,
  type ServerMessage,
  parseClientMessage,
  pickRandomBotName,
  botDisplayName as protocolBotDisplayName,
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
  /**
   * After grace expires, the original `playerId` moves here so a returning
   * player can still reclaim their original seat from the auto-bot stand-in
   * via `findOrAssignSeat`. Cleared on a fresh hello, an explicit `seatBot`,
   * or `leave` (any path that replaces / clears the slot). Stays `null` while
   * `playerId` is still set (within grace) — the live `playerId` already
   * carries that information, no need to duplicate.
   */
  formerPlayerId: string | null;
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
   * playing) so a new player can take it — but the original `playerId`
   * is preserved as `formerPlayerId` so the owner can still reclaim the
   * seat from the stand-in if they come back later. Default 5 minutes —
   * mobile-friendly enough to survive a short screen-lock + tab-away
   * without yanking the player into a different seat on resume.
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
  /** Added later; older snapshots without this field default to null on restore. */
  formerPlayerId?: string | null;
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
   * on wake.
   */
  botActionDeadline: number | null;
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
    this.reconnectGraceMs = opts.reconnectGraceMs ?? 300_000;
    this.botPaceMs = opts.botPaceMs ?? DEFAULT_BOT_PACE_MS;
  }

  getState(): GameState {
    return this.state;
  }

  /**
   * Public-safe snapshot for the lobby browser. Returns null when the
   * session shouldn't be advertised — i.e. there's no host (an empty
   * waiting room) or no humans at all (a pure-bot session). Adapters
   * like `MatchRoom` call this after each lobby state change and ping
   * a registry DO with the result; the registry serves `GET /lobbies`.
   *
   * Important: this intentionally excludes the engine state itself.
   * Only metadata that should be visible to any potential joiner is
   * exposed.
   */
  publicSummary(matchCode: string): LobbySummary | null {
    if (this.hostPlayerId === null) return null;
    let hostName: string | null = null;
    let humanCount = 0;
    let botCount = 0;
    for (const seat of SEATS) {
      const slot = this.seats[seat];
      if (slot.bot !== null && slot.playerId === null) botCount++;
      else if (slot.playerId !== null) {
        humanCount++;
        if (slot.playerId === this.hostPlayerId) hostName = slot.displayName;
      }
    }
    if (humanCount === 0) return null;
    return {
      code: matchCode,
      hostName,
      humanCount,
      botCount,
      totalSeats: 4,
      isInProgress: this.state.phase === 'turn' || this.state.phase === 'awaitingClaims',
      rules: this.state.rules,
    };
  }

  /** Test/seeding helper: place a bot in a specific seat. Defaults the
   *  displayName to a randomly-picked entry from `BOT_NAME_POOL` that
   *  isn't already in use by another seat — matches the production
   *  `onSeatBot` path so tests inherit the same uniqueness invariant
   *  the lobby renderer relies on. */
  seatBot(seat: Seat, bot: Bot, displayName?: string): void {
    this.seats[seat] = {
      ...emptySeat(),
      displayName: displayName ?? this.allocateBotName(seat),
      bot,
    };
  }

  /** Pick a `BOT_NAME_POOL` entry that no other seat already owns. The
   *  excluded seat (where we're about to write) is skipped so seat
   *  re-skinning (host swaps Easy → Smart on the same seat) doesn't
   *  collide with the slot's existing name. */
  private allocateBotName(forSeat: Seat): string {
    const taken: string[] = [];
    for (const s of SEATS) {
      if (s === forSeat) continue;
      const dn = this.seats[s].displayName;
      if (dn) taken.push(dn);
    }
    return pickRandomBotName(taken);
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
        formerPlayerId: slot.formerPlayerId,
      };
    }
    return {
      version: 1,
      state: this.state,
      hostPlayerId: this.hostPlayerId,
      seats,
      botActionDeadline: this.botActionDeadline,
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
    // `drewThisTurn` was added after the v1 schema landed; older
    // snapshots have it undefined at runtime. Default to false so a
    // mid-match DO restart doesn't grant a spurious tsumo on the
    // first claim — restored seats fall back to "needs to draw or
    // claim again before tsumo is legal," which matches the engine's
    // post-restart guard in `declareWin`.
    this.state = { ...snap.state, drewThisTurn: snap.state.drewThisTurn ?? false };
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
        formerPlayerId: ser.formerPlayerId ?? null,
      };
    }
  }

  applyClientMessage(connectionId: string, raw: unknown): Outbound[] {
    const r = parseClientMessage(raw);
    if (!r.ok) return [errMsg(connectionId, 'SCHEMA', r.error)];
    return this.handle(connectionId, r.msg);
  }

  /**
   * Re-bind seats to live connection ids after a hibernation cycle.
   * The snapshot intentionally drops `connectionId` (a partyserver
   * connection id is meaningless after the JS heap is recreated), but
   * Cloudflare keeps the WebSockets themselves alive across hibernation.
   * On wake, the runtime hands us a `playerId → connectionId` map
   * derived from each connection's persisted state, and we restore the
   * seat→connection mapping so subsequent broadcasts and host-action
   * gates work without forcing every client to re-hello.
   */
  attachAll(byPlayerId: Map<string, string>): Outbound[] {
    let changed = false;
    for (const seat of SEATS) {
      const slot = this.seats[seat];
      if (slot.playerId === null) continue;
      const connId = byPlayerId.get(slot.playerId);
      if (connId !== undefined && slot.connectionId !== connId) {
        slot.connectionId = connId;
        changed = true;
      }
    }
    return changed ? [this.lobbyBroadcast()] : [];
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
    // Humans-only claim ladder: bots don't gate the soft floor; they're
    // polled at resolution time. Hard fallback resolves regardless. The
    // DO alarm fires at or after the armed deadline, so reaching either
    // condition here means we're past the soft floor.
    if (this.state.phase === 'awaitingClaims' && this.state.pendingClaims) {
      const pending = this.state.pendingClaims;
      const allHumansSubmitted = this.allHumansSubmittedFor(pending);
      const hard = pending.hardDeadlineMs;
      const pastHard = hard === undefined ? false : nowMs >= hard;
      const noLadder = hard === undefined;
      if (allHumansSubmitted || pastHard || noLadder) {
        try {
          out.push(...this.resolveClaimWindow(nowMs));
          out.push(...this.runBots(nowMs));
        } catch (e) {
          console.error('alarm reduce error', e);
        }
      }
    }
    if (this.botActionDeadline !== null && nowMs >= this.botActionDeadline) {
      try {
        out.push(...this.runBots(nowMs));
      } catch (e) {
        console.error('alarm bot-pace error', e);
      }
    }
    // Per-turn timeout — see `isActiveSeatStalledHuman`. The auto-
    // discard uses `passiveBot.pickDiscard` so the choice mirrors the
    // disconnect path (same default behaviour for a stalled seat,
    // whether they timed out or dropped); `runBots` won't fire on
    // its own since the seat is human, not bot-occupied.
    if (
      this.state.phase === 'turn' &&
      this.state.turnDeadlineMs !== undefined &&
      nowMs >= this.state.turnDeadlineMs &&
      this.isActiveSeatStalledHuman()
    ) {
      try {
        out.push(...this.forceTurnAutoDiscard(nowMs));
      } catch (e) {
        console.error('alarm turn-timeout error', e);
      }
    }
    out.push(...this.maybeScheduleAlarm());
    return out;
  }

  /** Apply a passive auto-discard for the current `turn` seat. If the
   *  seat hasn't drawn yet, draw first; if the draw resolves the hand
   *  (wall-empty) skip the discard. After the discard runs, kick the
   *  bot loop so any bot seats waiting on this human's action proceed
   *  through the next turn(s). */
  private forceTurnAutoDiscard(nowMs: number): Outbound[] {
    const out: Outbound[] = [];
    const seat = this.state.turn;
    if (!this.state.hasDrawn) {
      out.push(this.apply({ t: 'draw', seat }));
      if (this.state.phase !== 'turn') {
        out.push(...this.runBots(nowMs));
        return out;
      }
    }
    const tile = passiveBot.pickDiscard({ state: this.state, seat });
    out.push(this.apply({ t: 'discard', seat, tile }));
    out.push(...this.runBots(nowMs));
    return out;
  }

  /** Bot seats and the discarder are skipped; bots are polled at resolution. */
  private allHumansSubmittedFor(pending: NonNullable<GameState['pendingClaims']>): boolean {
    return SEATS.every(
      (s) =>
        s === pending.discard.from ||
        this.seats[s].bot !== null ||
        pending.submitted[s] !== undefined,
    );
  }

  /**
   * Drive a stuck claim window to completion: poll each unsubmitted bot,
   * then `resolveClaims` to pad silent humans with passes. A bot pick
   * that the engine refuses (defence-in-depth) is retried as `pass`.
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
      // Preserve the original playerId as `formerPlayerId` so the owner
      // can still reclaim this seat from the bot stand-in if they come
      // back later — that's the mobile reality where a screen-lock can
      // outlast even a generous grace window. `findOrAssignSeat` checks
      // `formerPlayerId` after the live-playerId pass but before falling
      // through to "any empty seat", so the original owner still wins
      // over a brand-new joiner.
      slot.formerPlayerId = slot.playerId;
      slot.playerId = null;
      // Past the grace window the seat reads as "this is now a bot
      // playing in place of the absent human" — assign a fresh random
      // name from `BOT_NAME_POOL` so the felt rotates seat avatars
      // away from the disconnected human's identity. The status chip
      // (rendered from `botKind`) still surfaces the difficulty.
      slot.displayName = slot.bot ? this.allocateBotName(seat) : null;
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
        return this.onLeave(connectionId);
      case 'seatBot':
        return this.onSeatBot(connectionId, msg.seat, msg.kind);
      case 'unseatBot':
        return this.onUnseatBot(connectionId, msg.seat);
    }
  }

  /**
   * Explicit leave from a seated player or spectator. Differs from
   * `detachConnection` (the dropped-WS path):
   *   - Frees the seat completely — no auto-bot, no grace window. The
   *     leaver is intentionally walking away, so a new joiner should be
   *     able to take their seat immediately rather than waiting 60s for
   *     the grace timer to evict an absent player.
   *   - If the leaver was the host, host is reassigned to the next
   *     connected human right now (instead of after grace expiry, which
   *     left guests staring at a frozen lobby for a minute).
   *   - If the leaver was the host AND no other humans remain, the
   *     match is dissolved: every remaining connection (spectators,
   *     bot-only seats can't act on their own) gets a `HOST_LEFT` error
   *     and is closed, matching the user expectation that "host left,
   *     party's over."
   */
  private onLeave(connectionId: string): Outbound[] {
    const out: Outbound[] = [];
    const leaverSeat = this.seatFor(connectionId);
    if (leaverSeat !== null) {
      const wasHost = this.seats[leaverSeat].playerId === this.hostPlayerId;
      this.seats[leaverSeat] = emptySeat();
      if (wasHost) {
        const nextHost = this.firstConnectedPlayerId();
        this.hostPlayerId = nextHost;
        if (nextHost === null) {
          // Match dissolved — broadcast the reason then close every
          // remaining connection. The leaver's connection is closed
          // separately below; their client already initiated `leave()`
          // so the inbound HOST_LEFT is harmless noise.
          out.push({ kind: 'broadcast', msg: { t: 'error', code: 'HOST_LEFT' } });
          for (const s of SEATS) {
            const other = this.seats[s].connectionId;
            if (other !== null && other !== connectionId) {
              out.push({ kind: 'closeConnection', connectionId: other });
            }
          }
          for (const specConn of this.spectators) {
            if (specConn !== connectionId) {
              out.push({ kind: 'closeConnection', connectionId: specConn });
            }
          }
        }
      }
      out.push(this.lobbyBroadcast());
    }
    out.push({ kind: 'closeConnection', connectionId });
    return out;
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
    // 1. Live playerId match — within grace, or never disconnected.
    for (const s of SEATS) {
      if (this.seats[s].playerId === playerId) return s;
    }
    // 2. Post-grace reclaim — the owner has come back after the grace
    //    window already collapsed their `playerId` into `formerPlayerId`.
    //    Prefer this over any empty seat so a returning player always
    //    lands in their original seat, even after a long screen-lock.
    for (const s of SEATS) {
      if (this.seats[s].playerId === null && this.seats[s].formerPlayerId === playerId) return s;
    }
    // 3. Empty seat — no `playerId`, no bot.
    for (const s of SEATS) {
      if (this.seats[s].playerId === null && this.seats[s].bot === null) return s;
    }
    // 4. Any abandoned auto-bot stand-in — last-resort claim for a new
    //    joiner when every other seat is locked or filled.
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

  /** Returns error outbounds on rejection, or null when the caller may proceed. */
  private requireHostBetweenHands(connectionId: string, verb: string): Outbound[] | null {
    const sender = this.playerIdFor(connectionId);
    if (sender === null || sender !== this.hostPlayerId) {
      return [errMsg(connectionId, 'HOST', `only the host can ${verb}`)];
    }
    if (this.state.phase !== 'waiting' && this.state.phase !== 'resolved') {
      return [errMsg(connectionId, 'PHASE', `bot ${verb} only allowed between hands`)];
    }
    return null;
  }

  private onSeatBot(connectionId: string, seat: Seat, kind: BotKind): Outbound[] {
    const gate = this.requireHostBetweenHands(connectionId, 'seat bots');
    if (gate) return gate;
    const slot = this.seats[seat];
    if (slot.connectionId !== null) {
      return [errMsg(connectionId, 'OCCUPIED', 'seat is held by a connected player')];
    }
    // Auto-installed stand-ins are reseatable; a still-graced disconnected
    // human is not — the seat is held for them to reconnect into.
    if (slot.playerId !== null && !slot.botAutoInstalled) {
      return [errMsg(connectionId, 'OCCUPIED', 'seat is held for a disconnected player')];
    }
    const bot = botByKind(kind);
    // If the seat already held a bot (host swapping difficulty), keep
    // the existing random name — the player is the "same" character at
    // the table, just with new strategy. Fresh seats get a freshly
    // allocated unique name.
    const existingName = slot.bot ? slot.displayName : null;
    this.seats[seat] = {
      playerId: null,
      displayName: existingName ?? this.allocateBotName(seat),
      bot,
      connectionId: null,
      disconnectedSinceMs: null,
      botAutoInstalled: false,
      formerPlayerId: null,
    };
    // Overwriting an auto-bot stand-in clears its grace deadline; re-arm
    // so the previously-armed alarm doesn't wake the DO for nothing.
    return [this.lobbyBroadcast(), ...this.maybeScheduleAlarm()];
  }

  private onUnseatBot(connectionId: string, seat: Seat): Outbound[] {
    const gate = this.requireHostBetweenHands(connectionId, 'unseat bots');
    if (gate) return gate;
    const slot = this.seats[seat];
    if (slot.bot === null) {
      return [errMsg(connectionId, 'EMPTY', 'seat does not hold a bot')];
    }
    if (slot.botAutoInstalled) {
      return [errMsg(connectionId, 'AUTO_BOT', 'cannot unseat a stand-in for a graced player')];
    }
    this.seats[seat] = emptySeat();
    return [this.lobbyBroadcast(), ...this.maybeScheduleAlarm()];
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
      if (this.allHumansSubmittedFor(pending)) {
        soonest = pending.deadlineMs;
      } else {
        soonest = pending.hardDeadlineMs ?? pending.deadlineMs;
      }
    }
    // Per-turn timeout — only when the active seat is a connected
    // human (bots run synchronously through `runBots`; disconnected
    // humans fall through to the auto-bot installed in
    // `detachConnection`). The engine sets `turnDeadlineMs` when
    // `rules.turnTimeoutMs > 0`; solo strips the rule so the field
    // stays undefined and this branch is inert there.
    if (
      this.state.phase === 'turn' &&
      this.state.turnDeadlineMs !== undefined &&
      this.isActiveSeatStalledHuman()
    ) {
      const deadline = this.state.turnDeadlineMs;
      if (soonest === null || deadline < soonest) soonest = deadline;
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

  /** True iff phase is `turn` and the seat owes an action — connected
   *  human player, no auto-bot stand-in, the deadline applies. */
  private isActiveSeatStalledHuman(): boolean {
    if (this.state.phase !== 'turn') return false;
    const slot = this.seats[this.state.turn];
    return slot.bot === null && slot.connectionId !== null;
  }

  /**
   * Step bot-controlled seats forward through the engine. The draw fires
   * immediately; the discard is paced — once `botActionDeadline` is armed
   * the loop returns and the DO alarm wakes us at the deadline to emit
   * the discard. Tests construct with `botPaceMs: 0` to short-circuit
   * pacing and drive a full hand in one synchronous call.
   */
  private runBots(nowMs: number): Outbound[] {
    const out: Outbound[] = [];
    // Cap the per-call iteration count so a buggy bot can't pin a DO
    // request indefinitely. The cap was 16 back when every discard
    // yielded via `phase: 'awaitingClaims'` (one bot turn per call —
    // the alarm re-entered for the next). The claim-window auto-
    // resolve now folds an uncontested discard back into `phase:
    // 'turn'` in the same reduce, so a `botPaceMs: 0` session can
    // chain many bot turns through one call. 256 is comfortably
    // above the ~100 turns in a typical hand, so a full all-bots
    // hand finishes in a single fireAlarm without losing the safety
    // net against runaway loops.
    for (let i = 0; i < 256; i++) {
      const state = this.state;
      // Synchronously drain a bot claim if one's pending. This is
      // what lets a host-vs-bots match advance off a discard the
      // moment a bot is the only seat with a meaningful claim —
      // pre-fix the bot's claim was deferred to the soft-floor
      // alarm 3s later (and an `easy`-mode bot's `pickClaim` returns
      // `pass`, so the round was just sitting on a guaranteed
      // outcome). Mirrors the solo transport's claim-drain loop.
      if (state.phase === 'awaitingClaims' && state.pendingClaims) {
        const pending = state.pendingClaims;
        let polledBot = false;
        for (const seat of SEATS) {
          if (seat === pending.discard.from) continue;
          if (pending.submitted[seat] !== undefined) continue;
          const bot = this.seats[seat].bot;
          if (!bot) continue;
          let claim: Claim;
          try {
            claim = bot.pickClaim({ state: this.state, seat });
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
          polledBot = true;
          break;
        }
        if (polledBot) continue;
        // Window still open with only humans pending — bail out
        // and let the alarm / human action drive the next step.
        this.botActionDeadline = null;
        return out;
      }
      if (state.phase !== 'turn') {
        this.botActionDeadline = null;
        return out;
      }
      const seat = state.turn;
      const bot = this.seats[seat].bot;
      if (!bot) {
        this.botActionDeadline = null;
        return out;
      }
      if (!state.hasDrawn) {
        try {
          out.push(this.apply({ t: 'draw', seat }));
        } catch (e) {
          if (e instanceof IllegalActionError) return out;
          throw e;
        }
        if (this.state.phase !== 'turn') continue;
      }
      if (this.botActionDeadline === null) {
        this.botActionDeadline = nowMs + this.botPaceMs;
      }
      if (nowMs < this.botActionDeadline) return out;
      this.botActionDeadline = null;
      try {
        out.push(this.apply({ t: 'declareWin', seat, selfDraw: true }));
        continue;
      } catch (e) {
        if (!(e instanceof IllegalActionError)) throw e;
      }
      const tile = bot.pickDiscard({ state: this.state, seat });
      out.push(this.apply({ t: 'discard', seat, tile }));
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
    formerPlayerId: null,
  };
}

function botDisplayName(bot: Bot): string {
  return protocolBotDisplayName(bot.kind);
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
