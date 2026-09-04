import type { CameraPreset } from '../core/camera';
import { TILE_H } from '../tiles/geometry';
import { DRAWN_GAP, HAND_PITCH, HELD_ROW_GAP, HELD_ROW_MAX, type HeldHandFrame } from './layout';

/**
 * Camera presets per viewport class. Numbers were tuned against the
 * table metrics in `layout.ts` (hand row at z ≈ 10.5, walls at 8.8,
 * rail out to 13): phone portrait frames the *whole* table (both side
 * rails, every seat's melds) and lifts the user's hand off the table
 * into a near-camera "held hand" (see `heldHandFrameFor`); phone
 * landscape sits lower and wider; desktop is the cinematic 3/4 view.
 */
export type ViewportClass = 'phone-portrait' | 'phone-landscape' | 'desktop';

export function classifyViewport(width: number, height: number): ViewportClass {
  if (width >= 768 && height >= 600) return 'desktop';
  return width > height ? 'phone-landscape' : 'phone-portrait';
}

export const TABLE_CAMERA: Record<ViewportClass, CameraPreset> = {
  // Steep (72°) and far, so the square table reads with little
  // perspective distortion and fits the 412 px width edge to edge
  // (felt ±11.9 → ~16.9 CSS px per tile). The target sits near the
  // user's wall so the table occupies the band under the seat strip
  // and above the held hand.
  'phone-portrait': { position: [0, 58.1, 26.5], target: [0, 0, 7.6], fov: 46 },
  // Lower and wider — the near hand is large, the far side compresses.
  'phone-landscape': { position: [0, 10.5, 20], target: [0, 0, 3.5], fov: 44 },
  // Cinematic 3/4 view with the full table in frame.
  desktop: { position: [0, 22, 25], target: [0, 0, 1.5], fov: 40 },
};

/** Straight-on view of the debug tile sheet. */
export const SHEET_CAMERA: CameraPreset = {
  position: [0, 7.5, 12.5],
  target: [0, 0.5, 0],
  fov: 42,
};

/**
 * Sheet camera that fits the 9-column sheet (≈ 11.3 world units wide)
 * at any aspect: distance scales with 1 / aspect, elevation stays ~55°
 * so the leaning faces read square-on.
 */
export function sheetCameraFor(width: number, height: number): CameraPreset {
  const aspect = Math.max(0.3, width / Math.max(1, height));
  const fov = 42;
  const halfTanH = Math.tan((fov * Math.PI) / 360) * aspect;
  // Never closer than 14: the four rows span ±3.8 in z and the near
  // (honours) row would otherwise clip at wide aspects.
  const dist = Math.max(14, 6.1 / halfTanH + 1.5);
  const elev = (55 * Math.PI) / 180;
  return {
    position: [0, dist * Math.sin(elev) + 0.4, dist * Math.cos(elev) + 0.4],
    target: [0, 0.4, 0.4],
    fov,
  };
}

export function cameraFor(width: number, height: number): CameraPreset {
  return TABLE_CAMERA[classifyViewport(width, height)];
}

// ─── Held hand (phone portrait) ────────────────────────────────────
/** Safe-area inset + bottom action row + gap, CSS px (matches the shell). */
export const HELD_BOTTOM_PX = 12 + 44 + 14;
/** Side margin the hand keeps from the viewport edges, CSS px. */
export const HELD_SIDE_PX = 16;
/** Own-hand tile width bounds on screen, CSS px. */
export const HELD_TILE_MIN_PX = 44;
export const HELD_TILE_MAX_PX = 68;
/** Backward lean of the held tiles, radians (top edge tips away). */
export const HELD_LEAN = 0.22;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** On-screen width of one held tile for a viewport, CSS px. */
export function heldHandTilePx(width: number): number {
  // The widest row is the front one: HELD_ROW_MAX − 1 tiles + the
  // drawn tile with its gap (7.84 tile widths at the default metrics).
  const rowUnits = (HELD_ROW_MAX - 1) * HAND_PITCH + 1 + DRAWN_GAP;
  const px = (width - HELD_SIDE_PX * 2) / rowUnits;
  return Math.min(HELD_TILE_MAX_PX, Math.max(HELD_TILE_MIN_PX, px));
}

/**
 * The near-camera frame the user's hand is laid out in on phone
 * portrait. Fourteen tiles cannot reach 44 CSS px each in a single
 * table-scale row at 412 px, so the hand leaves the table and is held
 * "in the player's hands": two standing rows on a plane facing the
 * camera, close enough that one tile is `heldHandTilePx` wide, with
 * the block's baseline `HELD_BOTTOM_PX` above the viewport bottom.
 * The rays through the hand miss the table (they pass beyond the near
 * rail), so it never occludes play, and the block sits behind the
 * shadow camera's near plane so it casts nothing onto the felt.
 *
 * Pure: a function of the preset + viewport only.
 */
export function heldHandFrameFor(
  preset: CameraPreset,
  width: number,
  height: number,
): HeldHandFrame {
  const tanV = Math.tan((preset.fov * Math.PI) / 360);
  const tilePx = heldHandTilePx(width);
  // Distance along the view axis where one world unit is `tilePx`.
  const d = height / 2 / (tanV * tilePx);
  const pos = preset.position;
  const fwd = norm(sub(preset.target, pos));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = norm(cross(right, fwd));
  const baseY = height - HELD_BOTTOM_PX;
  const ny = 1 - (2 * baseY) / height;
  const k = ny * tanV;
  const origin: V3 = [
    pos[0] + d * (fwd[0] + k * up[0]),
    pos[1] + d * (fwd[1] + k * up[1]),
    pos[2] + d * (fwd[2] + k * up[2]),
  ];
  return {
    origin,
    right,
    up,
    forward: [-fwd[0], -fwd[1], -fwd[2]],
    lean: HELD_LEAN,
    pxPerUnit: tilePx,
    rowPitch: TILE_H + HELD_ROW_GAP,
  };
}
