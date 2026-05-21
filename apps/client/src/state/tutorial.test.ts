import type { Copy, GameState, SuitRank, Tile } from '@mahjong/game-logic';
import { emptyState } from '@mahjong/game-logic';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lesson } from '../ui/tutorial/types';
import { useGame } from './game';
import { LESSONS, useTutorial } from './tutorial';

/**
 * Coverage for the `LessonStep.setupBeforeStep` hook wired into
 * `useTutorial.begin()` and `useTutorial.advance()`. The hook is the
 * shell extension that lets strategy lessons stage a different engine
 * state at each step (kanchan vs ryanmen, faan rule A vs B, yaku 1 vs
 * 2). Plan: docs/plans/2026-05-21-002-feat-strategy-shell-extension-plan.md.
 */

const TEST_LESSON_ID = '__test_setupBeforeStep__';

function makeTile(rank: SuitRank, copy: Copy = 0): Tile {
  return { kind: 'suit', suit: 'man', rank, copy };
}

const HAND_KANCHAN: Tile[] = [makeTile(1), makeTile(2), makeTile(3)];
const HAND_RYANMEN: Tile[] = [makeTile(4), makeTile(5), makeTile(6)];
const HAND_SHANPON: Tile[] = [makeTile(7), makeTile(7), makeTile(8)];

function withSeat0Hand(state: GameState, hand: readonly Tile[]): GameState {
  return {
    ...state,
    hands: { ...state.hands, 0: [...hand] },
  };
}

function registerTestLesson(lesson: Lesson): void {
  LESSONS[lesson.id] = lesson;
}

function unregisterTestLesson(id: string): void {
  delete LESSONS[id];
}

/** Seed the game-state mirror with an `emptyState`-shaped object — the
 *  hook reads `useGame.getState().state` so the test needs a non-null
 *  starting value. The hook only touches `state.hands[0]` here. */
function seedEngineState(): GameState {
  const s = emptyState();
  useGame.getState().setState(s, 0);
  return s;
}

beforeEach(() => {
  // Reset both stores between tests. `useGame.setState` accepts a
  // partial — leaves the action methods intact.
  useGame.setState({
    state: null,
    you: null,
    settings: {
      ...useGame.getState().settings,
      tutorialsCompleted: [],
    },
  });
  useTutorial.setState({
    active: null,
    lastNudge: null,
    justCompleted: null,
    dismissedTutorialSeed: null,
  });
});

afterEach(() => {
  unregisterTestLesson(TEST_LESSON_ID);
});

describe('useTutorial: setupBeforeStep hook', () => {
  it('runs the entering step hook synchronously, leaving the staged engine state visible after advance() returns', () => {
    seedEngineState();
    registerTestLesson({
      id: TEST_LESSON_ID,
      title: 'test',
      blurb: '',
      seed: 0,
      dealer: 0,
      botScripts: {},
      steps: [
        { id: 'a', caption: { title: '', body: '' } },
        {
          id: 'b',
          caption: { title: '', body: '' },
          setupBeforeStep: (s) => withSeat0Hand(s, HAND_KANCHAN),
        },
      ],
    });

    useTutorial.getState().begin(TEST_LESSON_ID);
    // Step 0 has no hook — engine state untouched.
    expect(useGame.getState().state?.hands[0]).toEqual([]);

    useTutorial.getState().advance();

    // After advance() returns, both writes are visible: stepIndex
    // bumped AND staged hand applied.
    expect(useTutorial.getState().active).toEqual({
      lessonId: TEST_LESSON_ID,
      stepIndex: 1,
    });
    expect(useGame.getState().state?.hands[0]).toEqual(HAND_KANCHAN);
  });

  it('is identity-passthrough: a step without setupBeforeStep leaves engine state untouched on entry', () => {
    seedEngineState();
    const handBefore = useGame.getState().state?.hands[0];
    const stateRefBefore = useGame.getState().state;

    registerTestLesson({
      id: TEST_LESSON_ID,
      title: 'test',
      blurb: '',
      seed: 0,
      dealer: 0,
      botScripts: {},
      steps: [
        { id: 'a', caption: { title: '', body: '' } },
        { id: 'b', caption: { title: '', body: '' } },
      ],
    });

    useTutorial.getState().begin(TEST_LESSON_ID);
    useTutorial.getState().advance();

    // Same object reference — no setState was called.
    expect(useGame.getState().state).toBe(stateRefBefore);
    expect(useGame.getState().state?.hands[0]).toBe(handBefore);
  });

  it('skips the engine-state setState when setupBeforeStep returns its input by reference', () => {
    seedEngineState();
    const stateRefBefore = useGame.getState().state;

    const noopHook = vi.fn((s: GameState) => s);
    registerTestLesson({
      id: TEST_LESSON_ID,
      title: 'test',
      blurb: '',
      seed: 0,
      dealer: 0,
      botScripts: {},
      steps: [
        { id: 'a', caption: { title: '', body: '' } },
        { id: 'b', caption: { title: '', body: '' }, setupBeforeStep: noopHook },
      ],
    });

    useTutorial.getState().begin(TEST_LESSON_ID);
    useTutorial.getState().advance();

    expect(noopHook).toHaveBeenCalledTimes(1);
    // Identity preserved — guards against engine-state churn /
    // unnecessary re-renders for hooks that conditionally return
    // their input.
    expect(useGame.getState().state).toBe(stateRefBefore);
  });

  it('chains transformations: each step sees the engine state produced by the previous step’s hook', () => {
    seedEngineState();
    registerTestLesson({
      id: TEST_LESSON_ID,
      title: 'test',
      blurb: '',
      seed: 0,
      dealer: 0,
      botScripts: {},
      steps: [
        {
          id: 'kanchan',
          caption: { title: '', body: '' },
          setupBeforeStep: (s) => withSeat0Hand(s, HAND_KANCHAN),
        },
        {
          id: 'ryanmen',
          caption: { title: '', body: '' },
          setupBeforeStep: (s) => withSeat0Hand(s, HAND_RYANMEN),
        },
        {
          id: 'shanpon',
          caption: { title: '', body: '' },
          setupBeforeStep: (s) => withSeat0Hand(s, HAND_SHANPON),
        },
      ],
    });

    useTutorial.getState().begin(TEST_LESSON_ID);
    // First step's hook runs on begin().
    expect(useGame.getState().state?.hands[0]).toEqual(HAND_KANCHAN);

    useTutorial.getState().advance();
    expect(useGame.getState().state?.hands[0]).toEqual(HAND_RYANMEN);

    useTutorial.getState().advance();
    expect(useGame.getState().state?.hands[0]).toEqual(HAND_SHANPON);
  });

  it('fires the first step’s hook on begin() so the lesson opens with the staged state', () => {
    seedEngineState();
    registerTestLesson({
      id: TEST_LESSON_ID,
      title: 'test',
      blurb: '',
      seed: 0,
      dealer: 0,
      botScripts: {},
      steps: [
        {
          id: 'a',
          caption: { title: '', body: '' },
          setupBeforeStep: (s) => withSeat0Hand(s, HAND_KANCHAN),
        },
      ],
    });

    useTutorial.getState().begin(TEST_LESSON_ID);

    expect(useGame.getState().state?.hands[0]).toEqual(HAND_KANCHAN);
  });

  it('re-runs the first step’s hook on replay (begin() after dismiss)', () => {
    seedEngineState();
    let invocationCount = 0;
    registerTestLesson({
      id: TEST_LESSON_ID,
      title: 'test',
      blurb: '',
      seed: 0,
      dealer: 0,
      botScripts: {},
      steps: [
        {
          id: 'a',
          caption: { title: '', body: '' },
          setupBeforeStep: (s) => {
            invocationCount += 1;
            return withSeat0Hand(s, HAND_KANCHAN);
          },
        },
        { id: 'b', caption: { title: '', body: '' } },
      ],
    });

    useTutorial.getState().begin(TEST_LESSON_ID);
    expect(invocationCount).toBe(1);

    // Simulate the user wandering away — clear the engine-state hand
    // mid-flight to prove the replay re-stages it.
    useGame.getState().setState(emptyState(), 0);
    expect(useGame.getState().state?.hands[0]).toEqual([]);

    useTutorial.getState().dismiss();
    useTutorial.getState().begin(TEST_LESSON_ID);

    expect(invocationCount).toBe(2);
    expect(useGame.getState().state?.hands[0]).toEqual(HAND_KANCHAN);
  });

  it('fires the final step’s hook before completion when advance() crosses the boundary', () => {
    // The contract: advance() on the final step crosses into the
    // completion branch and tears down. The entering-step hook for
    // an out-of-range index is skipped (there is no step to enter).
    // This guards against an off-by-one that would either fire the
    // last step's hook twice (entering + completing) or skip the
    // genuine penultimate→final transition.
    seedEngineState();
    const finalHook = vi.fn((s: GameState) => withSeat0Hand(s, HAND_KANCHAN));
    registerTestLesson({
      id: TEST_LESSON_ID,
      title: 'test',
      blurb: '',
      seed: 0,
      dealer: 0,
      botScripts: {},
      steps: [
        { id: 'a', caption: { title: '', body: '' } },
        {
          id: 'b',
          caption: { title: '', body: '' },
          setupBeforeStep: finalHook,
        },
      ],
    });

    useTutorial.getState().begin(TEST_LESSON_ID);
    // Penultimate → final: hook fires.
    useTutorial.getState().advance();
    expect(finalHook).toHaveBeenCalledTimes(1);
    expect(useGame.getState().state?.hands[0]).toEqual(HAND_KANCHAN);

    // Final → completion: hook does NOT re-fire.
    useTutorial.getState().advance();
    expect(finalHook).toHaveBeenCalledTimes(1);
    expect(useTutorial.getState().active).toBeNull();
    expect(useTutorial.getState().justCompleted).toBe(TEST_LESSON_ID);
  });

  it('no-ops when there is no engine state (lesson called outside an active match)', () => {
    useGame.getState().setState(null as unknown as GameState, null as unknown as 0);
    // Reset to a true null — `setState`'s signature wants a GameState,
    // but the live store can hold null. Use the underlying zustand
    // setter directly to bypass the typed action.
    useGame.setState({ state: null, you: null });

    const hook = vi.fn((s: GameState) => s);
    registerTestLesson({
      id: TEST_LESSON_ID,
      title: 'test',
      blurb: '',
      seed: 0,
      dealer: 0,
      botScripts: {},
      steps: [
        {
          id: 'a',
          caption: { title: '', body: '' },
          setupBeforeStep: hook,
        },
      ],
    });

    // Should not throw — the helper short-circuits on null engine state.
    expect(() => useTutorial.getState().begin(TEST_LESSON_ID)).not.toThrow();
    expect(hook).not.toHaveBeenCalled();
  });
});
