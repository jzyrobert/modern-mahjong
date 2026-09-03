import { type ViewportClass, classifyAspect, heroAnchor } from '../../ui/menu/heroAnchor';
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
  /** Normalised drift-field rect the tiles must stay out of (the DOM
   *  title block) — see `driftKeepOut`. */
  keepOut: DriftKeepOut;
  /** How many of the `DRIFT_COUNT` field tiles are shown — narrow
   *  viewports get fewer so the field stays sparse (`driftVisible`). */
  driftVisible: number;
  dice: [Slot, Slot];
}

/**
 * The field is seeded for a wide frame; a portrait phone shows the same
 * tiles across a quarter of the area, and the title keep-out squeezes
 * them into the lower two thirds. Cap the visible count per class so
 * the field reads as a few tiles adrift in fog, not a shower behind
 * the cards.
 */
export function driftVisible(cls: ViewportClass): number {
  if (cls === 'portrait') return 14;
  if (cls === 'landscape-phone') return 18;
  return DRIFT_COUNT;
}

/**
 * Region of the normalised drift field (`ux`, `uy` ∈ −1.15..1.15, y
 * down — screen x ≈ (ux + 1) / 2, screen y ≈ (uy + 1) / 2) that sits
 * under the DOM title block. Tiles are kept out of it so no tile-back
 * ever drifts behind the heading or tagline: seeds inside are remapped
 * below it and the vertical wrap re-enters below it while the tile's
 * `ux` is within the band (`wrapDriftY`).
 */
export interface DriftKeepOut {
  x0: number;
  x1: number;
  /** Lower edge of the band (tiles must have uy ≥ y1 while inside x0..x1). */
  y1: number;
}

export const DRIFT_LIMIT = 1.15;

export function driftKeepOut(cls: ViewportClass): DriftKeepOut {
  // Screen fraction ≈ viewCenter + (u + 1 − 2·viewCenter) · 0.54 (see
  // `writeDrift`), so with the anchors from `heroAnchor`:
  // Portrait (vc 0.5 / 0.3): app bar + left-aligned title block span
  // the full width down to y ≈ 0.31 → band to y1 −0.3 (≈ 0.35).
  if (cls === 'portrait') return { x0: -DRIFT_LIMIT, x1: DRIFT_LIMIT, y1: -0.3 };
  // Landscape phone (vc 0.16 / 0.58): identity pill + title column,
  // x < 0.36, down to y ≈ 0.31 → x1 −0.3, y1 −0.25 (≈ 0.36).
  if (cls === 'landscape-phone') return { x0: -DRIFT_LIMIT, x1: -0.3, y1: -0.25 };
  // Wide (vc 0.5 / 0.33): centred title block, x 0.26..0.74, tagline
  // ends y ≈ 0.21 → y1 −0.5 (≈ 0.28).
  return { x0: -0.44, x1: 0.44, y1: -0.5 };
}

export function inKeepOut(ux: number, uy: number, k: DriftKeepOut): boolean {
  return ux >= k.x0 && ux <= k.x1 && uy < k.y1;
}

/** Remap a seed that starts inside the keep-out band to the same
 *  relative position in the free range below it. */
export function placeOutsideKeepOut<T extends { ux: number; uy: number }>(
  t: T,
  k: DriftKeepOut,
): T {
  if (!inKeepOut(t.ux, t.uy, k)) return t;
  const rel = (t.uy + DRIFT_LIMIT) / (k.y1 + DRIFT_LIMIT);
  return { ...t, uy: k.y1 + rel * (DRIFT_LIMIT - k.y1) };
}

/** Vertical wrap for a drifting tile: past the bottom it re-enters at
 *  the top — or just below the keep-out band when its `ux` is inside
 *  the band, so the title never gains a tile behind it. */
export function wrapDriftY(uy: number, ux: number, k: DriftKeepOut, limit = DRIFT_LIMIT): number {
  if (uy > limit) {
    const lo = ux >= k.x0 && ux <= k.x1 ? k.y1 : -limit;
    return lo + (uy - limit);
  }
  if (uy < -limit) return limit - (-limit - uy);
  return uy;
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

/** Viewport classes + the on-screen hero anchor are shared with the
 *  classic DOM fan — see `ui/menu/heroAnchor.ts`. Re-exported so the
 *  three-side callers keep one import. */
export { classifyAspect, type ViewportClass };

export function menuLayout(aspect: number): MenuLayout {
  const anchor = heroAnchor(aspect);
  const cls = anchor.cls;
  let fan: FanParams;
  let fov: number;
  let margin: number;
  if (cls === 'portrait') {
    fan = { spacing: 0.6, lean: 0.5, yaw: 0.075, zStep: 0.16, curve: 0.0, rows: 1, rowGap: 0 };
    fov = 44;
    margin = 1.4;
  } else if (cls === 'landscape-phone') {
    // Two-tier rack under the title column. The margin pulls the
    // camera back until the rack spans ≈ 25 % of the width so it
    // clears the card stack (x ≥ 0.32) even with parallax applied.
    fan = { spacing: 1.02, lean: 0.46, yaw: 0.03, zStep: 0.0, curve: 0.004, rows: 2, rowGap: 1.15 };
    fov = 30;
    margin = 21;
  } else {
    fan = { spacing: 1.0, lean: 0.46, yaw: 0.045, zStep: 0.06, curve: 0.006, rows: 1, rowGap: 0 };
    fov = 34;
    margin = 9;
  }
  const viewCenter = { x: anchor.x, y: anchor.y };
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
      near: 6,
      far: 28,
    },
    keepOut: driftKeepOut(cls),
    driftVisible: driftVisible(cls),
    dice: diceSlots(cls, width),
  };
}

/**
 * Where the two dice rest. Wide viewports have room to the right of
 * the fan; phones don't (the fan spans most of the width on portrait
 * and the card stack starts at x ≈ 0.32 on landscape), so there the
 * dice are tossed in front of the hand's right half — closer to the
 * camera than the front row and always inside the frame.
 */
export function diceSlots(cls: ViewportClass, fanWidthUnits: number): [Slot, Slot] {
  if (cls === 'wide') {
    const dieX = fanWidthUnits / 2 + 0.9;
    return [
      { x: dieX, y: 0.26, z: 1.1, rx: 0, ry: 0.5, rz: 0 },
      { x: dieX + 0.55, y: 0.26, z: 0.45, rx: 0, ry: -0.35, rz: 0 },
    ];
  }
  const right = fanWidthUnits / 2;
  if (cls === 'portrait') {
    return [
      { x: right - 1.35, y: 0.26, z: 1.85, rx: 0, ry: 0.5, rz: 0 },
      { x: right - 0.65, y: 0.26, z: 1.35, rx: 0, ry: -0.35, rz: 0 },
    ];
  }
  return [
    { x: right - 1.6, y: 0.26, z: 1.8, rx: 0, ry: 0.5, rz: 0 },
    { x: right - 0.95, y: 0.26, z: 1.3, rx: 0, ry: -0.35, rz: 0 },
  ];
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
