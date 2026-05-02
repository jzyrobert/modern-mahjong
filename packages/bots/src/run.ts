import {
  type Action,
  type GameState,
  IllegalActionError,
  SEATS,
  type Seat,
} from '@mahjong/game-logic';
import type { Bot } from './index.js';

const TICK_LIMIT = 16;

/**
 * Drive every bot-controlled seat forward through the engine until no
 * progress can be made (or we hit the safety bound). Each step:
 *
 * - If `awaitingClaims`, every non-discarder bot submits a claim/pass.
 * - On a bot's turn, the bot draws if it hasn't yet, attempts a self-draw
 *   win, and otherwise picks a discard.
 *
 * Used by both the server's `MatchSession` (online + LAN) and the client's
 * `createSoloTransport` (single-player). The two callers diverge wildly in
 * how they dispatch broadcasts (DO outbounds vs. local emit) but the
 * engine-step logic itself is identical and lives here.
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
  if (state.phase === 'awaitingClaims' && state.pendingClaims) {
    let progressed = false;
    const pending = state.pendingClaims;
    for (const seat of SEATS) {
      if (seat === state.lastDiscard?.from) continue;
      const bot = bots[seat];
      if (!bot) continue;
      if (pending.submitted[seat]) continue;
      const claim = bot.pickClaim({ state, seat });
      apply({ t: 'declareClaim', seat, claim });
      progressed = true;
    }
    return progressed;
  }
  if (state.phase === 'turn') {
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
  return false;
}
