/**
 * Tutorial spotlight store — the tile ids (0..135) the active lesson
 * step is about, published by `tutorial/Tutorial3D` and polled by any
 * scene that draws tiles (`table/TableScene` raises `pose.highlight` on
 * them each frame). Lives in `core/` so the table never imports the
 * tutorial subsystem (ARCHITECTURE.md §1: subsystems share only `core/`
 * and `tiles/`); `tutorial/targets.ts` re-exports it. Module-level, no
 * React on the hot path.
 */
let spotlight: readonly number[] = [];
let spotlightSeq = 0;
const spotlightListeners = new Set<(ids: readonly number[]) => void>();

/** Publish the tile ids (0..135) the active step is about. Deduped
 *  and sorted; a no-op write does not bump the version or notify. */
export function setSpotlightTiles(tileIds: readonly number[]): void {
  const next = Array.from(
    new Set(tileIds.filter((id) => Number.isInteger(id) && id >= 0 && id < 136)),
  ).sort((a, b) => a - b);
  if (next.length === spotlight.length && next.every((id, i) => id === spotlight[i])) return;
  spotlight = next;
  spotlightSeq++;
  for (const l of spotlightListeners) l(spotlight);
}

export function clearSpotlightTiles(): void {
  setSpotlightTiles([]);
}

export function getSpotlightTiles(): readonly number[] {
  return spotlight;
}

/** Monotonic — a render loop compares it to skip work when unchanged. */
export function spotlightVersion(): number {
  return spotlightSeq;
}

export function subscribeSpotlightTiles(cb: (ids: readonly number[]) => void): () => void {
  spotlightListeners.add(cb);
  return () => {
    spotlightListeners.delete(cb);
  };
}

// ── Breathing curve ────────────────────────────────────────────────────
export const SPOTLIGHT_PERIOD_MS = 1600;
export const SPOTLIGHT_MIN = 0.35;
/** Peak stays under the table's own draw cue (1.0) so the glyphs on a lit
 *  hand stay readable at the top of the breath. */
export const SPOTLIGHT_MAX = 0.8;
/** Level held under reduced motion (no breathing). */
export const SPOTLIGHT_STATIC = 0.65;

/** Breathing intensity in [SPOTLIGHT_MIN, SPOTLIGHT_MAX]; constant under reduced motion. */
export function spotlightPulse(nowMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return SPOTLIGHT_STATIC;
  const phase = ((nowMs % SPOTLIGHT_PERIOD_MS) / SPOTLIGHT_PERIOD_MS) * Math.PI * 2;
  const t = 0.5 - 0.5 * Math.cos(phase); // 0 → 1 → 0, C1-smooth
  return SPOTLIGHT_MIN + (SPOTLIGHT_MAX - SPOTLIGHT_MIN) * t;
}

// Test hatch — the 3D tutorial spec reads which tiles carry the gold
// accent without poking at instance attributes.
declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_SPOTLIGHT__: (() => readonly number[]) | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__MAHJONG_TEST_SPOTLIGHT__ = () => spotlight;
}
