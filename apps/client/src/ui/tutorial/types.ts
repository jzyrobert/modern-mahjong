import type { GameState, Seat } from '@mahjong/game-logic';
import type { Tile } from '@mahjong/game-logic';

/**
 * Per-seat scripted bot moves. Mirrors the existing
 * `__MAHJONG_TEST_BOT_SCRIPTS__` shape in
 * `apps/client/src/net/solo-transport.ts` so a lesson can wire its
 * scripted bots through the same hook that e2e tests use. Tutorials
 * always force every bot to the `passive` strategy under the hood,
 * then layer these scripts on top so specific moves land at specific
 * turns regardless of hand contents.
 */
export type LessonClaim =
  | { kind: 'pass' }
  | { kind: 'chi'; tile: Tile; meld: [Tile, Tile, Tile] }
  | { kind: 'peng'; tile: Tile }
  | { kind: 'gang'; tile: Tile }
  | { kind: 'hu'; selfDraw: boolean };

/**
 * Bot-side own-turn promoted-gang scripting. Consumed by
 * `solo-transport.ts`'s bot pacing loop before `pickDiscard` fires:
 * when it's the bot's turn, the bot has already drawn, the bot holds
 * a `peng` meld matching `tile`, AND the bot's hand contains a tile
 * of that face, the scripted entry is popped and a
 * `declareGangPromoted` action is applied instead of a discard. This
 * is the bot-side analogue of `LessonClaim` — `__MAHJONG_TEST_BOT_SCRIPTS__`
 * already covers `pickClaim` / `pickDiscard`, but neither hook fires
 * on the own-turn promotion path (`actions.ts:557`), so the rob-the-
 * kong lesson needs this separate slot.
 */
export interface LessonPromotion {
  /** Face the bot will promote (the existing peng must already
   *  match this face). */
  tile: Tile;
}

export interface LessonBotScript {
  /** Sequence of tiles the bot will discard, in order. */
  discards?: Tile[];
  /** Sequence of claims the bot will issue when given a chance. */
  claims?: LessonClaim[];
  /** Sequence of promoted-gang declarations the bot will fire on
   *  its own turn, before a discard pick. Each entry is consumed
   *  exactly once; when the bot's hand and melds satisfy the
   *  preconditions for the next entry the bot fires
   *  `declareGangPromoted`. Otherwise the entry stays queued and
   *  the bot falls through to `pickDiscard` as usual. */
  promotions?: LessonPromotion[];
}

export type LessonBotScripts = Partial<Record<Seat, LessonBotScript>>;

/**
 * A single step inside a lesson — one coach-mark and one expected
 * action (or "Next" press for purely informational steps).
 *
 * `targetId` references a `<TutorialTarget id="...">` registered
 * somewhere in the live shell. The MVP set of stable target ids is
 * documented at the bottom of this file. If the active step's
 * `targetId` doesn't resolve at render time, the overlay falls back
 * to a centered caption card.
 *
 * `completedWhen` is the auto-advance trigger — the controller
 * subscribes to engine state and advances when this returns true.
 * Steps without `completedWhen` advance only on an explicit Next
 * press (good for intro / outro paragraphs).
 */
export interface LessonStep {
  id: string;
  caption: { title: string; body: string };
  targetId?: TutorialTargetId;
  completedWhen?: (state: GameState) => boolean;
  /** Override for the caption card's CTA button label. Defaults to
   *  `"Got it"` for steps without `completedWhen`, hidden otherwise. */
  ctaLabel?: string;
}

export interface Lesson {
  id: string;
  title: string;
  /** One-line copy for the lobby's lesson picker — should fit on a
   *  single row on a phone-width viewport. */
  blurb: string;
  /** Deterministic seed fed to `startHand(state, seed, dealer)`. The
   *  same seed reproduces the same wall every run, which makes lesson
   *  scripts reliable. */
  seed: number;
  dealer: Seat;
  /** Per-seat bot scripts. The user is always seat 0; bots play
   *  seats 1-3. */
  botScripts: LessonBotScripts;
  /** When true, the opening dice ceremony is allowed to render
   *  during this lesson. Defaults to false — most lessons want a
   *  clean intro without the dice modal stacking on top of the
   *  welcome caption. The basics lesson sets it true since it
   *  introduces the dice as part of the core flow.  */
  showOpeningRolls?: boolean;
  /** Per-lesson `faanMin` override. Defaults to 0 (the standard
   *  tutorial floor — any structurally winning shape is legal). The
   *  `robbing-kong` lesson raises this to `3` so the user's
   *  intermediate ron on the peng-trigger face falls below the
   *  floor (their concealed-hand `門前清 + 平和` ron scores 2 faan;
   *  faanMin: 3 gates it out) but the rob — which adds +1 搶槓 —
   *  clears at exactly 3 faan. Constrained to the same union as
   *  `RuleConfig['faanMin']` so the value is wire-compatible. */
  faanMin?: 0 | 1 | 3 | 5;
  /** Hook fired exactly once, after the engine first observes a
   *  discard from seat 0. Lets a lesson rewrite its bot scripts
   *  based on the user's remaining hand — useful when the chi /
   *  peng / gang opportunity the lesson sets up depends on which
   *  tile the user kept. Implementations typically mutate
   *  `globalThis.__MAHJONG_TEST_BOT_SCRIPTS__` directly; the solo
   *  transport reads it on every bot turn so updates land on the
   *  next pick. */
  setupAfterFirstDiscard?: (state: GameState) => void;
  /** One-shot transform applied to the engine state after
   *  `startHand` but before `<Match>` mounts the live transport.
   *  Used by lessons whose precondition can't be expressed via a
   *  seed alone — e.g. `robbing-kong` needs seat 1 to already hold a
   *  peng meld of the user's wait face when the lesson begins, and
   *  the wall-position-of-fourth-tile constraint pushes the
   *  seed-search hit-rate below 1-in-millions in practice (the bot
   *  rarely draws the 4th copy of W on its first own-turn). Returns
   *  the patched state; consumed in `joinSoloTutorial` (in
   *  `transport-context.tsx`). Most lessons leave this undefined. */
  prepareState?: (state: GameState) => GameState;
  steps: LessonStep[];
}

/**
 * The set of stable `<TutorialTarget>` ids exposed by the live
 * match shell. Lessons reference these by id; components register
 * matching wrappers so the registry can resolve the rect at render
 * time. Keep this list narrow — every entry here is a public contract
 * with the lesson authors.
 *
 * Both shells (`MobileShell` and `DesktopShell`) must register every
 * id below so a lesson can survive an in-flight rotation.
 */
export type TutorialTargetId =
  | 'own-hand'
  | 'wall-draw'
  | 'claim-bar'
  | 'menu-pill'
  | 'turn-countdown'
  | 'shared-discards'
  | 'tsumo-button'
  | 'dice-ceremony';
