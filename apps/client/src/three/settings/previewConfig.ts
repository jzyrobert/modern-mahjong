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

export const PREVIEW_CAMERA = {
  position: [0, 5.2, 6.2] as [number, number, number],
  target: [0, 0, -0.1] as [number, number, number],
  fov: 30,
};

/**
 * Horizontal field of view the preview keeps constant across aspect
 * ratios (the canvas is ~1.7–1.9:1 depending on panel width), so the
 * rail always fits with a sliver of void either side.
 */
export const PREVIEW_HFOV_DEG = 52;

/** Vertical fov (deg) that yields `PREVIEW_HFOV_DEG` at this aspect. */
export function verticalFovFor(aspect: number, hfovDeg = PREVIEW_HFOV_DEG): number {
  const half = Math.tan((hfovDeg * Math.PI) / 360);
  return (Math.atan(half / Math.max(0.1, aspect)) * 360) / Math.PI;
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
