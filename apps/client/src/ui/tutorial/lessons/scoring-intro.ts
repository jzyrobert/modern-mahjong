import type { GameState, HandResult, Meld, Tile } from '@mahjong/game-logic';
import { scoreHand } from '@mahjong/game-logic';
import type { Lesson } from '../types';

/**
 * Scoring-intro (番數入門) lesson — second strategy lesson in the
 * curriculum (after `wait-shapes`). Walks the player through six
 * deterministic example hands, each captioned with the specific
 * faan rules the engine credits. Pedagogical aim: introduce what
 * counts as scoring weight in HK mahjong.
 *
 * Per plan U3 of `docs/plans/2026-05-21-002-feat-strategy-shell-extension-plan.md`,
 * this lesson exercises the `setupBeforeStep` hook (U1) at scale: six
 * staged engine-resolved states, one per faan rule, each surfaced as
 * `phase: 'resolved'` with a populated `lastResult.faanBreakdown`.
 * The ResultPanel renders the winning hand + breakdown for each.
 *
 * Faan rules demonstrated (chosen for beginner recognisability):
 *   1. 平和 (all sequences, 1 faan) + 門前清 (concealed, 1) — plain
 *      all-chow ron win.
 *   2. 對對和 (all triplets, 3 faan) — with one exposed peng so the
 *      engine doesn't promote to 四暗刻.
 *   3. 混一色 (mixed one-suit, 3 faan) + 門前清 — single suit + honors.
 *   4. 清一色 (full flush, 7 faan) + 門前清 — single suit, no honors.
 *   5. 自摸 (self-draw, 1 faan) + 平和 + 門前清 — concealed all-chow
 *      self-draw stacks three patterns.
 *   6. 海底撈月 (last tile, 1 faan) + 平和 + 門前清 + 自摸 — same shape
 *      as #5 but the wall has emptied, so the engine credits 海底撈月
 *      on top of self-draw.
 *
 * Why hand-construct `lastResult` (option (a) from the plan's Open
 * Implementation Question rather than driving the engine through a
 * synthetic `declareWin`): `declareWin` has strict preconditions
 * (`phase === 'turn'`, `hasDrawn`, `drewThisTurn`, lastDiscard for
 * ron, …) that would force us to engineer six fully-valid mid-turn
 * states. The engine's `scoreHand` helper is exported as a pure
 * function — we feed it a synthetic minimal state with the right
 * hand + melds + wall + winning-tile + selfDraw, and pin the
 * resulting `{faan, breakdown}` onto `state.lastResult`. Same
 * breakdown shape the engine would produce, fraction of the
 * staging cost. Mirror-only (per U1 safety invariant) — no engine
 * emit fires between step entry and step exit during this lesson, so
 * the staged states persist visually until the user taps Got it.
 *
 * `setupBeforeStep` uniformly on every example step (option B from
 * the plan): no `prepareState`, no asymmetry between step 1 and
 * steps 2..6. Each step independently injects a freshly-built
 * resolved state.
 *
 * CTA convention (per TutorialOverlay.tsx:283 — the Next button is
 * hidden when `completedWhen` is set): every step OMITS
 * `completedWhen` so the default "Got it" / "Done" CTAs render.
 * All steps advance manually.
 */

// ───────────────────────────────────────────────────────────────────
// Hand definitions. Each entry describes one winning hand:
//   - `concealed14` — the 14-tile concealed hand at the moment of
//     resolution (after `declareWin` would have appended the winning
//     tile). Used for the engine state mirror (`state.hands[0]`).
//   - `winningTile` — face of the tile that completed the win.
//   - `selfDraw` — whether the win is a self-draw (drives the 自摸
//     entry).
//   - `melds` — exposed melds the winner is sitting on (for hands
//     with exposed peng / chi etc).
//   - `emptyWall` — if true, mark the live wall as empty so 海底撈月
//     fires.
// ───────────────────────────────────────────────────────────────────

interface ExampleHand {
  concealed14: readonly Tile[];
  winningTile: Tile;
  selfDraw: boolean;
  melds?: readonly Meld[];
  emptyWall?: boolean;
}

const t = {
  m: (rank: number, copy = 0): Tile => ({
    kind: 'suit',
    suit: 'man',
    rank: rank as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
    copy: copy as 0 | 1 | 2 | 3,
  }),
  p: (rank: number, copy = 0): Tile => ({
    kind: 'suit',
    suit: 'pin',
    rank: rank as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
    copy: copy as 0 | 1 | 2 | 3,
  }),
  s: (rank: number, copy = 0): Tile => ({
    kind: 'suit',
    suit: 'sou',
    rank: rank as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
    copy: copy as 0 | 1 | 2 | 3,
  }),
  Z: (copy = 0): Tile => ({ kind: 'honor', honor: 'Z', copy: copy as 0 | 1 | 2 | 3 }),
};

/**
 * 平和 example — pure all-sequences ron. Pre-win 13:
 *   1m2m3m + 4m5m6m + 2p3p4p + 6p7p + 5s5s.
 * Ron 5p completes 5p6p7p. Final 14:
 *   1m2m3m + 4m5m6m + 2p3p4p + 5p6p7p + 5s5s.
 * 4 chows + non-yakuhai pair (5s5s) → 平和 (1 faan). Concealed
 * throughout → 門前清 (1 faan). Total 2 faan.
 */
const PINGHU_HAND: ExampleHand = {
  concealed14: [
    t.m(1),
    t.m(2),
    t.m(3),
    t.m(4),
    t.m(5),
    t.m(6),
    t.p(2),
    t.p(3),
    t.p(4),
    t.p(5),
    t.p(6),
    t.p(7),
    t.s(5, 0),
    t.s(5, 1),
  ],
  winningTile: t.p(5),
  selfDraw: false,
};

/**
 * 對對和 example — all triplets with ONE exposed peng so the engine
 * doesn't promote to 四暗刻. Exposed peng: 9s9s9s claimed.
 * Concealed 11 (post-win, with winning tile included): 1m1m1m +
 * 5p5p5p + 4m4m4m + 7s7s. Ron 4m completes 4m4m4m from 4m4m pair.
 * Final 14 = exposed peng 9s9s9s + concealed 1m1m1m + 5p5p5p +
 * 4m4m4m + 7s7s. All triplets + pair → 對對和 (3 faan).
 *
 * winFaceCount note: the pre-win concealed hand contains 4m × 2
 * (the pair). With exposed.length !== 0 the `isFourConcealed`
 * predicate is FALSE regardless of winFaceCount — so the engine
 * scores 對對和 rather than 四暗刻. Verified against
 * `packages/game-logic/src/scoring.ts:176`.
 */
const TOITOI_HAND: ExampleHand = {
  concealed14: [
    t.m(1, 0),
    t.m(1, 1),
    t.m(1, 2),
    t.p(5, 0),
    t.p(5, 1),
    t.p(5, 2),
    t.m(4, 0),
    t.m(4, 1),
    t.m(4, 2),
    t.s(7, 0),
    t.s(7, 1),
  ],
  winningTile: t.m(4, 2),
  selfDraw: false,
  melds: [
    {
      kind: 'peng',
      tiles: [t.s(9, 0), t.s(9, 1), t.s(9, 2)],
      from: 1,
    },
  ],
};

/**
 * 混一色 example — single suit + honor pair, concealed ron.
 * Final 14 = 1m1m1m + 2m3m4m + 5m6m7m + 7m8m9m + ZZ.
 * Ron 7m completes the 7m8m9m chow (pre-win had 8m 9m + the rest).
 * man + honor pair → 混一色 (3 faan). Honor pair is Z (red dragon)
 * but it's only a pair, not a triplet, so 三元牌 doesn't fire.
 * Stacks with 門前清 (1 faan, fully concealed).
 */
const HUN_YISE_HAND: ExampleHand = {
  concealed14: [
    t.m(1, 0),
    t.m(1, 1),
    t.m(1, 2),
    t.m(2),
    t.m(3),
    t.m(4),
    t.m(5),
    t.m(6),
    t.m(7, 0),
    t.m(7, 1),
    t.m(8),
    t.m(9),
    t.Z(0),
    t.Z(1),
  ],
  winningTile: t.m(7, 1),
  selfDraw: false,
};

/**
 * 清一色 example — single-suit, no honors, concealed ron.
 * Final 14 = 1p1p1p (pung) + 2p3p4p (chow) + 5p6p7p (chow)
 *          + 7p8p9p (chow) + 2p2p (pair).
 * Per-face counts: 1p×3, 2p×3 (one in chow + pair), 3p×1, 4p×1,
 *   5p×1, 6p×1, 7p×2 (two distinct chows), 8p×1, 9p×1. Sum = 14.
 * Ron on 4p completes the 2p-3p-4p chow. All single-suit pin →
 * 清一色 (7 faan). Stacks with 門前清 (1 faan). Total 8 faan.
 */
const QING_YISE_HAND: ExampleHand = {
  concealed14: [
    t.p(1, 0),
    t.p(1, 1),
    t.p(1, 2),
    t.p(2, 0),
    t.p(2, 1),
    t.p(2, 2),
    t.p(3),
    t.p(4),
    t.p(5),
    t.p(6),
    t.p(7, 0),
    t.p(7, 1),
    t.p(8),
    t.p(9),
  ],
  winningTile: t.p(4),
  selfDraw: false,
};

/**
 * 自摸 example — concealed all-chow self-draw.
 * Final 14 = 1m2m3m + 4m5m6m + 7m8m9m + 2s3s4s + 7p7p.
 * Self-draw on 9m. Stacks: 自摸 (1) + 平和 (1) + 門前清 (1) = 3 faan.
 * The pair (7p7p) is non-yakuhai so 平和 fires.
 */
const ZIMO_HAND: ExampleHand = {
  concealed14: [
    t.m(1),
    t.m(2),
    t.m(3),
    t.m(4),
    t.m(5),
    t.m(6),
    t.m(7),
    t.m(8),
    t.m(9),
    t.s(2),
    t.s(3),
    t.s(4),
    t.p(7, 0),
    t.p(7, 1),
  ],
  winningTile: t.m(9),
  selfDraw: true,
};

/**
 * 海底撈月 example — last-tile-from-the-wall self-draw, same chow-
 * heavy shape as `ZIMO_HAND` but with `wall: []` so the engine
 * credits 海底撈月. The lesson distinguishes this from #5 by the
 * caption text + the empty-wall state visible in the table chrome.
 *
 * Stacks: 海底撈月 (1) + 自摸 (1) + 平和 (1) + 門前清 (1) = 4 faan.
 *
 * Decomposition tweaked vs ZIMO_HAND so the captured `state.hands[0]`
 * is distinct (per RAE3 "no two consecutive steps share an identical
 * hand"): 2m3m4m + 5m6m7m + 3p4p5p + 6p7p8p + 5s5s. Self-draw on 5s
 * (the second copy lands as the wall's last tile).
 */
const HAITEI_HAND: ExampleHand = {
  concealed14: [
    t.m(2),
    t.m(3),
    t.m(4),
    t.m(5),
    t.m(6),
    t.m(7),
    t.p(3),
    t.p(4),
    t.p(5),
    t.p(6),
    t.p(7),
    t.p(8),
    t.s(5, 0),
    t.s(5, 1),
  ],
  winningTile: t.s(5, 1),
  selfDraw: true,
  emptyWall: true,
};

// ───────────────────────────────────────────────────────────────────
// State staging. For each example, build a synthetic GameState with
// the winner's concealed hand + any exposed melds + the
// engine-computed `lastResult` populated. The mirror state lives in
// `useGame.state` only (per U1 safety invariant); the authoritative
// transport state is left untouched and won't re-emit during the
// caption window.
// ───────────────────────────────────────────────────────────────────

function stageResolvedWin(state: GameState, example: ExampleHand): GameState {
  const exposedMelds = example.melds ?? [];

  // Build the pre-win concealed hand (13 tiles). `scoreHand` appends
  // the winning tile internally — see `packages/game-logic/src/scoring.ts:47`
  // — so we pass the 14-tile post-win hand MINUS one copy of the
  // winning tile, regardless of self-draw vs ron. The 14-tile
  // post-win hand is what we pin on the mirror's `state.hands[0]`
  // for the UI render.
  const preWinHand = removeWinningTile(example.concealed14, example.winningTile);

  // Synthetic scoring state. The engine's `scoreHand` reads:
  //   - hands[winner], melds[winner] (composition for pattern detection)
  //   - state.prevailingWind, state.dealer (seat/prevailing-wind triplet bonuses)
  //   - state.gangReplacementCount (槓上開花 / 槓上槓 — keep 0)
  //   - state.wall (海底撈月 — empty wall = last-tile bonus)
  //   - state.discards (天糊 fires when totalDiscards === 0 + selfDraw
  //     + dealer-win; we suppress with one filler discard from seat 2
  //     so dealer self-draws don't accidentally pick up 天糊).
  //
  // The lesson winner is always seat 0 (the user). Seed `5` plus the
  // lesson's `dealer: 0` means seat 0 is the dealer at startHand
  // time — so without the filler discard, every self-draw example
  // would trigger 天糊.
  const fillerDiscard: Tile = { kind: 'suit', suit: 'sou', rank: 1, copy: 0 };
  const scoringState: GameState = {
    ...state,
    hands: { ...state.hands, 0: preWinHand },
    melds: { ...state.melds, 0: [...exposedMelds] },
    wall: example.emptyWall ? [] : state.wall.length > 0 ? state.wall : [fillerDiscard],
    discards: { ...state.discards, 2: [fillerDiscard] },
    gangReplacementCount: 0,
  };

  const score = scoreHand({
    state: scoringState,
    winner: 0,
    winningTile: example.winningTile,
    selfDraw: example.selfDraw,
    robbingKong: false,
  });

  const lastResult: HandResult = {
    kind: 'win',
    winner: 0,
    from: example.selfDraw ? 0 : 1,
    tile: example.winningTile,
    selfDraw: example.selfDraw,
    faan: score.faan,
    breakdown: score.breakdown,
  };

  // Mirror state for the UI: phase=resolved, hand contains all 14
  // tiles (the ResultPanel's WinningHand reads from
  // `state.hands[winner]` directly), exposed melds in place,
  // lastResult populated. Mirror the scoringState's filler discard
  // so the rendered table chrome and the scored breakdown agree on
  // "the hand has resolved with one prior discard".
  return {
    ...state,
    phase: 'resolved',
    hands: { ...state.hands, 0: [...example.concealed14] },
    melds: { ...state.melds, 0: [...exposedMelds] },
    wall: example.emptyWall ? [] : state.wall,
    discards: { ...state.discards, 2: [fillerDiscard] },
    lastDiscard: undefined,
    pendingClaims: undefined,
    pendingPromotedGang: undefined,
    turnDeadlineMs: undefined,
    gangReplacementCount: 0,
    lastResult,
  };
}

/**
 * Return a copy of `hand` with one matching face removed. Used to
 * derive the pre-win 13-tile hand from the 14-tile post-win hand;
 * `scoreHand` appends `winningTile` back, restoring the 14-tile
 * shape the pattern detectors expect.
 */
function removeWinningTile(hand: readonly Tile[], winningTile: Tile): Tile[] {
  const out = [...hand];
  for (let i = out.length - 1; i >= 0; i--) {
    const x = out[i]!;
    const match =
      x.kind === winningTile.kind &&
      ((x.kind === 'suit' &&
        winningTile.kind === 'suit' &&
        x.suit === winningTile.suit &&
        x.rank === winningTile.rank) ||
        (x.kind === 'honor' && winningTile.kind === 'honor' && x.honor === winningTile.honor));
    if (match) {
      out.splice(i, 1);
      return out;
    }
  }
  throw new Error(
    `scoring-intro: winning tile ${JSON.stringify(winningTile)} not present in concealed14`,
  );
}

export const scoringIntroLesson: Lesson = {
  id: 'scoring-intro',
  title: 'Scoring 101',
  blurb: 'See six common faan rules in action — what counts as scoring weight in HK mahjong.',
  // Reuse the basics seed — the seed only matters for the wall/bots
  // we never reach (every step replaces seat 0's hand via
  // `setupBeforeStep`). Same posture as `wait-shapes`.
  seed: 5,
  dealer: 0,
  // No bot scripts — bots are forced passive by the tutorial flow
  // and we never reach a bot turn (every step stages a resolved
  // state and ends the lesson on a caption tap).
  botScripts: {},
  // Suppress the full-screen 和 celebration on every example step.
  // Each step stages `phase: 'resolved'` + a synthetic `lastResult`
  // to drive the score panel; without this flag the celebration would
  // fire six times in a row. See WinCelebration's `tutorialSuppresses`
  // gate. The lesson's pedagogical surface is the ResultPanel
  // breakdown next to the caption, not the celebration.
  suppressWinCelebration: true,
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Scoring 101',
        body: 'In HK mahjong, every winning hand earns 番 (faan) for the patterns it satisfies. More patterns means more faan means a bigger payout. This lesson walks you through six common scoring rules — each one is a different rigged hand resolving into a win, with the score panel showing what the engine credited. Tap Got it to step through.',
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'pinghu',
      caption: {
        title: '1 / 6 — 平和 (all sequences)',
        body: 'Look at the score panel: this hand is 4 chows + a non-honor pair, won by ron on 5p. The engine credits 平和 (1 faan) for the all-sequence shape, plus 門前清 (1 faan) because nothing was claimed from opponents. The cleanest, lowest-faan win shape — common in casual play.',
      },
      ctaLabel: 'Got it',
      // Anchor the caption to the staged ResultPanel so the
      // breakdown stays visible alongside the caption rather than
      // disappearing under a centered card. The panel only mounts
      // once `lastResult` is staged by `setupBeforeStep`, so the
      // first paint of the step shows the centered fallback for one
      // frame; the next frame re-anchors to the panel rect.
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, PINGHU_HAND),
    },
    {
      id: 'toitoi',
      caption: {
        title: '2 / 6 — 對對和 (all triplets)',
        body: 'Same idea, opposite extreme: 4 triplets + a pair. The exposed 9-sou peng on the left was claimed from another seat, so the engine credits 對對和 (3 faan) but not 門前清. Three times the weight of a plain 平和 — triplets are stronger than chows in HK scoring.',
      },
      ctaLabel: 'Got it',
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, TOITOI_HAND),
    },
    {
      id: 'hun-yise',
      caption: {
        title: '3 / 6 — 混一色 (mixed one-suit)',
        body: "All man tiles plus a single honor pair. One suit + honors only = 混一色 (3 faan). The engine also credits 門前清 (1 faan) for the concealed shape. Building toward a single suit is one of the easier ways to push your faan up — every tile of another suit becomes a discard you'd rather not draw.",
      },
      ctaLabel: 'Got it',
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, HUN_YISE_HAND),
    },
    {
      id: 'qing-yise',
      caption: {
        title: '4 / 6 — 清一色 (full flush)',
        body: "Same idea as 混一色, but no honor tiles at all — every tile in the hand is pin. 清一色 weighs in at 7 faan, much harder to build because you can't fall back on dragons or winds. Plus 門前清 (1 faan) for staying concealed. A big-deck swing when it lands.",
      },
      ctaLabel: 'Got it',
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, QING_YISE_HAND),
    },
    {
      id: 'zimo',
      caption: {
        title: '5 / 6 — 自摸 (self-draw)',
        body: "Same all-chow shape as example 1, but this time you drew your own winning tile (9m) off the wall instead of claiming it off someone's discard. The engine adds 自摸 (1 faan) on top of 平和 + 門前清 — three small patterns stacking. Self-draws are worth more because you're not at the mercy of opponents' discards.",
      },
      ctaLabel: 'Got it',
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, ZIMO_HAND),
    },
    {
      id: 'haitei',
      caption: {
        title: '6 / 6 — 海底撈月 (last tile)',
        body: "An all-chow self-draw — but the wall is empty. The very last tile from the wall completed your hand, and the engine credits 海底撈月 (1 faan) on top of 自摸 + 平和 + 門前清. Reading 'how many tiles are left' becomes a real scoring lever as the wall winds down.",
      },
      ctaLabel: 'Got it',
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, HAITEI_HAND),
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "That's six common faan rules. The full HK scoring set is larger — yaku-gallery (coming up next) walks the rarer big-money patterns: 字一色, 大三元, 清么九, the blessings. For now, just being able to spot 平和 / 對對和 / 混一色 / 清一色 / 自摸 / 海底撈月 in your own hand puts you ahead of a casual table.",
      },
      ctaLabel: 'Done',
    },
  ],
};
