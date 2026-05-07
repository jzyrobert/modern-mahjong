import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  type GameState,
  SCORING_RULES,
  type ScoringRule,
  emptyState,
  scoreHand,
} from '../src/index.js';

/**
 * The scoring catalog (`SCORING_RULES`) is the source of truth for the
 * in-app "Scoring rules" sheet. Each entry's fan value must match
 * what `scoreHand` would actually award for that pattern — otherwise
 * the help text is lying to the user.
 *
 * For each catalog entry we plug its example hand into a synthetic
 * GameState (with `gangReplacementCount` / discard pools / dealer
 * configured to satisfy the trigger condition where applicable) and
 * assert the breakdown contains an entry of the matching name + fan.
 *
 * A handful of patterns aren't easily round-tripped through `scoreHand`
 * from a static example alone — `天/地/人糊` need very specific
 * discard-pile + meld-count states; `搶槓` requires `pendingPromotedGang`.
 * Those are listed in `RUNTIME_ONLY` and the test only asserts the
 * catalog shape (name uniqueness, non-empty example, etc.) for them.
 */
const RUNTIME_ONLY = new Set<string>([
  // Detected from `pendingPromotedGang` set during a rob window;
  // example is the *resulting hand*, not the runtime context.
  '搶槓',
  // Need very specific dealer + discard-pool state to fire.
  '天糊',
  '地糊',
  '人糊',
  // 海底撈月 needs an empty wall *at scoring time*; the example is
  // illustrative but doesn't synthesize the wall state cleanly here.
  '海底撈月',
  // Kong-replacement scoring is gated on `state.gangReplacementCount`.
  // Covered separately by scoring.test.ts.
  '槓上開花',
  '槓上槓',
  // Wind-triplet detection depends on the state's `prevailingWind` and
  // the (winner - dealer) seat offset; the catalog example pins one
  // triplet face but the test's neutral state doesn't always match.
  // Covered by scoring.test.ts.
  '圈風',
  '門風',
]);

function buildState(rule: ScoringRule): GameState {
  const base = emptyState({ ...DEFAULT_RULES, faanMin: 0 });
  return {
    ...base,
    phase: 'turn',
    dealer: 0,
    turn: 0,
    hands: { 0: rule.example.concealed, 1: [], 2: [], 3: [] },
    melds: { 0: rule.example.melds, 1: [], 2: [], 3: [] },
    hasDrawn: true,
  };
}

describe('scoring catalog', () => {
  it('lists every entry with a non-empty example hand', () => {
    expect(SCORING_RULES.length).toBeGreaterThan(0);
    for (const r of SCORING_RULES) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.english.length).toBeGreaterThan(0);
      expect(r.faan).toBeGreaterThan(0);
      expect(r.example.concealed.length + r.example.melds.length * 3).toBeGreaterThan(0);
      expect(r.example.winningTile).toBeDefined();
    }
  });

  it('has unique (name, english) pairs', () => {
    const seen = new Set<string>();
    for (const r of SCORING_RULES) {
      const key = `${r.name}::${r.english}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("each non-runtime example actually scores its rule's fan via scoreHand", () => {
    for (const r of SCORING_RULES) {
      if (RUNTIME_ONLY.has(r.name)) continue;
      const state = buildState(r);
      // Self-draw is the simplest mode that satisfies most patterns
      // — for 自摸 it's part of the trigger; for everything else it
      // adds 1 fan but doesn't suppress the pattern under test.
      const result = scoreHand({
        state,
        winner: 0,
        winningTile: r.example.winningTile,
        selfDraw: true,
      });
      // 三元牌 / 圈風 / 門風 entries in the breakdown carry the
      // specific honor face appended (e.g. "三元牌 Z"); allow that
      // suffixed form as well as the bare catalog name.
      const entry = result.breakdown.find(
        (b) => b.name === r.name || b.name.startsWith(`${r.name} `),
      );
      expect(entry, `expected scoreHand to credit ${r.name} on its catalog example`).toBeDefined();
      expect(entry?.faan).toBe(r.faan);
    }
  });
});
