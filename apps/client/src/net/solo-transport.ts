import { type Bot, type BotKind, bots as botRegistry, passiveBot } from '@mahjong/bots';
import {
  type Action,
  type Claim,
  type GameState,
  IllegalActionError,
  SEATS,
  type Seat,
  type Tile,
  emptyState,
  reduce,
  sameFace,
  soloRulesFrom,
} from '@mahjong/game-logic';
import { type ServerMessage, pickRandomBotName } from '@mahjong/protocol';
import type { Transport, TransportStatus } from './transport';

/**
 * Test override hatch — see `withTestScript` below. The Playwright suite
 * uses this to make a bot discard a known face-tile so the claim window
 * lands in a deterministic shape.
 */
interface TestBotScript {
  /** Sequence of tiles to discard, in order. Each entry is consumed once
   *  and matched against the bot's hand by face (rank+suit / honor). If
   *  the face is gone from the bot's hand, fall back to the wrapped bot.
   *  When the script is exhausted, every subsequent turn falls back. */
  discards?: Tile[];
  /** Sequence of claims to issue; defaults to all-pass. Same exhaustion
   *  semantics as `claims`. */
  claims?: Claim[];
  /** Sequence of promoted-gang declarations to fire on the bot's own
   *  turn, before the discard pick. Each entry is consumed once and
   *  matched against the bot's melds (must hold a `peng` of the
   *  target face) AND the bot's current hand (must contain a tile of
   *  that face). If the preconditions don't hold, the entry stays
   *  queued and the bot falls through to `pickDiscard` for that turn.
   *
   *  The existing `pickClaim` shim only fires during the
   *  `awaitingClaims` window, so it can't reach the own-turn
   *  `declareGangPromoted` path in `packages/game-logic/src/actions.ts:557`.
   *  This slot is the bot-side analogue — consumed inside the bot
   *  pacing loop's draw-then-pause-then-act block (`driveBots` below),
   *  used by the `robbing-kong` lesson to set up the rob window. */
  promotions?: { tile: Tile }[];
}
type TestBotScripts = Partial<Record<Seat, TestBotScript>>;

declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_BOT_SCRIPTS__: TestBotScripts | undefined;
  /** Override the per-bot-turn pacing delay. Default in production is
   *  3000ms (gives the user time to read the bot's discard before the
   *  next turn fires). Tests set this to `0` so the suite runs in
   *  seconds instead of minutes. */
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_BOT_PACE_MS__: number | undefined;
  /** Override the solo per-turn timeout. The lobby's RulePanel input
   *  is clamped to a 5s minimum which is too long for a fast e2e
   *  cycle; tests set this to a few hundred ms instead so the
   *  auto-discard fires inside the test's wall-clock budget. */
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_TURN_TIMEOUT_MS__: number | undefined;
  /** Override the per-bot claim-submission delay (default 2000–6000ms,
   *  randomized per-bot). When set, tests get a deterministic single
   *  fixed delay (no jitter) — `0` for instant submissions. */
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_BOT_CLAIM_DELAY_MS__: number | undefined;
}

interface SoloOptions {
  playerId: string;
  displayName: string;
  /** Per-seat bot kind for seats 1..3. Defaults to the historical
   *  mix `[heuristic, simple, passive]` so callers that haven't
   *  opted into custom skills get the same behaviour as before. */
  botSkills?: [BotKind, BotKind, BotKind];
  /** Optional pre-built engine state to start the loop from — used
   *  by the solo reload-survival path (see
   *  `apps/client/src/state/solo-persist.ts`). When provided, the
   *  transport starts in whatever phase the snapshot was in
   *  (`'turn'`, `'awaitingClaims'`, etc.); the bot loop runs once
   *  on emit so a bot whose turn was in flight at reload time picks
   *  back up where it left off. Defaults to the empty waiting-room
   *  state for fresh "Play vs bots" launches. */
  seedState?: GameState;
}

/** Surface the live solo transport supports — extends the base
 *  `Transport` so the lobby waiting room can swap out a bot's skill
 *  while the match is still in `phase: 'waiting'`. Other transports
 *  (online, LAN) don't expose this — bot skill selection only makes
 *  sense for the in-process solo loop. */
export interface SoloTransportControls {
  setBotSkill: (seat: 1 | 2 | 3, kind: BotKind) => void;
}

const BOT_PLAYER_IDS = ['bot-1', 'bot-2', 'bot-3'] as const;
const DEFAULT_BOT_SKILLS: [BotKind, BotKind, BotKind] = ['heuristic', 'simple', 'passive'];

/** Production defaults for the per-bot claim-submission delay. Read
 *  via `botClaimDelayMs()` so the `__MAHJONG_TEST_*` override applies
 *  uniformly. */
export const DEFAULT_BOT_CLAIM_MIN_MS = 2_000;
export const DEFAULT_BOT_CLAIM_MAX_MS = 6_000;

/** Resolve a per-bot claim-submission delay. The default is a random
 *  draw from `[MIN, MAX]` (2–6 s in production); when
 *  `__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__` is set, every bot uses the
 *  same fixed delay so tests can pin the timeline deterministically. */
export function botClaimDelayMs(): number {
  const override = globalThis.__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__;
  if (typeof override === 'number') return override;
  const range = DEFAULT_BOT_CLAIM_MAX_MS - DEFAULT_BOT_CLAIM_MIN_MS;
  return DEFAULT_BOT_CLAIM_MIN_MS + Math.random() * range;
}

/**
 * In-process transport: skips the WebSocket entirely and runs an
 * authoritative engine loop locally. The user is always seated as 0
 * with three bots (heuristic, simple, passive) in seats 1–3. Used by
 * the lobby's "Play vs bots" flow for a single-player practice match.
 *
 * The bot-stepping logic is shared with `MatchSession` via
 * `runBotTurns` from `@mahjong/bots`. Solo skips the lobby/host/
 * disconnect plumbing — there's no one else to coordinate with.
 */
export function createSoloTransport(opts: SoloOptions): Transport & SoloTransportControls {
  // Solo strips the soft-expiry / hard-fallback claim windows so the
  // user gets infinite time to claim. The per-turn timer (when the
  // rule isn't `0` / "∞") is honoured client-side: the engine stamps
  // `state.turnDeadlineMs`, the UI surfaces "Ns left", and the
  // transport schedules an in-process auto-discard via
  // `passiveBot.pickDiscard` when the deadline elapses on the user's
  // turn — mirroring the server's `forceTurnAutoDiscard` so a stalled
  // solo seat behaves the same as a stalled online seat.
  const turnOverride = globalThis.__MAHJONG_TEST_TURN_TIMEOUT_MS__;
  const soloRules = {
    ...soloRulesFrom(),
    ...(typeof turnOverride === 'number' ? { turnTimeoutMs: turnOverride } : {}),
  };
  let state: GameState = opts.seedState ?? emptyState(soloRules);
  const initialSkills = opts.botSkills ?? DEFAULT_BOT_SKILLS;
  const botKinds: Record<1 | 2 | 3, BotKind> = {
    1: initialSkills[0],
    2: initialSkills[1],
    3: initialSkills[2],
  };
  // Random first-name per bot seat, chosen once at transport creation
  // and held stable across `setBotSkill` calls — the seat keeps the
  // same character even when the host swaps its difficulty between
  // hands. The user's own displayName is fed into the taken-set so
  // the bot pool never collides with the seated human's name.
  const botName1 = pickRandomBotName([opts.displayName]);
  const botName2 = pickRandomBotName([opts.displayName, botName1]);
  const botName3 = pickRandomBotName([opts.displayName, botName1, botName2]);
  const botNames: Record<1 | 2 | 3, string> = {
    1: botName1,
    2: botName2,
    3: botName3,
  };
  const bots: Record<Seat, Bot | null> = {
    0: null,
    1: withTestScript(1, botRegistry[botKinds[1]]),
    2: withTestScript(2, botRegistry[botKinds[2]]),
    3: withTestScript(3, botRegistry[botKinds[3]]),
  };
  const messageListeners = new Set<(m: ServerMessage) => void>();
  const statusListeners = new Set<(s: TransportStatus) => void>();
  let _status: TransportStatus = 'open';
  let closed = false;
  let pacingHandle: ReturnType<typeof setTimeout> | null = null;
  /** setTimeout for auto-discarding the user's turn when
   *  `state.turnDeadlineMs` elapses with no input. Solo's
   *  client-side equivalent of the server's
   *  `MatchSession.forceTurnAutoDiscard`. */
  let turnTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  /** Per-bot scheduled-claim handles. Each non-discarder bot with a
   *  meaningful claim gets a random 2–6 s timer; firing applies the
   *  bot's pick and re-enters the bot loop. Cleared on close or when
   *  the claim window resolves (no-op if already null). */
  const claimHandles: Record<Seat, ReturnType<typeof setTimeout> | null> = {
    0: null,
    1: null,
    2: null,
    3: null,
  };

  const DEFAULT_BOT_PACE_MS = 3_000;
  // Solo claim pacing — `botClaimDelayMs()` gives each bot that wants
  // to claim a random delay in `[MIN, MAX]` (2–6 s in production)
  // before submitting. The variance prevents "all bots resolve in
  // the same frame" when several seats can act on the same discard,
  // and gives the user a visible window between the discard and any
  // resolution. Overridable to a fixed delay via
  // `__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__`. When no bot wants to claim
  // there's no pause — the next bot's draw fires immediately and the
  // "thinking gap" (`botPaceMs`, 3 s) before its discard provides
  // the read window for the user's just-thrown tile.

  function emit(m: ServerMessage) {
    for (const cb of messageListeners) cb(m);
  }

  function applyAction(action: Action) {
    const { state: next, events } = reduce(state, action);
    state = next;
    emit({ t: 'delta', events, state });
    rescheduleTurnTimeout();
    // Drop any per-bot claim timers as soon as the claim window
    // closes — otherwise a stale timer from a previous round would
    // fire 2–6 s later into the wrong phase and no-op via the
    // in-callback phase guard, leaking handles in the meantime.
    if (state.phase !== 'awaitingClaims') clearClaimHandles();
  }

  // Solo intentionally has **no claim-window alarm**. The user gets
  // infinite time to choose an action; the hand advances the instant
  // the user clicks pass / a claim, and never before.
  //
  // The engine handles claim resolution reactively: the `discard`
  // reducer pre-fills `submitted` with passes for any seat that has
  // no meaningful claim, and `declareClaim` folds in a `resolveClaims`
  // call once every non-discarder seat is accounted for.
  //
  // Bot turns are *paced* — `BOT_TURN_PAUSE_MS` between draw and
  // discard so the user can actually read what each opponent threw.
  // Claim submissions stay instant; they don't have visible weight on
  // their own (the felt only updates when the round resolves).

  function clearPacing() {
    if (pacingHandle !== null) {
      clearTimeout(pacingHandle);
      pacingHandle = null;
    }
  }

  function clearTurnTimeout() {
    if (turnTimeoutHandle !== null) {
      clearTimeout(turnTimeoutHandle);
      turnTimeoutHandle = null;
    }
  }

  function clearClaimHandles() {
    for (const s of SEATS) {
      const h = claimHandles[s];
      if (h !== null) {
        clearTimeout(h);
        claimHandles[s] = null;
      }
    }
  }

  /** Re-arm the user's turn-timeout timer based on the current
   *  `state.turnDeadlineMs`. Called after every applyAction; clears
   *  any stale timer first so re-entries (e.g. user discards mid-
   *  turn) don't leak. No-op when the rule is off, the hand is over,
   *  or it isn't seat 0's turn. */
  function rescheduleTurnTimeout() {
    clearTurnTimeout();
    if (closed) return;
    if (state.phase !== 'turn' || state.turn !== 0) return;
    const deadline = state.turnDeadlineMs;
    if (deadline === undefined) return;
    const delay = Math.max(0, deadline - Date.now());
    turnTimeoutHandle = setTimeout(() => {
      turnTimeoutHandle = null;
      if (closed) return;
      if (state.phase !== 'turn' || state.turn !== 0) return;
      // Mirror the server's behaviour: ensure the user has drawn,
      // then discard via passiveBot. The user could legitimately
      // win on the auto-discarded tile, but `passiveBot.pickDiscard`
      // never picks a winning tile (passive isn't strategy-aware
      // beyond "discard a safe-looking tile"), so the engine would
      // throw FAAN/SHAPE if we tried `declareWin` first — match the
      // server's plain discard path instead.
      try {
        if (!state.hasDrawn) {
          applyAction({ t: 'draw', seat: 0 });
          if (state.phase !== 'turn') {
            runBots();
            return;
          }
        }
        const tile = passiveBot.pickDiscard({ state, seat: 0 });
        applyAction({ t: 'discard', seat: 0, tile });
        runBots();
      } catch (e) {
        if (!(e instanceof IllegalActionError)) throw e;
      }
    }, delay);
  }

  function botPaceMs(): number {
    const override = globalThis.__MAHJONG_TEST_BOT_PACE_MS__;
    return typeof override === 'number' ? override : DEFAULT_BOT_PACE_MS;
  }

  function runBots() {
    clearPacing();
    driveBots();
  }

  function driveBots() {
    if (closed) return;

    // 1. Stagger bot claim submissions over a random 2–6 s window so
    //    the user sees the discard land before any resolution kicks
    //    in, and so multiple bots competing for the same tile resolve
    //    in different frames rather than all-at-once. Each
    //    unsubmitted bot gets at most one scheduled timer; firing
    //    re-enters the loop, which will schedule any newly-required
    //    submissions (e.g. a promoted-gang rob window the resolution
    //    opens). Returns without looping — bot turns wait until the
    //    last claim timer fires.
    if (state.phase === 'awaitingClaims' && state.pendingClaims) {
      for (const seat of SEATS) {
        // Live-read the engine state each iteration: an in-loop
        // `applyAction` (the synchronous pass submission below) can
        // flip `state.phase` away from 'awaitingClaims' or clear
        // `state.pendingClaims`, and any further reads off the
        // closure-captured `pending` would target stale data.
        if (state.phase !== 'awaitingClaims' || !state.pendingClaims) break;
        const pending = state.pendingClaims;
        if (seat === pending.discard.from) continue;
        const bot = bots[seat];
        if (!bot) continue;
        if (pending.submitted[seat]) continue;
        if (claimHandles[seat] !== null) continue;
        // Pre-compute the bot's pick so we can short-circuit passes.
        // The engine pre-fills passes for seats with no *legal* claim,
        // but a bot whose strategy chooses to pass on a discard it
        // *could* claim (e.g. `passiveBot.pickClaim` always returns
        // pass) still needs to submit through this path — which used
        // to wait a full 2-6 s stagger before firing the pass. In a
        // 3-passive-bot match, every bot's claim window stalled by
        // up to 6 s of pure dead time. Submit passes instantly; only
        // stagger meaningful claims, where the 2-6 s variance
        // genuinely lets the user see the discard before the
        // resolution kicks in. Throws here predate `setTimeout` so
        // they propagate normally — the engine + IllegalActionError
        // path stays the same.
        let pick: ReturnType<typeof bot.pickClaim>;
        try {
          pick = bot.pickClaim({ state, seat });
        } catch (e) {
          if (!(e instanceof IllegalActionError)) {
            console.error('solo bot claim error', e);
          }
          pick = { kind: 'pass' };
        }
        if (pick.kind === 'pass') {
          try {
            applyAction({ t: 'declareClaim', seat, claim: pick });
          } catch (e) {
            if (!(e instanceof IllegalActionError)) {
              console.error('solo bot claim error', e);
            }
          }
          continue;
        }
        const delay = botClaimDelayMs();
        claimHandles[seat] = setTimeout(() => {
          claimHandles[seat] = null;
          if (closed) return;
          if (state.phase !== 'awaitingClaims' || !state.pendingClaims) return;
          if (state.pendingClaims.submitted[seat]) return;
          try {
            applyAction({ t: 'declareClaim', seat, claim: pick });
          } catch (e) {
            // Anything that isn't an IllegalActionError used to re-throw,
            // but a throw from inside a setTimeout callback becomes an
            // uncaught exception — the round would stall in
            // `awaitingClaims` with no UI signal and the user couldn't
            // continue without a reload. Log + treat as if the bot
            // passed; the engine resolves the round once the remaining
            // submissions are in (or the seat is forced to pass via the
            // next driveBots cycle).
            if (!(e instanceof IllegalActionError)) {
              console.error('solo bot claim error', e);
            }
          }
          driveBots();
        }, delay);
      }
      // After scheduling: if every bot's pick was a pass we just
      // submitted them synchronously above, which may have resolved
      // the window already. Re-enter the loop so the next bot's turn
      // fires immediately rather than waiting for a tick — but yield
      // through `queueMicrotask` to match the boot-site setTimeout(…,0)
      // yield discipline and prevent a deep synchronous re-entry from
      // the loop's own iteration into another full loop body.
      if (state.phase !== 'awaitingClaims') {
        queueMicrotask(() => driveBots());
      }
      return;
    }
    if (closed) return;

    // 2. We're either in 'turn' for a bot, in 'turn' for the user, or
    //    the hand has resolved. Stop unless it's a bot's turn.
    if (state.phase !== 'turn') return;
    const seat = state.turn;
    const bot = bots[seat];
    if (!bot) return; // user's turn — wait for explicit action

    // 3. Apply the draw immediately so the new tile slides in. Then
    //    pause `botPaceMs` (the "thinking" gap) before the discard.
    if (!state.hasDrawn) {
      applyAction({ t: 'draw', seat });
      // A draw on the last live tile may resolve the hand straight to
      // 'resolved'; bail out without scheduling a discard.
      if (state.phase !== 'turn') {
        driveBots();
        return;
      }
    }
    pacingHandle = setTimeout(
      () => {
        pacingHandle = null;
        if (closed) return;
        if (state.phase !== 'turn') return;
        const turnSeat = state.turn;
        const turnBot = bots[turnSeat];
        if (!turnBot) return;
        // Try a self-draw win first; the engine throws SHAPE/FAAN if
        // the hand isn't actually winning, which we treat as "fall
        // through to a normal discard". Same idea as `bots/run.ts`.
        try {
          applyAction({ t: 'declareWin', seat: turnSeat, selfDraw: true });
          driveBots();
          return;
        } catch (e) {
          if (!(e instanceof IllegalActionError)) throw e;
        }
        // Scripted own-turn promoted gang. Consumed BEFORE pickDiscard so
        // a lesson can engineer the rob-the-kong flow: the bot has a
        // pre-existing peng meld + the matching fourth tile in hand,
        // and we want it to promote instead of discarding. The script
        // entry is popped only when the preconditions hold (peng of
        // the face is present in melds AND a copy of the face is in
        // hand); otherwise it stays queued and we fall through to a
        // normal discard for this turn. The existing pickClaim /
        // pickDiscard shims can't reach this path — promoted-gang
        // fires from `actions.ts:557` on the bot's own turn, after a
        // draw and before any discard would be picked.
        const script = globalThis.__MAHJONG_TEST_BOT_SCRIPTS__?.[turnSeat];
        const nextPromotion = script?.promotions?.[0];
        if (nextPromotion) {
          const promoFace = nextPromotion.tile;
          const hasMatchingPeng = state.melds[turnSeat].some(
            (m) => m.kind === 'peng' && m.tiles.some((t) => sameFace(t, promoFace)),
          );
          const hasMatchingTile = state.hands[turnSeat].some((t) => sameFace(t, promoFace));
          if (hasMatchingPeng && hasMatchingTile) {
            // Consume the entry off the queue. Mutating the live array
            // is fine — we own the script object via `__MAHJONG_TEST_BOT_SCRIPTS__`
            // and the same shape is read again on the bot's next turn.
            script.promotions!.shift();
            try {
              applyAction({ t: 'declareGangPromoted', seat: turnSeat, tile: promoFace });
              driveBots();
              return;
            } catch (e) {
              if (!(e instanceof IllegalActionError)) throw e;
              // Promotion threw IllegalActionError despite the precond
              // check above — treat as "fall through to pickDiscard"
              // so the bot turn doesn't hang.
            }
          }
        }
        const tile = turnBot.pickDiscard({ state, seat: turnSeat });
        applyAction({ t: 'discard', seat: turnSeat, tile });
        driveBots();
      },
      Math.max(0, botPaceMs()),
    );
  }

  function emitLobby() {
    emit({
      t: 'lobby',
      players: [
        {
          playerId: opts.playerId,
          displayName: opts.displayName,
          seat: 0,
          connected: true,
          isBot: false,
        },
        {
          playerId: BOT_PLAYER_IDS[0],
          displayName: botNames[1],
          seat: 1,
          connected: true,
          isBot: true,
          botKind: botKinds[1],
        },
        {
          playerId: BOT_PLAYER_IDS[1],
          displayName: botNames[2],
          seat: 2,
          connected: true,
          isBot: true,
          botKind: botKinds[2],
        },
        {
          playerId: BOT_PLAYER_IDS[2],
          displayName: botNames[3],
          seat: 3,
          connected: true,
          isBot: true,
          botKind: botKinds[3],
        },
      ],
      host: opts.playerId,
      rules: state.rules,
    });
  }

  // Defer the initial state/lobby emission until after the caller has had a
  // chance to subscribe via onMessage. Without this, the synchronous emit
  // would fire into a Set that's still empty. Track the handle so
  // `close()` can cancel it — otherwise a transport closed before the
  // tick fires would still emit + run bots, leaking work into a dead
  // session.
  let initHandle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    initHandle = null;
    if (closed) return;
    emit({ t: 'state', state, you: 0 });
    emitLobby();
    // Resume case: if the seed state says it's already a bot's turn (or
    // a claim window is open with bots to submit), kick the loop so the
    // match picks up where it left off. No-op for fresh launches —
    // `emptyState` parks at `phase: 'waiting'` until `startHand`.
    runBots();
    // Resume case: if the snapshot landed mid-turn for the user, the
    // turn-timeout timer needs to re-arm against the persisted
    // deadline. No-op for fresh-`emptyState` launches.
    rescheduleTurnTimeout();
  }, 0);

  return {
    send(msg) {
      if (closed) return;
      if (msg.t === 'chat') {
        // Mirror `MatchSession.onChat`: trim, drop empties, echo back to
        // listeners as a broadcast so `ChatBubbles` renders a bubble at
        // the user's seat. There's no server in solo, so the user just
        // talks to themselves — but the UI should still respond.
        const trimmed = msg.text.slice(0, 280);
        if (trimmed.length === 0) return;
        emit({ t: 'chat', from: 0, text: trimmed, ts: Date.now() });
        return;
      }
      if (msg.t !== 'action') return;
      try {
        applyAction(msg.action);
        // When the user's discard had no bot claim contest, the
        // engine's `allIn` fast path put state back into `phase:
        // 'turn'` for the next seat — drive the bot loop immediately.
        // The next bot's "thinking gap" (`botPaceMs` between draw
        // and discard, default 3 s) covers the user's read window
        // for the just-thrown tile.
        runBots();
      } catch (e) {
        if (e instanceof IllegalActionError) {
          emit({ t: 'error', code: e.code, detail: e.message });
        } else {
          console.error('solo session error', e);
        }
      }
    },
    onMessage(cb) {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onStatus(cb) {
      statusListeners.add(cb);
      cb(_status);
      return () => statusListeners.delete(cb);
    },
    status() {
      return _status;
    },
    close() {
      closed = true;
      if (initHandle !== null) {
        clearTimeout(initHandle);
        initHandle = null;
      }
      clearPacing();
      clearTurnTimeout();
      clearClaimHandles();
      _status = 'closed';
      for (const cb of statusListeners) cb(_status);
    },
    /** Live-update one bot seat's strategy. The lobby waiting room
     *  uses this to let the user dial each bot's skill before the
     *  hand starts. Re-emits the lobby message so the LobbyPreview
     *  picks up the new bot name. Only takes effect for new
     *  decisions — a hand already in flight keeps using the bot
     *  whose closure is in-flight, but we only allow this between
     *  hands so that's a non-issue in practice. */
    setBotSkill(seat: 1 | 2 | 3, kind: BotKind) {
      if (closed) return;
      botKinds[seat] = kind;
      bots[seat] = withTestScript(seat, botRegistry[kind]);
      emitLobby();
    },
  };
}

/**
 * Wrap a bot so that — when the e2e test override
 * `globalThis.__MAHJONG_TEST_BOT_SCRIPTS__[seat]` is set — its next
 * `pickDiscard` / `pickClaim` calls are pulled from the script and
 * the wrapped bot is only consulted as a fallback. The script is
 * read on every call so a test can mutate it via
 * `page.evaluate(() => globalThis.__MAHJONG_TEST_BOT_SCRIPTS__[1] = …)`
 * mid-match (e.g. after reading the dealt hand). In production the
 * global is undefined and this is a thin pass-through.
 */
function withTestScript(seat: Seat, fallback: Bot): Bot {
  return {
    kind: fallback.kind,
    pickDiscard(view) {
      const script = globalThis.__MAHJONG_TEST_BOT_SCRIPTS__?.[seat];
      const target = script?.discards?.shift();
      if (target) {
        const found = view.state.hands[view.seat].find((t) => sameFace(t, target));
        if (found) return found;
      }
      return fallback.pickDiscard(view);
    },
    pickClaim(view) {
      const script = globalThis.__MAHJONG_TEST_BOT_SCRIPTS__?.[seat];
      const target = script?.claims?.shift();
      if (target) return target;
      return fallback.pickClaim(view);
    },
  };
}
