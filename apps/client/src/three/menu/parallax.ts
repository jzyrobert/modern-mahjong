/**
 * Pointer parallax on the menu — shared by the hero rack (`HeroScene`)
 * and the drift field (`DriftScene`) so both canvases answer the pointer
 * as one scene.
 *
 * Round-4 desktop feedback: "the animation moving when moving the mouse
 * left and right should be reduced in effect". Until then the menu ran
 * the camera rig's default strength (0.35 — tuned for the table, see
 * `core/camera.ts`; the menu must not change that default) plus its
 * own per-tile shifts (hero 0.22 / 0.10, drift 0.35 + 1.1 · depth), all
 * chasing the raw pointer with a 0.16 s time constant, so the rack and
 * the field swung with every mouse pass. The menu now runs every
 * response at 40 % of that, and the pointer it follows is smoothed
 * over 0.42 s *before* it reaches the rig's own 0.15 s lerp — a drift
 * that trails the mouse rather than a swing that tracks it.
 */
export const MENU_PARALLAX = {
  /** `CameraRig.parallaxStrength` for both menu cameras (rig default 0.35). */
  cameraStrength: 0.14,
  /** Hero tiles + dice: world-unit shift per unit of smoothed pointer. */
  heroShiftX: 0.09,
  heroShiftY: 0.04,
  /** Drift tiles: `base + depth · perDepth` world units per unit of pointer. */
  driftShiftBase: 0.14,
  driftShiftPerDepth: 0.44,
  /** Exponential smoothing time constant for the pointer, seconds. */
  smoothingS: 0.42,
} as const;

/** What the menu answered the pointer with before round 4 — the test
 *  seam that pins the reduction. */
export const MENU_PARALLAX_BEFORE = {
  cameraStrength: 0.35,
  heroShiftX: 0.22,
  heroShiftY: 0.1,
  driftShiftBase: 0.35,
  driftShiftPerDepth: 1.1,
  smoothingS: 0.16,
} as const;

/** Normalised pointer in [-1, 1] from a client position. */
export function normalisePointer(
  clientX: number,
  clientY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: (clientX / (width || 1)) * 2 - 1, y: -((clientY / (height || 1)) * 2 - 1) };
}

/**
 * Frame-rate-independent exponential smoothing of the pointer. `step`
 * returns true while the smoothed value is still catching up — the
 * scene's "keep rendering" signal.
 */
export class PointerSmoother {
  x = 0;
  y = 0;
  private targetX = 0;
  private targetY = 0;

  constructor(private readonly timeConstantS: number = MENU_PARALLAX.smoothingS) {}

  set(nx: number, ny: number): void {
    this.targetX = nx;
    this.targetY = ny;
  }

  step(dt: number): boolean {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    if (Math.abs(dx) <= 1e-4 && Math.abs(dy) <= 1e-4) return false;
    const k = 1 - 2 ** (-dt / this.timeConstantS);
    this.x += dx * k;
    this.y += dy * k;
    return true;
  }
}
