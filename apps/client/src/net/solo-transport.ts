import { type Bot, type BotKind, bots as botRegistry, runBotTurns } from '@mahjong/bots';
import {
  type Action,
  type Claim,
  DEFAULT_RULES,
  type GameState,
  IllegalActionError,
  type Seat,
  type Tile,
  emptyState,
  reduce,
  sameFace,
} from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
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
}

interface SoloOptions {
  playerId: string;
  displayName: string;
  /** Per-seat bot kind for seats 1..3. Defaults to the historical
   *  mix `[heuristic, simple, passive]` so callers that haven't
   *  opted into custom skills get the same behaviour as before. */
  botSkills?: [BotKind, BotKind, BotKind];
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
  // Solo strips the soft-expiry / hard-fallback windows so the user
  // gets infinite time to claim. The engine's `declareClaim` checks
  // `hardDeadlineMs === undefined` to skip the fairness gate, and
  // resolves on all-submitted regardless of `deadlineMs`.
  const {
    claimSoftWindowMs: _omitSoft,
    claimHardWindowMs: _omitHard,
    ...soloRules
  } = DEFAULT_RULES;
  void _omitSoft;
  void _omitHard;
  let state: GameState = emptyState(soloRules);
  const initialSkills = opts.botSkills ?? DEFAULT_BOT_SKILLS;
  const botKinds: Record<1 | 2 | 3, BotKind> = {
    1: initialSkills[0],
    2: initialSkills[1],
    3: initialSkills[2],
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

  function emit(m: ServerMessage) {
    for (const cb of messageListeners) cb(m);
  }

  function applyAction(action: Action) {
    const { state: next, events } = reduce(state, action);
    state = next;
    emit({ t: 'delta', events, state });
  }

  // Solo intentionally has **no claim-window alarm**. The user gets
  // infinite time to choose an action; the hand advances the instant
  // the user clicks pass / a claim, and never before.
  //
  // The engine handles the rest reactively: the `discard` reducer
  // pre-fills `submitted` with passes for any seat that has no
  // meaningful claim against the discard, and `declareClaim` folds in
  // a `resolveClaims` call once every non-discarder seat is in
  // `submitted` (which, in solo, happens the moment bots react +
  // the user explicitly submits).

  function runBots() {
    runBotTurns(() => state, bots, applyAction);
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
          displayName: `Bot (${botKinds[1]})`,
          seat: 1,
          connected: true,
          isBot: true,
        },
        {
          playerId: BOT_PLAYER_IDS[1],
          displayName: `Bot (${botKinds[2]})`,
          seat: 2,
          connected: true,
          isBot: true,
        },
        {
          playerId: BOT_PLAYER_IDS[2],
          displayName: `Bot (${botKinds[3]})`,
          seat: 3,
          connected: true,
          isBot: true,
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
  }, 0);

  return {
    send(msg) {
      if (closed) return;
      if (msg.t !== 'action') return;
      try {
        applyAction(msg.action);
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
