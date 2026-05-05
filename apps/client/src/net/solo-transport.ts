import { type Bot, heuristicBot, passiveBot, runBotTurns, simpleBot } from '@mahjong/bots';
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
}

const BOT_PLAYER_IDS = ['bot-1', 'bot-2', 'bot-3'] as const;

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
export function createSoloTransport(opts: SoloOptions): Transport {
  let state: GameState = emptyState(DEFAULT_RULES);
  const bots: Record<Seat, Bot | null> = {
    0: null,
    1: withTestScript(1, heuristicBot),
    2: withTestScript(2, simpleBot),
    3: withTestScript(3, passiveBot),
  };
  const messageListeners = new Set<(m: ServerMessage) => void>();
  const statusListeners = new Set<(s: TransportStatus) => void>();
  let _status: TransportStatus = 'open';
  let alarmHandle: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function emit(m: ServerMessage) {
    for (const cb of messageListeners) cb(m);
  }

  function applyAction(action: Action) {
    const { state: next, events } = reduce(state, action);
    state = next;
    emit({ t: 'delta', events, state });
  }

  function runBots() {
    runBotTurns(() => state, bots, applyAction);
  }

  function scheduleAlarm() {
    if (alarmHandle !== null) {
      clearTimeout(alarmHandle);
      alarmHandle = null;
    }
    if (closed) return;
    if (state.phase !== 'awaitingClaims' || !state.pendingClaims) return;
    const delay = Math.max(0, state.pendingClaims.deadlineMs - Date.now());
    alarmHandle = setTimeout(() => {
      alarmHandle = null;
      if (closed) return;
      try {
        applyAction({ t: 'resolveClaims', nowMs: Date.now() });
        runBots();
      } catch (e) {
        console.error('solo alarm error', e);
      }
      scheduleAlarm();
    }, delay);
  }

  // Defer the initial state/lobby emission until after the caller has had a
  // chance to subscribe via onMessage. Without this, the synchronous emit
  // would fire into a Set that's still empty.
  setTimeout(() => {
    if (closed) return;
    emit({ t: 'state', state, you: 0 });
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
          displayName: `Bot (${heuristicBot.kind})`,
          seat: 1,
          connected: true,
          isBot: true,
        },
        {
          playerId: BOT_PLAYER_IDS[1],
          displayName: `Bot (${simpleBot.kind})`,
          seat: 2,
          connected: true,
          isBot: true,
        },
        {
          playerId: BOT_PLAYER_IDS[2],
          displayName: `Bot (${passiveBot.kind})`,
          seat: 3,
          connected: true,
          isBot: true,
        },
      ],
      host: opts.playerId,
      rules: state.rules,
    });
  }, 0);

  return {
    send(msg) {
      if (closed) return;
      if (msg.t !== 'action') return;
      try {
        applyAction(msg.action);
        runBots();
        scheduleAlarm();
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
      if (alarmHandle !== null) {
        clearTimeout(alarmHandle);
        alarmHandle = null;
      }
      _status = 'closed';
      for (const cb of statusListeners) cb(_status);
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
