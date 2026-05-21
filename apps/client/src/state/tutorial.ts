import { create } from 'zustand';
import { stubLesson } from '../ui/tutorial/lessons/_stub';
import { basicsLesson } from '../ui/tutorial/lessons/basics';
import { claimsLesson } from '../ui/tutorial/lessons/claims';
import { drawnGameLesson } from '../ui/tutorial/lessons/drawn-game';
import { hiddenGangLesson } from '../ui/tutorial/lessons/hidden-gang';
import { openGangClaimLesson } from '../ui/tutorial/lessons/open-gang-claim';
import { pengLesson } from '../ui/tutorial/lessons/peng';
import { promotedGangLesson } from '../ui/tutorial/lessons/promoted-gang';
import { robbingKongLesson } from '../ui/tutorial/lessons/robbing-kong';
import { ronLesson } from '../ui/tutorial/lessons/ron';
import { safetyLesson } from '../ui/tutorial/lessons/safety';
import { scoringIntroLesson } from '../ui/tutorial/lessons/scoring-intro';
import { waitShapesLesson } from '../ui/tutorial/lessons/wait-shapes';
import { winLesson } from '../ui/tutorial/lessons/win';
import type { Lesson } from '../ui/tutorial/types';
import { useGame } from './game';

/**
 * Lesson registry. Keyed by `lesson.id`; the controller looks up the
 * active lesson here when the user (or a test) calls `begin(id)`.
 * Adding a new lesson means dropping a `Lesson` definition into
 * `apps/client/src/ui/tutorial/lessons/`, registering it here, and
 * appending its id to `LESSON_ORDER` if it should slot into the
 * lobby card's sequential progression.
 */
export const LESSONS: Record<string, Lesson> = {
  [basicsLesson.id]: basicsLesson,
  [ronLesson.id]: ronLesson,
  [safetyLesson.id]: safetyLesson,
  [claimsLesson.id]: claimsLesson,
  [pengLesson.id]: pengLesson,
  [robbingKongLesson.id]: robbingKongLesson,
  [openGangClaimLesson.id]: openGangClaimLesson,
  [promotedGangLesson.id]: promotedGangLesson,
  [winLesson.id]: winLesson,
  [hiddenGangLesson.id]: hiddenGangLesson,
  [drawnGameLesson.id]: drawnGameLesson,
  [waitShapesLesson.id]: waitShapesLesson,
  [scoringIntroLesson.id]: scoringIntroLesson,
  [stubLesson.id]: stubLesson,
};

/**
 * Curriculum order, walked by the lobby card and the in-match menu
 * row. The first incomplete entry is the next lesson the user
 * should run; once every entry is in `settings.tutorialsCompleted`
 * the UI flips to a "replay" affordance.
 *
 * `_stub` is omitted on purpose — it exists only as a framework
 * smoke test, not as user-facing content.
 */
export const LESSON_ORDER: readonly string[] = [
  basicsLesson.id,
  ronLesson.id,
  safetyLesson.id,
  claimsLesson.id,
  winLesson.id,
  pengLesson.id,
  robbingKongLesson.id,
  openGangClaimLesson.id,
  promotedGangLesson.id,
  hiddenGangLesson.id,
  drawnGameLesson.id,
  waitShapesLesson.id,
  scoringIntroLesson.id,
];

/**
 * Pick the next lesson the user hasn't finished yet, or `null` when
 * they've completed every entry in `LESSON_ORDER`. The lobby card +
 * the menu row both call this to decide their CTA copy / target.
 */
export function nextLesson(completed: readonly string[]): Lesson | null {
  for (const id of LESSON_ORDER) {
    if (!completed.includes(id)) {
      return LESSONS[id] ?? null;
    }
  }
  return null;
}

interface TutorialState {
  active: { lessonId: string; stepIndex: number } | null;
  /** Most recent action the controller saw — used as a debug crumb
   *  in tests and to drive the "Hmm, that's not quite right" toast
   *  in a follow-up. The framework PR only reads it from tests. */
  lastNudge: { stepId: string; seq: number } | null;
  /** Id of the lesson the user just finished — drives the post-
   *  completion prompt rendered by `<TutorialOverlay>` with the
   *  "next lesson / continue playing / back to lobby" choice. Cleared
   *  when the user picks one of those options (or `dismiss()` is
   *  called). Set only for user-facing lessons; the internal `_stub`
   *  smoke-test lesson skips it. */
  justCompleted: string | null;
  /** Seed of the engine state when the user dismissed the opening
   *  dice modal during a tutorial. Tutorials run on fixed seeds, so
   *  pinning the seed here keeps the modal closed for the rest of
   *  the lesson AND across the lesson-end → completion-prompt → leave
   *  navigation (where `tutorialLessonId` is already null but the
   *  match state still carries the same seed, so an open predicate
   *  keyed solely on lesson id would let the modal re-pop on the
   *  empty board). Cleared on `begin()` so a replay re-pops — the
   *  reset has to happen *synchronously* before any DiceCeremony
   *  render, which is why this lives here and not as local state in
   *  the component (a `useEffect`-based clear runs post-commit, by
   *  which time the open predicate has already evaluated against the
   *  stale value and the modal stays hidden). */
  dismissedTutorialSeed: number | null;
  begin(lessonId: string): void;
  advance(): void;
  dismiss(): void;
  /** Clear the completion prompt without changing anything else.
   *  Used by the "Continue playing" / "Back to lobby" / "Next lesson"
   *  CTAs in the post-completion card. */
  dismissCompletion(): void;
  /** Called by `<DiceCeremony>` when the user dismisses the opening
   *  dice modal while a tutorial is active. Pins the lesson's seed
   *  so the modal stays hidden post-dismissal even after the lesson
   *  ends. See `dismissedTutorialSeed` above. */
  setDismissedTutorialSeed(seed: number): void;
  /** Bump the nudge counter for the active step — UI subscribes to
   *  this and surfaces a transient toast when it changes. */
  nudge(): void;
}

/**
 * Run the entering step's `setupBeforeStep` hook (if any) by reading
 * the current engine-state mirror, applying the transform, and pushing
 * the result back through `useGame.getState().setState`. Pure no-op when the step
 * has no hook, when there's no lesson, or when there's no current
 * engine state (mid-lobby; can't happen during an actual lesson because
 * `joinSoloTutorial` runs `prepareState` first). Lives at module scope
 * so both `begin()` and `advance()` call into the same code path.
 */
function runStepSetup(lessonId: string, stepIndex: number): void {
  const lesson = LESSONS[lessonId];
  const step = lesson?.steps[stepIndex];
  if (!step?.setupBeforeStep) return;
  const game = useGame.getState();
  const current = game.state;
  if (!current) return;
  const next = step.setupBeforeStep(current);
  if (next === current) return;
  game.setState(next);
}

export const useTutorial = create<TutorialState>((set, get) => ({
  active: null,
  lastNudge: null,
  justCompleted: null,
  dismissedTutorialSeed: null,
  begin: (lessonId) => {
    if (!LESSONS[lessonId]) {
      throw new Error(`Unknown tutorial lesson: ${lessonId}`);
    }
    // Starting a new lesson always clears any leftover completion
    // prompt — even when the user picks "Next lesson" from the
    // prompt itself, the begin() that follows wipes the just-
    // completed marker so the new lesson's first step renders
    // cleanly. Clears `dismissedTutorialSeed` for the same reason:
    // a replay needs to re-pop the dice modal, and the only way to
    // make that deterministic against the user's previous in-lesson
    // dismissal is to wipe the pin synchronously here (before any
    // DiceCeremony render).
    set({
      active: { lessonId, stepIndex: 0 },
      lastNudge: null,
      justCompleted: null,
      dismissedTutorialSeed: null,
    });
    // Fire the first step's `setupBeforeStep` hook (if any) so the
    // staged engine state lands before the next render commits the
    // caption. `begin()` is the lesson-entry analogue of `advance()`'s
    // step-entry path.
    runStepSetup(lessonId, 0);
  },
  advance: () => {
    const { active } = get();
    if (!active) return;
    const lesson = LESSONS[active.lessonId];
    if (!lesson) return;
    const nextIndex = active.stepIndex + 1;
    // Fire the entering step's `setupBeforeStep` (if any) BEFORE the
    // store write that bumps `stepIndex`. Both writes (engine-state
    // mirror in `useGame`, then `active.stepIndex` here) land
    // synchronously in the same call frame; React 18+'s automatic
    // batching commits a single render so the new caption and the
    // staged engine state appear on the same tick. This avoids the
    // render-time-setState / useEffect-clears traps documented in
    // `CLAUDE.md` ("state that needs a synchronous external reset →
    // put it in zustand"). Skipped on the completion branch — the
    // last step has already been seen by the user.
    if (nextIndex < lesson.steps.length) {
      runStepSetup(active.lessonId, nextIndex);
    }
    if (nextIndex >= lesson.steps.length) {
      // Last step advanced — mark the lesson complete in user
      // settings (the lobby card collapses to a checkmark on next
      // render). Cross-store reach into `useGame` is the simplest way
      // to coordinate; both stores live in the same browser context.
      const { settings, setSettings } = useGame.getState();
      if (!settings.tutorialsCompleted.includes(active.lessonId)) {
        setSettings({
          tutorialsCompleted: [...settings.tutorialsCompleted, active.lessonId],
        });
      }
      // Tear the active step down so the highlight + caption are gone.
      // For user-facing lessons we also stamp `justCompleted` so the
      // overlay flips to the post-completion prompt (next lesson /
      // continue / back to lobby). The internal `_stub` lesson skips
      // the prompt — it has no user-facing "complete" wrap-up step
      // and the framework spec asserts the overlay tears down
      // entirely once stub's last predicate fires.
      const justCompleted = active.lessonId === '_stub' ? null : active.lessonId;
      const seed = useGame.getState().state?.seed ?? null;
      set({ active: null, lastNudge: null, justCompleted, dismissedTutorialSeed: seed });
      return;
    }
    set({ active: { lessonId: active.lessonId, stepIndex: nextIndex } });
  },
  // `dismissedTutorialSeed` clears too — otherwise a tutorial-completed
  // pin can survive into the lobby and (under Playwright's fixed
  // `__MAHJONG_TEST_SEED__`) suppress the dice modal in a follow-on
  // non-tutorial match whose seed happens to match.
  dismiss: () =>
    set({ active: null, lastNudge: null, justCompleted: null, dismissedTutorialSeed: null }),
  dismissCompletion: () => set({ justCompleted: null }),
  setDismissedTutorialSeed: (seed) => set({ dismissedTutorialSeed: seed }),
  nudge: () => {
    const { active, lastNudge } = get();
    if (!active) return;
    const lesson = LESSONS[active.lessonId];
    const step = lesson?.steps[active.stepIndex];
    if (!step) return;
    const seq = (lastNudge?.seq ?? 0) + 1;
    set({ lastNudge: { stepId: step.id, seq } });
  },
}));

/** Convenience selector: the currently-active lesson + step, or null.
 *
 * Splits the subscription into two atomic selectors so the returned
 * object's identity stays stable when nothing changed. Returning a
 * fresh `{lesson, step, stepIndex}` object literal from a single
 * selector — as a previous draft did — busted React 19 +
 * zustand v5's `Object.is` bailout and produced a re-render storm
 * (~50 renders/300 ms before React's max-update-depth guard fired).
 */
export function useActiveTutorialStep() {
  const active = useTutorial((s) => s.active);
  if (!active) return null;
  const lesson = LESSONS[active.lessonId];
  if (!lesson) return null;
  const step = lesson.steps[active.stepIndex];
  if (!step) return null;
  return { lesson, step, stepIndex: active.stepIndex };
}

// Test hatch — Playwright specs flip the controller into specific
// states without going through the lobby. Same shape as the
// `__MAHJONG_TEST_GET_STATE__` hook that already lives in
// `state/game.ts`.
declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_BEGIN_TUTORIAL__: ((lessonId: string) => void) | undefined;
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_GET_TUTORIAL__: (() => TutorialState) | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__MAHJONG_TEST_BEGIN_TUTORIAL__ = (id) => useTutorial.getState().begin(id);
  globalThis.__MAHJONG_TEST_GET_TUTORIAL__ = () => useTutorial.getState();
}
