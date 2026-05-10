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

export interface LessonBotScript {
  /** Sequence of tiles the bot will discard, in order. */
  discards?: Tile[];
  /** Sequence of claims the bot will issue when given a chance. */
  claims?: LessonClaim[];
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
  /** Deterministic seed fed to `startHand(state, seed, dealer)`. The
   *  same seed reproduces the same wall every run, which makes lesson
   *  scripts reliable. */
  seed: number;
  dealer: Seat;
  /** Per-seat bot scripts. The user is always seat 0; bots play
   *  seats 1-3. */
  botScripts: LessonBotScripts;
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
  | 'tsumo-button';
