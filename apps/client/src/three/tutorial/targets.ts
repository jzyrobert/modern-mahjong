import type { GameState, Seat } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import type { Camera } from 'three';
import { Vector3 } from 'three';
import type { TargetRect } from '../../ui/tutorial/TargetRegistry';
import type { TutorialTargetId } from '../../ui/tutorial/types';

/**
 * Tutorial ↔ 3D table glue (ARCHITECTURE.md §1 `tutorial/targets.ts`).
 *
 * DOM rects: the 3D table registers its projected hit targets with the
 * *same* `<TutorialTarget id>` wrappers the classic shells use
 * (`ui/tutorial/TargetRegistry`), so `TutorialOverlay` needs no special
 * casing; while a step is active the wrapper re-measures on every
 * frame and the overlay eases toward the moving rect. Nothing in this
 * file is required for that path.
 *
 * World-space accent: a scene can *also* raise `pose.highlight` on the
 * tiles a step is about. The active step → tile ids mapping lives in
 * `tilesForTarget`; the ids are published through a tiny module-level
 * store (`core/spotlight`: `setSpotlightTiles` / `getSpotlightTiles`)
 * that `table/TableScene` polls from its update loop — no React on the
 * hot path.
 *
 * `projectToRect` is the pure world → screen helper for anyone who
 * wants to register a rect from world-space bounds rather than a DOM
 * element (dice, the centre marker).
 */

// ── Spotlight store ────────────────────────────────────────────────────
// Lives in `core/spotlight` so the table scene can poll it without
// importing this subsystem; re-exported here for the tutorial's callers.
export {
  clearSpotlightTiles,
  getSpotlightTiles,
  setSpotlightTiles,
  spotlightVersion,
  subscribeSpotlightTiles,
} from '../core/spotlight';

// ── Target → tiles ─────────────────────────────────────────────────────
/**
 * Which physical tiles a coach-mark target refers to, from the user's
 * seat. Targets that are pure chrome (menu pill, countdown, claim bar,
 * result panel, dice) map to no tiles; the DOM halo covers them.
 */
export function tilesForTarget(
  id: TutorialTargetId | undefined,
  state: GameState | null,
  seat: Seat,
): number[] {
  if (!id || !state) return [];
  switch (id) {
    case 'own-hand':
      return state.hands[seat].map(tileId);
    case 'wall-draw': {
      // The engine draws from the *end* of the wall (`wall.pop()`).
      const next = state.wall[state.wall.length - 1];
      return next ? [tileId(next)] : [];
    }
    case 'shared-discards':
      return state.discardOrder.map((d) => tileId(d.tile));
    case 'promote-gang':
    case 'tsumo-button':
    case 'ready-hand-badge':
      return state.hands[seat].map(tileId);
    default:
      return [];
  }
}

// ── Projection ─────────────────────────────────────────────────────────
const _v = new Vector3();

/**
 * Project world-space points to a screen-space rect (CSS px, origin at
 * the canvas's top-left). Returns `null` when every point is behind
 * the camera. Callers pass the 8 corners of a bounding box, or the
 * centres of a row of tiles padded by half a tile.
 */
export function projectToRect(
  points: ReadonlyArray<{ x: number; y: number; z: number }>,
  camera: Camera,
  width: number,
  height: number,
): TargetRect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const p of points) {
    _v.set(p.x, p.y, p.z).project(camera);
    if (_v.z > 1) continue; // behind the far plane / camera
    any = true;
    const sx = ((_v.x + 1) / 2) * width;
    const sy = ((1 - _v.y) / 2) * height;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  if (!any) return null;
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

/** Eight corners of an axis-aligned box centred at `c` with half-extents `e`. */
export function boxCorners(
  c: { x: number; y: number; z: number },
  e: { x: number; y: number; z: number },
): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        out.push({ x: c.x + sx * e.x, y: c.y + sy * e.y, z: c.z + sz * e.z });
  return out;
}
