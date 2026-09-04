import type { TargetFocus, TutorialTargetId } from './types';

/**
 * Default spotlight focus per target id (a step's `targetFocus`
 * overrides; `null` rings the whole target).
 *
 * `result-panel`: the scoring lessons point at "the score panel: this
 * hand is 4 chows…" — the header, faan line, winning hand and the
 * `View breakdown` button. Ringing the whole panel also spotlit the
 * rules block and ran the ring across the action row (clipped below a
 * landscape phone's viewport), so the band ends at the breakdown
 * button, or the hand row when a shell has no such button.
 */
export const TARGET_FOCUS: Partial<Record<TutorialTargetId, TargetFocus>> = {
  'result-panel': { through: [{ text: 'View breakdown' }, { testId: 'winning-hand' }] },
};

export function focusFor(
  targetId: TutorialTargetId | null,
  override: TargetFocus | null | undefined,
): TargetFocus | null {
  if (override !== undefined) return override;
  return targetId ? (TARGET_FOCUS[targetId] ?? null) : null;
}
