import type { GameState, HandResult, Meld, Tile } from '@mahjong/game-logic';
import { scoreHand } from '@mahjong/game-logic';
import type { Lesson } from '../types';

/**
 * Yaku-gallery (役牌大全) lesson — third strategy lesson in the
 * curriculum, after `scoring-intro`. Walks the player through seven
 * deterministic "big" yaku from HK's scoring set, one per step. Each
 * step stages a winning hand that satisfies its named yaku via the
 * U1 `setupBeforeStep` hook (per plan U4).
 *
 * The seven yaku demonstrated were chosen to:
 *   (a) NOT overlap with `scoring-intro`'s six (平和 / 對對和 / 混一色 /
 *       清一色 / 自摸 / 海底撈月);
 *   (b) be visually distinctive — each hand looks structurally
 *       different from the others on the table;
 *   (c) be cleanly credited by the engine (`packages/game-logic/src/scoring.ts`);
 *   (d) minimise unavoidable co-occurrence. Where co-occurrence is
 *       structurally forced by the yaku itself (e.g., 大三元 always
 *       implies three dragon-triplet bonuses; 十三幺 always implies
 *       混么九 because its 13 faces are all terminal-or-honor), the
 *       caption acknowledges the co-occur honestly.
 *
 * Yaku covered (in lesson order):
 *   1. 七對子 (seven pairs, 4 faan) — non-standard 7-pair shape.
 *      Pure 七對子 + 門前清. Honor-free so it contrasts visually with
 *      字一色 and 十三幺.
 *   2. 混么九 (mixed terminals, 4 faan) — every tile is a terminal or
 *      honor, mixed. ONE exposed peng (claimed NNN) to avoid stacking
 *      with 四暗刻; the engine's `tripletsCovered` rule suppresses
 *      對對和 cleanly. Pure 混么九.
 *   3. 大三元 (big three dragons, 8 faan) — three dragon triplets +
 *      one suit triplet + suit pair. Concealed throughout, so the
 *      engine stacks 大三元 + 對對和 + 三元牌 Z/F/B + 門前清 (the
 *      dragon-triplet bonuses are intrinsic to HK scoring — three
 *      named entries in the breakdown for the three dragons, by
 *      design).
 *   4. 字一色 (all honors, 10 faan) — every tile is an honor. ONE
 *      exposed peng (claimed ZZZ) so 門前清 / 四暗刻 don't also fire.
 *      The remaining concealed triplets are three winds (S, W, N),
 *      which the engine's structural check for 小四喜 detects (3
 *      wind triplets + any wind pair found in `allTiles` → 小四喜).
 *      So the breakdown is 字一色 + 小四喜 + 三元牌 Z — an unavoidable
 *      honors-only stack acknowledged in the caption.
 *   5. 四暗刻 (four concealed triplets, 8 faan) — four pungs, no
 *      exposed melds, ron on the pair. Suppresses 對對和 via the
 *      engine's `!isFourConcealed` gate. Pure 四暗刻 + 門前清.
 *   6. 九蓮寶燈 (nine gates, 13 faan) — single-suit pin in the
 *      `1112345678999 + extra` shape. Replaces 清一色 in the engine
 *      (the engine emits 九蓮寶燈 OR 清一色, never both). Pure
 *      九蓮寶燈 + 門前清.
 *   7. 十三幺 (thirteen orphans, 13 faan) — 13 distinct
 *      terminal-or-honor faces with one duplicated. The engine
 *      additionally credits 混么九 (all-terminal-or-honor implies it
 *      structurally) on top — the caption acknowledges this.
 *
 * `state.lastResult` construction follows the same option-(a) path as
 * `scoring-intro`: build a synthetic minimal state, call `scoreHand`
 * as a pure function, pin the resulting `{faan, breakdown}` onto
 * `state.lastResult`. Mirror-only mutation per U1's safety invariant
 * — no engine emit fires between step entry and step exit, so the
 * staged states persist visually until the user taps Got it.
 *
 * `setupBeforeStep` uniformly on every example step (option B from
 * the plan): no `prepareState`, no asymmetry between step 1 and
 * subsequent steps.
 *
 * CTA convention (per TutorialOverlay.tsx — the Next button is hidden
 * when `completedWhen` is set): every step OMITS `completedWhen` so
 * the default "Got it" / "Done" CTAs render. All steps advance
 * manually.
 */

// ───────────────────────────────────────────────────────────────────
// Tile constructors (mirror `scoring-intro.ts`'s shape so the two
// strategy lessons read in the same dialect).
// ───────────────────────────────────────────────────────────────────

interface ExampleHand {
  /**
   * The concealed tiles seat 0 holds AFTER the winning tile has been
   * appended (i.e. the post-resolve hand the ResultPanel renders).
   * Length is `14 - 3 * melds.length` — 14 for a fully-concealed
   * win, 11 when one peng has been claimed, etc. `scoreHand` is fed
   * the pre-win version (one copy of `winningTile` removed) because
   * it appends `winningTile` internally; the mirror state stamps
   * this full post-win set on `state.hands[0]`.
   */
  concealed: readonly Tile[];
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
  E: (copy = 0): Tile => ({ kind: 'honor', honor: 'E', copy: copy as 0 | 1 | 2 | 3 }),
  S: (copy = 0): Tile => ({ kind: 'honor', honor: 'S', copy: copy as 0 | 1 | 2 | 3 }),
  W: (copy = 0): Tile => ({ kind: 'honor', honor: 'W', copy: copy as 0 | 1 | 2 | 3 }),
  N: (copy = 0): Tile => ({ kind: 'honor', honor: 'N', copy: copy as 0 | 1 | 2 | 3 }),
  Z: (copy = 0): Tile => ({ kind: 'honor', honor: 'Z', copy: copy as 0 | 1 | 2 | 3 }),
  F: (copy = 0): Tile => ({ kind: 'honor', honor: 'F', copy: copy as 0 | 1 | 2 | 3 }),
  B: (copy = 0): Tile => ({ kind: 'honor', honor: 'B', copy: copy as 0 | 1 | 2 | 3 }),
};

/**
 * 七對子 example — seven distinct pairs, honor-free for visual
 * contrast against the honor-heavy 字一色 / 十三幺 hands later in
 * the lesson. Concealed throughout; the engine's seven-pairs
 * detector replaces standard-shape scoring (no 對對和 / 平和 fires).
 * Ron 8s completes the seventh pair. Total: 七對子 (4) + 門前清 (1)
 * = 5 faan.
 */
const SEVEN_PAIRS_HAND: ExampleHand = {
  concealed: [
    t.m(1, 0),
    t.m(1, 1),
    t.m(4, 0),
    t.m(4, 1),
    t.m(7, 0),
    t.m(7, 1),
    t.p(2, 0),
    t.p(2, 1),
    t.p(6, 0),
    t.p(6, 1),
    t.s(3, 0),
    t.s(3, 1),
    t.s(8, 0),
    t.s(8, 1),
  ],
  winningTile: t.s(8, 1),
  selfDraw: false,
};

/**
 * 混么九 example — every tile a terminal (1 or 9) or honor; mixed
 * (not all-honors, not all-terminals). ONE exposed peng (claimed
 * NNN) so the four-set decomposition has an exposed seat, avoiding
 * 四暗刻 stacking. The engine's `tripletsCovered` rule (everyTerminalOrHonor)
 * suppresses 對對和. Wind triplet NN(N) is exposed but doesn't fire
 * 圈風 (prevailing E) or 門風 (seat 0 = E seat). Pure 混么九 (4) — no
 * 門前清 (one exposed meld). Concealed at scoring: 1m1m1m + 9p9p9p +
 * 1s1s1s + ZZ (11 tiles); ron Z to complete the ZZ pair.
 */
const HUN_YAO_JIU_HAND: ExampleHand = {
  concealed: [
    t.m(1, 0),
    t.m(1, 1),
    t.m(1, 2),
    t.p(9, 0),
    t.p(9, 1),
    t.p(9, 2),
    t.s(1, 0),
    t.s(1, 1),
    t.s(1, 2),
    t.Z(0),
    t.Z(1),
  ],
  winningTile: t.Z(1),
  selfDraw: false,
  melds: [
    {
      kind: 'peng',
      tiles: [t.N(0), t.N(1), t.N(2)],
      from: 1,
    },
  ],
};

/**
 * 大三元 example — three dragon triplets concealed + a suit triplet
 * + suit pair. Ron on 2m completes the 2m triplet from the pair.
 * Concealed throughout. The engine stacks (by design): 大三元 (8) +
 * 對對和 (3) + 三元牌 Z (1) + 三元牌 F (1) + 三元牌 B (1) + 門前清 (1)
 * = 15 faan total. The three-dragon-triplet bonuses are explicit
 * separate breakdown entries — HK scoring sheets list them that way.
 * Concealed14 = 14 tiles: ZZZ FFF BBB 2m2m2m 5p5p.
 */
const BIG_DRAGONS_HAND: ExampleHand = {
  concealed: [
    t.Z(0),
    t.Z(1),
    t.Z(2),
    t.F(0),
    t.F(1),
    t.F(2),
    t.B(0),
    t.B(1),
    t.B(2),
    t.m(2, 0),
    t.m(2, 1),
    t.m(2, 2),
    t.p(5, 0),
    t.p(5, 1),
  ],
  winningTile: t.m(2, 2),
  selfDraw: false,
};

/**
 * 字一色 example — every tile is an honor. ONE exposed peng (claimed
 * ZZZ) to avoid 門前清 + 四暗刻 stacking. Concealed at scoring:
 * SSS + WWW + NNN + FF (11 tiles). Ron F → FF pair.
 *
 * Co-occurrence the engine emits (unavoidable for honors-only winning
 * hands of four-sets-plus-pair shape):
 *   - 小四喜 (6): the engine's check is `windTrips.length === 3` plus
 *     `findN(allTiles, isWind, 2)` succeeding. SSS provides 2 S tiles
 *     to satisfy `findN`, so 小四喜 fires — even though there isn't a
 *     "wind pair separate from the wind triplets" in the traditional
 *     sense. This is an engine-credit detail we surface in the caption.
 *   - 三元牌 Z (1): ZZZ triplet (exposed) contributes 1 faan.
 *
 * Breakdown: 字一色 (10) + 小四喜 (6) + 三元牌 Z (1) = 17 faan total.
 */
const ALL_HONORS_HAND: ExampleHand = {
  concealed: [
    t.S(0),
    t.S(1),
    t.S(2),
    t.W(0),
    t.W(1),
    t.W(2),
    t.N(0),
    t.N(1),
    t.N(2),
    t.F(0),
    t.F(1),
  ],
  winningTile: t.F(1),
  selfDraw: false,
  melds: [
    {
      kind: 'peng',
      tiles: [t.Z(0), t.Z(1), t.Z(2)],
      from: 1,
    },
  ],
};

/**
 * 四暗刻 example — four concealed triplets + a pair, no exposed melds,
 * ron on the pair (so `winFaceCount === 2` and the engine credits
 * 四暗刻 even on a ron). Triplet ranks chosen non-consecutive across
 * suits so `hasNoConcealedRun` returns true. The engine suppresses
 * 對對和 via the `!isFourConcealed` gate. Pure 四暗刻 (8) + 門前清
 * (1) = 9 faan. Concealed14 = 1m1m1m + 4m4m4m + 7p7p7p + 9s9s9s + 5p5p.
 */
const FOUR_CONCEALED_HAND: ExampleHand = {
  concealed: [
    t.m(1, 0),
    t.m(1, 1),
    t.m(1, 2),
    t.m(4, 0),
    t.m(4, 1),
    t.m(4, 2),
    t.p(7, 0),
    t.p(7, 1),
    t.p(7, 2),
    t.s(9, 0),
    t.s(9, 1),
    t.s(9, 2),
    t.p(5, 0),
    t.p(5, 1),
  ],
  winningTile: t.p(5, 1),
  selfDraw: false,
};

/**
 * 九蓮寶燈 example — single-suit pin in the `1112345678999 + extra`
 * shape that the engine's `isNineGatesShape` detects. Strictly
 * concealed. The engine replaces 清一色 with 九蓮寶燈 when this
 * shape fires. Pre-win 13: 1p×3 + 2p + 3p + 4p + 5p + 6p + 7p + 8p +
 * 9p×3 — exactly the shape. Ron 5p → 5p count becomes 2 (the
 * detected shape accepts any +1 lift). Pure 九蓮寶燈 (13) + 門前清
 * (1) = 14 faan.
 */
const NINE_GATES_HAND: ExampleHand = {
  concealed: [
    t.p(1, 0),
    t.p(1, 1),
    t.p(1, 2),
    t.p(2),
    t.p(3),
    t.p(4),
    t.p(5, 0),
    t.p(5, 1),
    t.p(6),
    t.p(7),
    t.p(8),
    t.p(9, 0),
    t.p(9, 1),
    t.p(9, 2),
  ],
  winningTile: t.p(5, 1),
  selfDraw: false,
};

/**
 * 十三幺 example — 13 distinct terminal-or-honor faces with one
 * duplicated as the pair. Strictly concealed. Ron 1m → 1m1m pair.
 * Co-occurrence: the engine ALSO credits 混么九 (4) because
 * `everyTerminalOrHonor` returns true. The caption acknowledges this.
 * Pure-ish: 十三幺 (13) + 混么九 (4) + 門前清 (1) = 18 faan total.
 */
const THIRTEEN_ORPHANS_HAND: ExampleHand = {
  concealed: [
    t.m(1, 0),
    t.m(1, 1),
    t.m(9),
    t.p(1),
    t.p(9),
    t.s(1),
    t.s(9),
    t.E(),
    t.S(),
    t.W(),
    t.N(),
    t.Z(),
    t.F(),
    t.B(),
  ],
  winningTile: t.m(1, 1),
  selfDraw: false,
};

// ───────────────────────────────────────────────────────────────────
// State staging — identical shape to `scoring-intro.ts`. The mirror
// state's `state.hands[0]` is set to the post-win 14-tile (or
// 11-with-one-exposed-peng) `concealed` array; `scoreHand` is fed the
// pre-win version minus one copy of the winning tile.
// ───────────────────────────────────────────────────────────────────

function stageResolvedWin(state: GameState, example: ExampleHand): GameState {
  const exposedMelds = example.melds ?? [];
  const preWinHand = removeWinningTile(example.concealed, example.winningTile);

  // Filler discard on seat 2 suppresses the 天糊 blessing — without it,
  // seat 0 (dealer) self-draws would trigger 天糊 because
  // `totalDiscards === 0 && totalMelds === 0` would be true. Same
  // posture as scoring-intro. We carry the filler on every example
  // for consistency even when the example is a ron (the engine's
  // 地糊 check only fires for non-dealer winners, which we never are
  // in this lesson).
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

  return {
    ...state,
    phase: 'resolved',
    hands: { ...state.hands, 0: [...example.concealed] },
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
    `yaku-gallery: winning tile ${JSON.stringify(winningTile)} not present in concealed hand`,
  );
}

export const yakuGalleryLesson: Lesson = {
  id: 'yaku-gallery',
  title: 'Yaku gallery',
  blurb:
    'Seven big-name yaku — the rarer, higher-faan patterns. See each one resolved in a real hand with the engine breakdown.',
  // Same posture as scoring-intro — the seed/dealer drive the basics
  // seed, but every step replaces seat 0's hand via `setupBeforeStep`,
  // so the seed effectively only matters for the unused wall/bots.
  seed: 5,
  dealer: 0,
  botScripts: {},
  // Suppress the full-screen 和 celebration on every example step.
  // Each step stages `phase: 'resolved'` + a synthetic `lastResult`
  // to drive the score panel; without this flag the celebration would
  // fire seven times in a row. See WinCelebration's `tutorialSuppresses`
  // gate. The lesson's pedagogical surface is the ResultPanel
  // breakdown next to the caption, not the celebration.
  suppressWinCelebration: true,
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Yaku gallery',
        body: "Scoring 101 covered the everyday patterns — 平和, 對對和, 混一色 and friends. This lesson walks the rarer big-money yaku. Each step rigs a winning hand for one named pattern; the score panel shows what the engine credits. These hands don't come up every match, but recognising them — yours or an opponent's — is a real skill.",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'seven-pairs',
      caption: {
        title: '1 / 7 — 七對子 (seven pairs)',
        body: 'Seven distinct pairs — no sets, no chows, just pairs all the way. The engine scores it as 七對子 (4 faan) plus 門前清 (1 faan) for being concealed. A non-standard winning shape: most hands need 4 sets + a pair, but 七對子 is the carve-out. Easier to build than it looks once you stop fighting for runs.',
      },
      ctaLabel: 'Got it',
      // Anchor caption to the staged ResultPanel — see the
      // matching comment in `scoring-intro.ts`. Same rationale.
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, SEVEN_PAIRS_HAND),
    },
    {
      id: 'hun-yao-jiu',
      caption: {
        title: '2 / 7 — 混么九 (mixed terminals)',
        body: 'Every tile here is a terminal (1 or 9) or an honor — no middle ranks anywhere. 混么九 (4 faan) covers the mixed case (terminals AND honors); pure 1s-and-9s would step up to 清么九 (13 faan). The exposed N peng claimed off another seat costs you 門前清, but the structural rarity still earns the 4 faan.',
      },
      ctaLabel: 'Got it',
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, HUN_YAO_JIU_HAND),
    },
    {
      id: 'big-dragons',
      caption: {
        title: '3 / 7 — 大三元 (big three dragons)',
        body: "All three dragons — 中, 發, 白 — as triplets in the same hand. 大三元 (8 faan) is one of the headline yaku; HK scoring also stacks +1 for each dragon triplet (三元牌 中/發/白), 對對和 (3) for the all-triplets shape, and 門前清 (1) for staying concealed. The breakdown stacks fast — that's why a single dragon-heavy hand can swing a session.",
      },
      ctaLabel: 'Got it',
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, BIG_DRAGONS_HAND),
    },
    {
      id: 'all-honors',
      caption: {
        title: '4 / 7 — 字一色 (all honors)',
        body: 'Every tile in the hand is an honor — winds and dragons, no suits at all. 字一色 (10 faan) is one of the hardest yaku to land because honors are scarce: only 4 copies of each face exist. When honors-only does land, it always stacks with the wind / dragon triplet yaku that fall out of the shape — here 小四喜 (6) for the three wind triplets plus 三元牌 Z (1) for the dragon peng. Total 17 faan.',
      },
      ctaLabel: 'Got it',
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, ALL_HONORS_HAND),
    },
    {
      id: 'four-concealed',
      caption: {
        title: '5 / 7 — 四暗刻 (four concealed triplets)',
        body: "Four triplets, none claimed from anyone — every set built off your own draws. 四暗刻 (8 faan) replaces 對對和 in the breakdown because it's strictly stronger: the concealment promise is what costs you. The ron here had to complete the pair, not a triplet — winning a triplet by ron exposes that triplet and breaks 四暗刻 (you'd only get 三暗刻).",
      },
      ctaLabel: 'Got it',
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, FOUR_CONCEALED_HAND),
    },
    {
      id: 'nine-gates',
      caption: {
        title: '6 / 7 — 九蓮寶燈 (nine gates)',
        body: 'A specific single-suit shape: 1-1-1-2-3-4-5-6-7-8-9-9-9 of one suit, plus any extra tile of the same suit completes it. 九蓮寶燈 (13 faan) replaces 清一色 in the breakdown when this exact pattern fires — strictly concealed, suit-locked, almost a unicorn in casual play. Worth recognising so you know what you just witnessed.',
      },
      ctaLabel: 'Got it',
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, NINE_GATES_HAND),
    },
    {
      id: 'thirteen-orphans',
      caption: {
        title: '7 / 7 — 十三幺 (thirteen orphans)',
        body: 'One of each terminal (1 and 9 of every suit) plus one of every honor — thirteen distinct faces — and a pair of any one of them. 十三幺 (13 faan) is the other big non-standard shape alongside 七對子. The engine also credits 混么九 (4) on top because every tile happens to be a terminal-or-honor by definition. Concealed only, of course.',
      },
      ctaLabel: 'Got it',
      targetId: 'result-panel',
      setupBeforeStep: (state) => stageResolvedWin(state, THIRTEEN_ORPHANS_HAND),
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "That's seven big yaku — 七對子, 混么九, 大三元, 字一色, 四暗刻, 九蓮寶燈, 十三幺. HK's full scoring catalogue is larger (大四喜, 清么九, 槓上開花, the three blessings, …) but these seven cover the patterns you're most likely to actually see resolve at a real table. Recognising them as they form — yours or an opponent's — is the real win.",
      },
      ctaLabel: 'Done',
    },
  ],
};
