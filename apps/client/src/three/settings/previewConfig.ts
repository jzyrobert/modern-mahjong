import { HONORS } from '@mahjong/game-logic';
import { BACK_CELL } from '../tiles/faceAtlas';

/**
 * Pure configuration for the settings preview — kept dependency-light
 * so it can be unit-tested without a WebGL context.
 */

/** Atlas cell for a suit tile: suit 0..2 (man/pin/sou) × rank 1..9. */
export function suitCell(suit: 0 | 1 | 2, rank: number): number {
  return suit * 9 + (rank - 1);
}

/** Atlas cell for an honor by engine letter (E S W N Z F B). */
export function honorCell(honor: string): number {
  const i = HONORS.indexOf(honor as (typeof HONORS)[number]);
  if (i < 0) throw new Error(`unknown honor ${honor}`);
  return 27 + i;
}

export interface PreviewTile {
  /** Pool instance id (0..2). */
  id: number;
  /** Atlas cell shown; `BACK_CELL` marks a face-down tile. */
  cell: number;
  faceUp: boolean;
  x: number;
  z: number;
  /** Yaw around +Y in radians — a hand-placed feel, not a grid. */
  yaw: number;
}

/** 五萬, 發, one face-down tile — left to right on the felt. */
export const PREVIEW_TILES: readonly PreviewTile[] = [
  { id: 0, cell: suitCell(0, 5), faceUp: true, x: -1.32, z: 0.18, yaw: -0.16 },
  { id: 1, cell: honorCell('F'), faceUp: true, x: 0.0, z: -0.12, yaw: 0.05 },
  { id: 2, cell: BACK_CELL, faceUp: false, x: 1.34, z: 0.2, yaw: 0.19 },
];

/**
 * Camera looks a little in front of the stage centre so the near rail's
 * bevel clears the frame's bottom edge with a band of void beneath it,
 * mirroring the void above the far rail.
 */
export const PREVIEW_CAMERA = {
  position: [0, 5.1, 6.35] as [number, number, number],
  target: [0, 0, 0.32] as [number, number, number],
  fov: 30,
};

/**
 * Horizontal field of view the preview keeps constant across aspect
 * ratios (the canvas is ~1.7–1.9:1 depending on panel width), so the
 * rail always fits with a sliver of void either side.
 */
export const PREVIEW_HFOV_DEG = 52;

/**
 * Past this aspect the canvas is a letterbox strip (phone landscape:
 * ~570×150 → 3.8:1). Holding the horizontal fov there would collapse
 * the vertical fov to ~15° and crop both rails, so the vertical fov is
 * floored at the value it has here and the extra width becomes void.
 */
export const PREVIEW_MAX_ASPECT = 1.9;

/**
 * Vertical fov (deg) that yields `PREVIEW_HFOV_DEG` at this aspect,
 * floored at the `PREVIEW_MAX_ASPECT` value for letterbox canvases.
 */
export function verticalFovFor(aspect: number, hfovDeg = PREVIEW_HFOV_DEG): number {
  const half = Math.tan((hfovDeg * Math.PI) / 360);
  const a = Math.min(PREVIEW_MAX_ASPECT, Math.max(0.1, aspect));
  return (Math.atan(half / a) * 360) / Math.PI;
}

/** Felt slab (under the rail) and rail ring dimensions, world units. */
export const PREVIEW_TABLE = {
  feltW: 5.9,
  feltD: 4.1,
  railOuterW: 6.5,
  railOuterD: 4.7,
  railOuterR: 0.6,
  railInnerW: 5.6,
  railInnerD: 3.8,
  railInnerR: 0.38,
  railH: 0.42,
  railBevel: 0.07,
} as const;

/** How long the stage sways after mount / a skin change / a drag. */
export const AUTO_ORBIT_MS = 12_000;
/** Sway amplitude (rad) and angular speed (rad/s of the sine phase). */
export const ORBIT_AMPLITUDE = 0.22;
export const ORBIT_SPEED = 0.42;
/** Skin re-tint half-life in seconds (0 → instant under reduced motion). */
export const TINT_HALF_LIFE = 0.11;

/**
 * Preview lighting. The tile back is the one object whose job is to
 * show the chosen skin, so the stack is tuned so its rendered centre
 * lands within ~ΔE 5 of the swatch chip (the spec samples it) while
 * the ivory faces stay bright.
 */
export const PREVIEW_LIGHTS = {
  keyIntensity: 1.9,
  hemiIntensity: 0.62,
  envIntensity: 0.3,
} as const;

/** Matte back inlay: no lacquer, cloth-like roughness. */
export const PREVIEW_BACK_FINISH = { clearcoat: 0.12, roughness: 0.72 } as const;

/**
 * Tile-back albedo compensation. Under the preview's lighting a mid-tone
 * albedo renders ~20 % brighter than its sRGB hex (irradiance a touch
 * over 1 plus the ACES mid-tone lift) and ACES pulls ~30 % of its chroma
 * toward grey, so the back stops are pre-darkened and pre-saturated to
 * land on the swatch chip's colour (measured: ΔE 11 → < 5). Ivory faces
 * sit on the tone curve's shoulder and are left alone.
 */
export const PREVIEW_BACK_ALBEDO = 0.8;
export const PREVIEW_BACK_SATURATION = 1.4;

/** Rec. 709 luminance of a linear RGB triple. */
export function linearLuminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/**
 * Pre-compensate a linear-RGB back colour: scale chroma about its own
 * luminance by `saturation`, then scale the whole colour by `albedo`.
 * Greys are only darkened; nothing goes negative.
 */
export function compensateBackColor(
  rgb: readonly [number, number, number],
  albedo = PREVIEW_BACK_ALBEDO,
  saturation = PREVIEW_BACK_SATURATION,
): [number, number, number] {
  const y = linearLuminance(rgb);
  const f = (c: number) => Math.max(0, (y + (c - y) * saturation) * albedo);
  return [f(rgb[0]), f(rgb[1]), f(rgb[2])];
}
