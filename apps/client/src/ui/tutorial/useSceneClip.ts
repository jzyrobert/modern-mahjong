import { useRef, useSyncExternalStore } from 'react';
import { tutorialSceneRects } from '../../three/entry';
import type { TargetRect } from './TargetRegistry';
import { HALO_PAD } from './placement';
import type { TutorialTargetId } from './types';

/**
 * Clip a registered target rect to the bounds the 3D scene publishes
 * for it (`three/entry.tutorialSceneRects`). Today that is the discard
 * pool: the table registers `shared-discards` as the projected ±7.6
 * square, whose axis-aligned box widens with perspective onto the near
 * wall row and the side wall columns, so the ring drawn around it
 * bisected the walls (round-1 critic, issue 5). The scene also publishes
 * the river *interior* — the felt inside the walls' visible edges — and
 * the rect is intersected with it, inset so the padded halo stroke sits
 * `RIVER_RING_MARGIN` px inside the wall edge. Other targets, the
 * classic renderer (no publisher) and native pass through untouched.
 */
/** Air between the ring stroke and the wall tiles' visible edge. */
export const RIVER_RING_MARGIN = 8;

const noopSubscribe = () => () => {};
const getInterior = () => tutorialSceneRects?.getRiverInterior() ?? null;
const getNull = () => null;

export function useSceneClippedRect(
  rect: TargetRect | null,
  targetId: TutorialTargetId | null,
  originNode: () => { getBoundingClientRect(): { left: number; top: number } } | null,
): TargetRect | null {
  const interior = useSyncExternalStore(
    tutorialSceneRects?.subscribe ?? noopSubscribe,
    getInterior,
    getNull,
  );
  // Stable identity while the clipped rect is unchanged: the overlay's
  // follow / settle hooks key their effects on the rect object.
  const last = useRef<TargetRect | null>(null);
  let next = rect;
  if (rect && interior && targetId === 'shared-discards') {
    const o = originNode()?.getBoundingClientRect();
    const ox = o?.left ?? 0;
    const oy = o?.top ?? 0;
    const inset = HALO_PAD + RIVER_RING_MARGIN;
    const left = Math.max(rect.x, interior.left - ox + inset);
    const top = Math.max(rect.y, interior.top - oy + inset);
    const right = Math.min(rect.x + rect.w, interior.right - ox - inset);
    const bottom = Math.min(rect.y + rect.h, interior.bottom - oy - inset);
    // A degenerate intersection (interior not yet meaningful) keeps the
    // registered rect rather than collapsing the ring.
    if (right - left >= 48 && bottom - top >= 48)
      next = { x: left, y: top, w: right - left, h: bottom - top };
  }
  const prev = last.current;
  if (prev && next && sameRect(prev, next)) return prev;
  last.current = next;
  return next;
}

function sameRect(a: TargetRect, b: TargetRect): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  );
}
