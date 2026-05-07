import { type Action, type GameState, IllegalActionError, type Seat } from '@mahjong/game-logic';
import type { Bot } from './index.js';

const TICK_LIMIT = 16;

/**
 * Drive every bot-controlled seat forward through the engine while it's
 * their turn. Each step: the bot draws if it hasn't yet, attempts a
 * self-draw win, and otherwise picks a discard.
 *
 * Claim-window submissions are deliberately *not* handled here — both
 * callers (server `MatchSession` and client solo transport) drive bot
 * claims through their own code path so they can control timer fairness
 * (server: bots stay silent until humans submit / hard fallback fires;
 * solo: bots submit instantly because there are no other humans).
 *
 * `apply(action)` is expected to run the action through `reduce`, persist
 * the resulting state, and emit whatever delta the caller needs. Throws
 * propagate (the caller decides what to do with `IllegalActionError`).
 */
export function runBotTurns(
  getState: () => GameState,
  bots: Record<Seat, Bot | null>,
  apply: (action: Action) => void,
): void {
  for (let i = 0; i < TICK_LIMIT; i++) {
    if (!tickOnce(getState, bots, apply)) return;
  }
}

function tickOnce(
  getState: () => GameState,
  bots: Record<Seat, Bot | null>,
  apply: (action: Action) => void,
): boolean {
  const state = getState();
  if (state.phase !== 'turn') return false;
  const seat = state.turn;
  const bot = bots[seat];
  if (!bot) return false;
  if (!state.hasDrawn) {
    apply({ t: 'draw', seat });
    if (getState().phase !== 'turn') return true;
  }
  // Try a self-draw win first; the engine throws SHAPE/FAAN if illegal,
  // which we treat as "fall through to a normal discard". A predicate
  // would be cleaner but `declareWin` does both shape + faan-min + score
  // in one place and we'd otherwise duplicate that here.
  try {
    apply({ t: 'declareWin', seat, selfDraw: true });
    return true;
  } catch (e) {
    if (!(e instanceof IllegalActionError)) throw e;
  }
  const tile = bot.pickDiscard({ state: getState(), seat });
  apply({ t: 'discard', seat, tile });
  return true;
}
