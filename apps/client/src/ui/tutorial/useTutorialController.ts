import { useEffect, useRef } from 'react';
import { useGame } from '../../state/game';
import { useActiveTutorialStep, useTutorial } from '../../state/tutorial';

/**
 * Hooks the tutorial step controller into engine state.
 *
 * Subscribes to `useGame.state` and, when the active step's
 * `completedWhen(state)` fires, calls `tutorial.advance()`. Steps
 * without `completedWhen` are advanced manually by the overlay's
 * "Got it" / "Next" button — those don't read engine state at all.
 *
 * The check runs on every state change rather than on a particular
 * event because lesson predicates can target any engine field
 * (discards growing, phase flipping, a specific seat winning, etc.).
 * `completedWhen` is expected to be a cheap pure function.
 *
 * Mount once, near the top of the shell (the `TutorialOverlay`
 * already mounts under both shells, so we plug this hook in there
 * for now — there's no other consumer that needs it independently).
 */
export function useTutorialController(): void {
  const active = useActiveTutorialStep();
  const advance = useTutorial((s) => s.advance);
  const state = useGame((s) => s.state);

  // Track whether we've already advanced for the current step so a
  // predicate that's true *for the rest of the lesson* (e.g. "user has
  // discarded once") doesn't keep firing. `useEffect`'s deps already
  // give us per-step + per-state firing, but the predicate may also be
  // true on the *initial* check for a step (e.g. "phase is turn" right
  // after step entry) — we want to advance exactly once and then move
  // on to the next step.
  const advancedForStepRef = useRef<string | null>(null);
  // Previous discard count for seat 0 — used to detect the 0→1
  // transition that fires `setupAfterFirstDiscard`. A monotonic
  // ref rather than a "has-fired" flag so a lesson restart (which
  // resets engine state to a fresh hand) naturally re-arms the
  // hook without needing to know the lesson session boundary.
  const prevSelfDiscardsRef = useRef(0);

  useEffect(() => {
    if (!active || !state) return;
    const stepKey = `${active.lesson.id}::${active.step.id}::${active.stepIndex}`;
    if (active.step.completedWhen && advancedForStepRef.current !== stepKey) {
      if (active.step.completedWhen(state)) {
        advancedForStepRef.current = stepKey;
        advance();
      }
    }
    const setup = active.lesson.setupAfterFirstDiscard;
    const cur = state.discards[0]?.length ?? 0;
    if (setup && prevSelfDiscardsRef.current === 0 && cur >= 1) {
      setup(state);
    }
    prevSelfDiscardsRef.current = cur;
  }, [active, state, advance]);
}
