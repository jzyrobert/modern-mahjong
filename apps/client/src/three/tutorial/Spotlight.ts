import {
  SPOTLIGHT_MAX,
  SPOTLIGHT_MIN,
  SPOTLIGHT_PERIOD_MS,
  SPOTLIGHT_STATIC,
  getSpotlightTiles,
  spotlightPulse,
  spotlightVersion,
} from '../core/spotlight';

export { SPOTLIGHT_MAX, SPOTLIGHT_MIN, SPOTLIGHT_PERIOD_MS, SPOTLIGHT_STATIC, spotlightPulse };

/**
 * World-space spotlight for the tutorial: raises `pose.highlight` on
 * the tiles the active step is about (published via `targets.ts`) with
 * a slow 1.6 s breathing curve, and pulls every other tile back to 0.
 * Pure over a minimal pool shape so it is unit-testable without WebGL;
 * `TilePool` satisfies `HighlightPool` structurally.
 *
 * Usage from a scene's `update(dt, now)`:
 *
 *   const live = spotlight.update(now);   // true while breathing
 *   pool.commit();
 *   return live || otherMotion;
 */
export interface HighlightPool {
  poses: { highlight: number }[];
  markDirty(): void;
}

/**
 * Write `intensity` into the highlight of every listed tile and 0 into
 * the rest. Returns true when any value changed (caller then commits).
 */
export function applySpotlight(
  pool: HighlightPool,
  ids: readonly number[],
  intensity: number,
): boolean {
  const lit = new Set(ids);
  let changed = false;
  for (let id = 0; id < pool.poses.length; id++) {
    const pose = pool.poses[id];
    if (!pose) continue;
    const want = lit.has(id) ? intensity : 0;
    if (Math.abs(pose.highlight - want) > 1e-4) {
      pose.highlight = want;
      changed = true;
    }
  }
  if (changed) pool.markDirty();
  return changed;
}

/** Stateful driver a scene owns: polls the spotlight store each frame. */
export class Spotlight {
  private lastSeq = -1;

  constructor(
    private readonly pool: HighlightPool,
    private readonly reducedMotion: boolean,
  ) {}

  /** Call once per frame. Returns true while the scene must keep rendering. */
  update(nowMs: number): boolean {
    const ids = getSpotlightTiles();
    const seq = spotlightVersion();
    if (ids.length === 0) {
      if (seq !== this.lastSeq) {
        this.lastSeq = seq;
        applySpotlight(this.pool, ids, 0);
      }
      return false;
    }
    this.lastSeq = seq;
    applySpotlight(this.pool, ids, spotlightPulse(nowMs, this.reducedMotion));
    // Breathing keeps the loop live; a static level renders once.
    return !this.reducedMotion;
  }

  dispose(): void {
    applySpotlight(this.pool, [], 0);
  }
}
