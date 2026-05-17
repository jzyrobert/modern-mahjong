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
   *  semantics as `discards`. */
  claims?: Claim[];
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
  /** Soft floor between a user discard the engine auto-resolved and
   *  the next bot draw (no claim contest to provide the gap). */
  let userDiscardFloorHandle: ReturnType<typeof setTimeout> | null = null;

  const DEFAULT_BOT_PACE_MS = 3_000;
  // Solo claim pacing — online uses the soft floor + alarm ladder
  // on the server; in solo there's nobody to coordinate with, so we
  // recreate the "you have time to read this discard" pause locally:
  //
  //   - `CLAIM_FLOOR_MS` — minimum gap between a user discard the
  //     engine auto-resolved (no bot had a meaningful claim) and the
  //     next bot draw. Without it, the next-bot's draw fires the same
  //     frame as the user's tile lands on the pile, blowing past the
  //     user's read window.
  //   - `BOT_CLAIM_MIN_MS` / `BOT_CLAIM_MAX_MS` — each bot that wants
  //     to claim picks a random delay in this range before submitting
  //     its claim. The variance prevents the "all bots resolve in the
  //     same frame" surprise when several seats can act on the same
  //     discard, and the floor gives the user a visible window
  //     between the discard and any resolution.
  const CLAIM_FLOOR_MS = 3_000;
  const BOT_CLAIM_MIN_MS = 2_000;
  const BOT_CLAIM_MAX_MS = 6_000;

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

  function clearUserDiscardFloor() {
    if (userDiscardFloorHandle !== null) {
      clearTimeout(userDiscardFloorHandle);
      userDiscardFloorHandle = null;
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
      const pending = state.pendingClaims;
      for (const seat of SEATS) {
        if (seat === pending.discard.from) continue;
        const bot = bots[seat];
        if (!bot) continue;
        if (pending.submitted[seat]) continue;
        if (claimHandles[seat] !== null) continue;
        const range = BOT_CLAIM_MAX_MS - BOT_CLAIM_MIN_MS;
        const delay = BOT_CLAIM_MIN_MS + Math.random() * range;
        claimHandles[seat] = setTimeout(() => {
          claimHandles[seat] = null;
          if (closed) return;
          if (state.phase !== 'awaitingClaims' || !state.pendingClaims) return;
          if (state.pendingClaims.submitted[seat]) return;
          const claim = bot.pickClaim({ state, seat });
          try {
            applyAction({ t: 'declareClaim', seat, claim });
          } catch (e) {
            if (!(e instanceof IllegalActionError)) throw e;
          }
          driveBots();
        }, delay);
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
  // would fire into a Set that's still empty.
  setTimeout(() => {
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
        const wasUserDiscard = msg.action.t === 'discard' && msg.action.seat === 0;
        const phaseBefore = state.phase;
        applyAction(msg.action);
        // Soft floor: when the user discarded a tile no bot wanted to
        // claim, the engine auto-resolved the claim window inline
        // (`discard` reducer's `allIn` fast path) and state is
        // already back in `phase: 'turn'` for the next seat. Without
        // a pause here, `runBots()` fires the next-bot draw the same
        // frame as the user's tile lands on the pile — the user
        // never sees their own discard sit on the felt. Hold for
        // `CLAIM_FLOOR_MS` so the discard reads as a deliberate
        // move. When at least one bot DID claim, the bot-claim
        // stagger (2–6 s per bot, scheduled in `driveBots`) provides
        // the read window instead and this branch is skipped (state
        // would still be `awaitingClaims`).
        const floorApplies = wasUserDiscard && phaseBefore === 'turn' && state.phase === 'turn';
        if (floorApplies) {
          clearUserDiscardFloor();
          userDiscardFloorHandle = setTimeout(() => {
            userDiscardFloorHandle = null;
            if (closed) return;
            runBots();
          }, CLAIM_FLOOR_MS);
        } else {
          runBots();
        }
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
      clearPacing();
      clearTurnTimeout();
      clearClaimHandles();
      clearUserDiscardFloor();
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
