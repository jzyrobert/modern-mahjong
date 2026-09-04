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

/**
 * Fixed presets for the wide viewport classes. Portrait is computed
 * per viewport instead (`portraitCameraFor`) because it must fit the
 * table into the band the HUD leaves between the seat strip and the
 * held hand.
 */
export const TABLE_CAMERA: Record<Exclude<ViewportClass, 'phone-portrait'>, CameraPreset> = {
  // Anchored on the hand row: 11.8 units from the user's tiles at a
  // 40° elevation puts a hand tile at ~46 CSS px on a 915 px viewport
  // (≥ the 44 px touch guideline) with its bottom edge just above the
  // footer, the far row at y ≈ 87 under the far seat's badge, and a
  // river tile at ~25 px.
  'phone-landscape': { position: [0, 8.26, 19.59], target: [0, 0, 3.71], fov: 42 },
  // Cinematic 3/4 view with the full table in frame.
  desktop: { position: [0, 22, 25], target: [0, 0, 1.5], fov: 40 },
};

// ─── Portrait (computed) ───────────────────────────────────────────
/**
 * Half-width of the world the portrait camera frames edge to edge:
 * the side seats' rows at |x| = HAND_Z plus a flat meld's half-depth,
 * so every exposed meld stays in frame while the wood rails (out at
 * 13) crop off-screen — the pixels go to the felt instead.
 */
export const PORTRAIT_X_HALF = 11.2;
/**
 * Half-width framed by the portrait *river zoom* (tap the discards):
 * the four rivers' furthest rows (RIVER_Z0 + 3 rows ≈ 7.6) plus a
 * flat tile's half-depth. At 412 px this puts a river tile at ~26 CSS
 * px (vs ~18 in the full-table view); walls and hands crop off-screen
 * until the user taps again.
 */
export const PORTRAIT_ZOOM_X_HALF = 7.9;
/** Camera elevation, degrees — steep enough that the square table reads with little keystone. */
export const PORTRAIT_ELEV_DEG = 72;
export const PORTRAIT_FOV = 40;
/** Where the table centre sits in the band (0 top … 1 bottom). */
export const PORTRAIT_BAND_BIAS = 0.5;
/**
 * Top of the table band on portrait: safe pad + chrome row + gap +
 * dense seat strip + gap (mirrors `Table3DShell`'s layout constants).
 */
export const PORTRAIT_BAND_TOP = 12 + 44 + 8 + 34 + 8;
/** Gap kept between the table band and the held hand's top edge. */
export const PORTRAIT_BAND_GAP = 8;

/**
 * Screen-space top of the held hand block (two rows), CSS px from the
 * viewport top. Independent of the camera by construction (the held
 * frame is built so one tile is `heldHandTilePx` wide and the block's
 * baseline sits `HELD_BOTTOM_PX` above the bottom).
 */
export function heldHandTopPx(width: number, height: number): number {
  const tilePx = heldHandTilePx(width);
  const block = (2 * TILE_H + HELD_ROW_GAP) * tilePx;
  return height - HELD_BOTTOM_PX - block;
}

/**
 * Portrait camera fitted to the viewport: frames x ∈ ±PORTRAIT_X_HALF
 * across the full width and centres the table (biased by
 * `PORTRAIT_BAND_BIAS`) in the band between `bandTop` and
 * `bandBottom`. Pure — a function of the viewport + band only.
 *
 * Derivation (near-top-down, so screen scale is ~uniform across the
 * table): px per world unit `ppu = width / (2·X_HALF)`; the distance
 * along the view axis where one unit is `ppu` px is
 * `d = (height/2) / (tan(fov/2)·ppu)`; a world point Δz nearer the
 * camera than the target appears `Δz·sin(elev)·ppu` px lower, so the
 * target's z is chosen to put the table centre at the band centre.
 */
export function portraitCameraFor(
  width: number,
  height: number,
  bandTop: number,
  bandBottom: number,
  xHalf: number = PORTRAIT_X_HALF,
): CameraPreset {
  const ppu = Math.max(1, width) / (2 * xHalf);
  const tanV = Math.tan((PORTRAIT_FOV * Math.PI) / 360);
  const dist = Math.max(1, height) / 2 / (tanV * ppu);
  const elev = (PORTRAIT_ELEV_DEG * Math.PI) / 180;
  const centreY = bandTop + PORTRAIT_BAND_BIAS * Math.max(0, bandBottom - bandTop);
  const offsetPx = centreY - height / 2;
  const tz = -offsetPx / (Math.sin(elev) * ppu);
  return {
    position: [0, dist * Math.sin(elev), tz + dist * Math.cos(elev)],
    target: [0, 0, tz],
    fov: PORTRAIT_FOV,
  };
}

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

/**
 * Camera preset for a viewport. `topInset` is the device safe-area
 * inset the HUD's chrome is pushed down by (portrait only).
 */
export function cameraFor(width: number, height: number, topInset = 0): CameraPreset {
  const cls = classifyViewport(width, height);
  if (cls === 'phone-portrait') {
    return portraitCameraFor(
      width,
      height,
      PORTRAIT_BAND_TOP + topInset,
      heldHandTopPx(width, height) - PORTRAIT_BAND_GAP,
    );
  }
  return TABLE_CAMERA[cls];
}

/**
 * Portrait river-zoom preset: same elevation and band as `cameraFor`,
 * framing only the river block. Because the held-hand frame is derived
 * from whichever preset is active, the hand stays put on screen while
 * the table eases in underneath it.
 */
export function riverZoomCameraFor(width: number, height: number, topInset = 0): CameraPreset {
  return portraitCameraFor(
    width,
    height,
    PORTRAIT_BAND_TOP + topInset,
    heldHandTopPx(width, height) - PORTRAIT_BAND_GAP,
    PORTRAIT_ZOOM_X_HALF,
  );
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
