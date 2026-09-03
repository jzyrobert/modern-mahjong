import type { CameraPreset } from '../core/camera';
import { TILE_D, TILE_H, TILE_W } from '../tiles/geometry';

/**
 * Pure layout maths for the menu backdrop — no three.js objects so it
 * can be unit-tested. Everything is derived from the viewport aspect:
 * the fanned hero hand, the camera preset that frames it, the depth
 * field of drifting tiles behind it, and the fog density that keeps
 * the hero crisp while the field fades into the void.
 */

/** Atlas cells for the hero hand — a clean Hong Kong "mixed one suit"
 *  style winning hand: 1-2-3 萬, 4-5-6 筒, 7-8-9 索, 東東東, 中中.
 *  Cell index = `tileId >> 2` (see `tiles/faceAtlas.ts`). */
export const HERO_HAND_CELLS: readonly number[] = [
  0, 1, 2, 12, 13, 14, 24, 25, 26, 27, 27, 27, 31, 31,
];

export const HERO_COUNT = HERO_HAND_CELLS.length;
export const DRIFT_COUNT = 26;
/** Pool instances the menu draws (hero + drift). Everything else is
 *  collapsed so the InstancedMesh stays one draw call at ~24 k tris. */
export const MENU_TILE_COUNT = HERO_COUNT + DRIFT_COUNT;

export interface Slot {
  x: number;
  y: number;
  z: number;
  /** Euler XYZ in radians. */
  rx: number;
  ry: number;
  rz: number;
}

export interface FanParams {
  /** Centre-to-centre spacing along the arc, in tile widths. */
  spacing: number;
  /** Back-lean from vertical, radians. 0 = standing upright. */
  lean: number;
  /** Yaw per tile away from centre (ends turn inward), radians. */
  yaw: number;
  /** Depth pulled toward the camera per tile of distance from centre
   *  (positive = centre tiles closest). */
  zStep: number;
  /** Parabolic bow: z offset = -curve · x². */
  curve: number;
  /** Rows the hand is split into (2 = a two-tier rack for short viewports). */
  rows: number;
  /** Depth between rows (back rows further from the camera). */
  rowGap: number;
}

export interface MenuLayout {
  aspect: number;
  fan: FanParams;
  camera: CameraPreset;
  /** Camera distance to the fan centre. */
  distance: number;
  /** World width the frustum spans at the hero depth. */
  frameWidth: number;
  /** Where the projection centre (the hero) lands on screen, as
   *  fractions of the viewport — `setViewOffset` shifts the frustum. */
  viewCenter: { x: number; y: number };
  fogDensity: number;
  /** Half-extents of the drift field at the hero depth; grows with
   *  depth in `driftField`. */
  drift: { halfW: number; halfH: number; near: number; far: number };
  dice: [Slot, Slot];
}

export const HERO_ELEVATION = 0.44; // radians the camera looks down from
export const HERO_BASE_Y = 0;

/** Camera distance so that `worldWidth` fills the viewport width. */
export function fitDistance(worldWidth: number, fovDeg: number, aspect: number): number {
  const halfTan = Math.tan((fovDeg * Math.PI) / 360);
  return worldWidth / 2 / (halfTan * aspect);
}

/** Horizontal world extent visible at `distance` for a camera. */
export function frameWidthAt(distance: number, fovDeg: number, aspect: number): number {
  return 2 * distance * Math.tan((fovDeg * Math.PI) / 360) * aspect;
}

/** Fog density such that the hero (at `distance`) is ~10 % fogged. */
export function fogDensityFor(distance: number): number {
  return 0.325 / distance;
}

export function fanWidth(count: number, spacing: number): number {
  return (count - 1) * spacing * TILE_W + TILE_W;
}

/** Slots for a fanned hand resting on the y=0 plane, centred on x=0. */
export function fanSlots(count: number, p: FanParams): Slot[] {
  const out: Slot[] = [];
  const rows = Math.max(1, p.rows);
  const perRow = Math.ceil(count / rows);
  // A tile leaning back by `lean` touches the plane along its bottom
  // edge; its centre sits this high.
  const y = (TILE_H / 2) * Math.cos(p.lean) + (TILE_D / 2) * Math.sin(p.lean);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const mid = (inRow - 1) / 2;
    const u = i - row * perRow - mid;
    const x = u * p.spacing * TILE_W;
    // Back rows sit further from the camera; the front row is the
    // last one so it reads as the near edge of a rack.
    const rowZ = -(rows - 1 - row) * p.rowGap;
    const z = -p.curve * x * x - Math.abs(u) * p.zStep + rowZ;
    out.push({
      x,
      y: HERO_BASE_Y + y,
      z,
      // Face (+Z in object space) must point up-and-toward the camera:
      // rotate −(90° − lean) about X.
      rx: -(Math.PI / 2 - p.lean),
      ry: -u * p.yaw,
      rz: 0,
    });
  }
  return out;
}

export type ViewportClass = 'portrait' | 'landscape-phone' | 'wide';

export function classifyAspect(aspect: number): ViewportClass {
  if (aspect < 0.85) return 'portrait';
  if (aspect > 1.95) return 'landscape-phone';
  return 'wide';
}

export function menuLayout(aspect: number): MenuLayout {
  const cls = classifyAspect(aspect);
  let fan: FanParams;
  let fov: number;
  let margin: number;
  let viewCenter: { x: number; y: number };
  if (cls === 'portrait') {
    fan = { spacing: 0.6, lean: 0.5, yaw: 0.075, zStep: 0.16, curve: 0.0, rows: 1, rowGap: 0 };
    fov = 44;
    margin = 1.4;
    viewCenter = { x: 0.5, y: 0.3 };
  } else if (cls === 'landscape-phone') {
    fan = { spacing: 1.02, lean: 0.46, yaw: 0.03, zStep: 0.0, curve: 0.004, rows: 2, rowGap: 1.15 };
    fov = 30;
    margin = 15;
    viewCenter = { x: 0.19, y: 0.64 };
  } else {
    fan = { spacing: 1.0, lean: 0.46, yaw: 0.045, zStep: 0.06, curve: 0.006, rows: 1, rowGap: 0 };
    fov = 34;
    margin = 9;
    viewCenter = { x: 0.5, y: 0.34 };
  }
  const perRow = Math.ceil(HERO_COUNT / fan.rows);
  const width = fanWidth(perRow, fan.spacing);
  const distance = fitDistance(width + margin, fov, aspect);
  const target: [number, number, number] = [0, HERO_BASE_Y + 0.5, 0];
  const position: [number, number, number] = [
    0,
    target[1] + distance * Math.sin(HERO_ELEVATION),
    distance * Math.cos(HERO_ELEVATION),
  ];
  const frameWidth = frameWidthAt(distance, fov, aspect);
  const frameHeight = frameWidth / aspect;
  const dieX = width / 2 + 0.9;
  return {
    aspect,
    fan,
    camera: { position, target, fov },
    distance,
    frameWidth,
    viewCenter,
    fogDensity: fogDensityFor(distance),
    drift: {
      halfW: frameWidth * 0.55,
      halfH: frameHeight * 0.7,
      near: 5,
      far: 26,
    },
    dice: [
      { x: dieX, y: 0.26, z: 1.1, rx: 0, ry: 0.5, rz: 0 },
      { x: dieX + 0.55, y: 0.26, z: 0.45, rx: 0, ry: -0.35, rz: 0 },
    ],
  };
}

/** Deterministic drift-field seeds so the field looks the same every
 *  visit (and in the screenshot verifier). */
export interface DriftTile {
  /** Normalised base position (−1..1) — scaled by the frustum at
   *  its depth every frame so resizes keep the field filling the view. */
  ux: number;
  uy: number;
  /** Depth behind the hero plane, in world units (positive). */
  depth: number;
  rx: number;
  ry: number;
  rz: number;
  /** Angular velocity, rad/s. */
  wx: number;
  wy: number;
  /** Drift velocity in normalised units/s. */
  vx: number;
  vy: number;
  /** Atlas cell; −1 = show the tile back. */
  cell: number;
  /** 0..1 stagger for the intro. */
  stagger: number;
}

/** Small LCG so the field is reproducible without pulling in a lib. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function driftField(count: number, seed = 7): DriftTile[] {
  const rnd = seededRandom(seed);
  const out: DriftTile[] = [];
  for (let i = 0; i < count; i++) {
    // Golden-angle spread on x so the field doesn't clump, jittered.
    const gx = ((i * 0.618034) % 1) * 2 - 1;
    const ux = Math.max(-1, Math.min(1, gx + (rnd() - 0.5) * 0.35));
    const uy = rnd() * 2 - 1;
    const depth = 0.15 + rnd() * 0.85;
    const faceUp = rnd() < 0.55;
    out.push({
      ux,
      uy,
      depth,
      rx: rnd() * Math.PI * 2,
      ry: rnd() * Math.PI * 2,
      rz: rnd() * Math.PI * 2,
      wx: (rnd() - 0.5) * 0.12,
      wy: (rnd() - 0.5) * 0.12,
      vx: (rnd() - 0.5) * 0.012,
      vy: 0.004 + rnd() * 0.008,
      cell: faceUp ? Math.floor(rnd() * 34) : -1,
      stagger: rnd(),
    });
  }
  return out;
}

/** Wrap a normalised coordinate back into −1.15..1.15. */
export function wrapUnit(v: number, limit = 1.15): number {
  if (v > limit) return -limit + (v - limit);
  if (v < -limit) return limit - (-limit - v);
  return v;
}
