import { type Bot, heuristicBot, passiveBot, runBotTurns, simpleBot } from '@mahjong/bots';
import {
  type Action,
  DEFAULT_RULES,
  type GameState,
  IllegalActionError,
  type Seat,
  emptyState,
  reduce,
} from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
import type { Transport, TransportStatus } from './transport';

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
    1: heuristicBot,
    2: simpleBot,
    3: passiveBot,
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
