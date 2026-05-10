import { create } from 'zustand';
import { stubLesson } from '../ui/tutorial/lessons/_stub';
import { basicsLesson } from '../ui/tutorial/lessons/basics';
import { claimsLesson } from '../ui/tutorial/lessons/claims';
import { hiddenGangLesson } from '../ui/tutorial/lessons/hidden-gang';
import { safetyLesson } from '../ui/tutorial/lessons/safety';
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
  [safetyLesson.id]: safetyLesson,
  [claimsLesson.id]: claimsLesson,
  [winLesson.id]: winLesson,
  [hiddenGangLesson.id]: hiddenGangLesson,
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
  safetyLesson.id,
  claimsLesson.id,
  winLesson.id,
  hiddenGangLesson.id,
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
  begin(lessonId: string): void;
  advance(): void;
  dismiss(): void;
  /** Bump the nudge counter for the active step — UI subscribes to
   *  this and surfaces a transient toast when it changes. */
  nudge(): void;
}

export const useTutorial = create<TutorialState>((set, get) => ({
  active: null,
  lastNudge: null,
  begin: (lessonId) => {
    if (!LESSONS[lessonId]) {
      throw new Error(`Unknown tutorial lesson: ${lessonId}`);
    }
    set({ active: { lessonId, stepIndex: 0 }, lastNudge: null });
  },
  advance: () => {
    const { active } = get();
    if (!active) return;
    const lesson = LESSONS[active.lessonId];
    if (!lesson) return;
    const nextIndex = active.stepIndex + 1;
    if (nextIndex >= lesson.steps.length) {
      // Last step advanced — mark the lesson complete in user
      // settings (the lobby card collapses to a checkmark on next
      // render) and tear the overlay down. Cross-store reach into
      // `useGame` is the simplest way to coordinate; both stores
      // live in the same browser context.
      const { settings, setSettings } = useGame.getState();
      if (!settings.tutorialsCompleted.includes(active.lessonId)) {
        setSettings({
          tutorialsCompleted: [...settings.tutorialsCompleted, active.lessonId],
        });
      }
      set({ active: null, lastNudge: null });
      return;
    }
    set({ active: { lessonId: active.lessonId, stepIndex: nextIndex } });
  },
  dismiss: () => set({ active: null, lastNudge: null }),
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
