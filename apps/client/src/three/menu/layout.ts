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
  /** Angle of the face from the horizontal, radians: 0 = lying flat
   *  face-up, π/2 = standing upright. Applies to the front row. */
  lean: number;
  /** Lean for the rows behind the front one (steeper so their faces
   *  clear the front row's top edge from the camera). Defaults to `lean`. */
  backLean?: number;
  /** Yaw per tile away from centre (ends turn inward), radians. */
  yaw: number;
  /** Depth pulled toward the camera per tile of distance from centre
   *  (positive = centre tiles closest). */
  zStep: number;
  /** Parabolic bow: z offset = -curve · x². */
  curve: number;
  /** Rows the hand is split into (2 = a two-tier rack for short viewports). */
  rows: number;
  /** Depth between the rows' resting edges (back rows further from the
   *  camera). */
  rowGap: number;
}

export interface MenuLayout {
  aspect: number;
  cls: ViewportClass;
  fan: FanParams;
  /** Radians the camera looks down at the hero. */
  elevation: number;
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
  // the full width down to y ≈ 0.16 → band to y1 −0.62 (≈ 0.18). The
  // hero band below it stays open so the field has somewhere visible
  // to live (the card stack covers everything from y ≈ 0.37).
  if (cls === 'portrait') return { x0: -DRIFT_LIMIT, x1: DRIFT_LIMIT, y1: -0.62 };
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

/** Default camera elevation (wide viewports). Two-tier racks look down
 *  more steeply so the back row's face clears the front row — see
 *  `heroElevation`. Kept exported for callers that predate `layout.elevation`. */
export const HERO_ELEVATION = 0.44;
export const HERO_BASE_Y = 0;

export function heroElevation(cls: ViewportClass): number {
  return cls === 'wide' ? HERO_ELEVATION : 0.64;
}

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

/** Centre of a tile whose near (bottom) edge rests on the y=0 plane at
 *  `zEdge`, leaning back by `lean` (face angle from the horizontal). The
 *  tile extends `TILE_H` along (0, sin, −cos) and `TILE_D` along its face
 *  normal (0, cos, sin). */
export function restingCentre(lean: number, zEdge = 0): { y: number; z: number } {
  return {
    y: (TILE_H / 2) * Math.sin(lean) + (TILE_D / 2) * Math.cos(lean),
    z: zEdge - (TILE_H / 2) * Math.cos(lean) + (TILE_D / 2) * Math.sin(lean),
  };
}

/** Slots for a fanned hand resting on the y=0 plane, centred on x=0.
 *  Row 0 is the back row; the last row is the front (nearest the camera). */
export function fanSlots(count: number, p: FanParams): Slot[] {
  const out: Slot[] = [];
  const rows = Math.max(1, p.rows);
  const perRow = Math.ceil(count / rows);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const mid = (inRow - 1) / 2;
    const u = i - row * perRow - mid;
    const x = u * p.spacing * TILE_W;
    const front = row === rows - 1;
    const lean = front ? p.lean : (p.backLean ?? p.lean);
    // Back rows rest further from the camera; the front row is the
    // last one so it reads as the near edge of a rack.
    const rest = restingCentre(lean, -(rows - 1 - row) * p.rowGap);
    const z = rest.z - p.curve * x * x - Math.abs(u) * p.zStep;
    out.push({
      x,
      y: HERO_BASE_Y + rest.y,
      z,
      // Face (+Z in object space) must point up-and-toward the camera:
      // rotate −(90° − lean) about X.
      rx: -(Math.PI / 2 - lean),
      ry: -u * p.yaw,
      rz: 0,
    });
  }
  return out;
}

/** Atlas cells per slot for a `rows`-row rack. A single row reads the
 *  hand left to right; two rows keep every set intact and end each row
 *  on a red 中 so the rack is symmetric: back 萬萬萬 筒筒筒 中 / front
 *  索索索 東東東 中. */
export function heroCells(rows: number): readonly number[] {
  if (rows >= 2) return [0, 1, 2, 12, 13, 14, 31, 24, 25, 26, 27, 27, 27, 31];
  return HERO_HAND_CELLS;
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
  // Phones get a two-tier rack of 7 + 7 with no overlap: fourteen
  // overlapping tiles in one row put the end glyphs behind their
  // neighbours at phone widths. The back row leans steeper and rests
  // `rowGap` behind the front row so, from the raised phone camera
  // (`heroElevation`), every face clears the front row's top edge —
  // `heroVisibility` + the layout test pin that.
  const rack: FanParams = {
    spacing: 1.02,
    lean: 0.5,
    backLean: 0.6,
    yaw: 0,
    zStep: 0,
    curve: 0.004,
    rows: 2,
    rowGap: 2.0,
  };
  if (cls === 'portrait') {
    // Margin leaves room for the dice past the rack's right end
    // (`diceSlots`) while keeping the tiles ≥ 44 CSS px wide at 412 px.
    fan = rack;
    fov = 44;
    margin = 2.1;
  } else if (cls === 'landscape-phone') {
    // The margin pulls the camera back until the rack spans ≈ 25 % of
    // the width so it clears the card stack (x ≥ 0.32) even with
    // parallax applied.
    fan = rack;
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
  const elevation = heroElevation(cls);
  const target: [number, number, number] = [0, HERO_BASE_Y + 0.5, fan.rows > 1 ? -0.6 : 0];
  const position: [number, number, number] = [
    0,
    target[1] + distance * Math.sin(elevation),
    target[2] + distance * Math.cos(elevation),
  ];
  const frameWidth = frameWidthAt(distance, fov, aspect);
  const frameHeight = frameWidth / aspect;
  return {
    aspect,
    cls,
    fan,
    elevation,
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
 * the fan. Portrait doesn't (the rack spans most of the width and the
 * first card starts right under it), so the dice sit just past the
 * rack's right end in the strip of felt between the two rows — inside
 * the frame, in the hero band, never behind a card. Landscape phones
 * toss them in front of the rack's right half (the card stack starts
 * at x ≈ 0.32, the rack ends well before it).
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
      { x: right + 0.48, y: 0.26, z: -1.0, rx: 0, ry: 0.5, rz: 0 },
      { x: right + 0.66, y: 0.26, z: -1.8, rx: 0, ry: -0.35, rz: 0 },
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

/**
 * Deterministic, stratified candidate spots for re-seeding the drift
 * field around the DOM occluders (`MenuScene.reseedForOccluders`): a
 * `cols` × `rows` lattice over the normalised field with a seeded
 * jitter inside every cell. A lattice finds the narrow open bands a
 * portrait phone has (the hero band's side margins) that 40 random
 * probes usually miss, so the frozen reduced-motion field still shows
 * tiles instead of parking them all behind glass.
 */
export function driftCandidates(
  cols = 14,
  rows = 20,
  seed = 131,
  limit = DRIFT_LIMIT,
): { ux: number; uy: number }[] {
  const rnd = seededRandom(seed);
  const out: { ux: number; uy: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ux = -1 + ((c + 0.2 + rnd() * 0.6) / cols) * 2;
      const uy = -limit + ((r + 0.2 + rnd() * 0.6) / rows) * 2 * limit;
      out.push({ ux, uy });
    }
  }
  return out;
}

export interface DiceOffset {
  dx: number;
  dz: number;
}

/**
 * Ordered nudges for the dice pair when their resting slot straddles a
 * DOM card edge (the desktop pair used to sit on the Tutorial card's
 * corner). The pair moves together; nearer offsets come first, and the
 * open direction for the class (away from the card column — up-screen
 * / toward the fan end on wide + portrait, toward the camera on
 * landscape phones where the cards sit above the rack) is preferred at
 * equal distance. The first entry is the untouched slot.
 */
export function diceCandidateOffsets(cls: ViewportClass, steps = 7): DiceOffset[] {
  const preferZ = cls === 'landscape-phone' ? 1 : -1;
  const out: (DiceOffset & { cost: number })[] = [{ dx: 0, dz: 0, cost: 0 }];
  for (let i = 1; i <= steps; i++) {
    for (const dz of [0, -0.4 * i, 0.4 * i]) {
      for (const dx of [0, 0.3 * i, -0.3 * i]) {
        if (dx === 0 && dz === 0) continue;
        const wz = dz === 0 || Math.sign(dz) === preferZ ? 1 : 1.8;
        const wx = dx <= 0 ? 1.6 : 1;
        out.push({ dx, dz, cost: Math.hypot(dx * wx, dz * wz) });
      }
    }
  }
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.cost - b.cost)
    .filter((o) => {
      const k = `${o.dx.toFixed(3)}:${o.dz.toFixed(3)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map(({ dx, dz }) => ({ dx, dz }));
}

/** Wrap a normalised coordinate back into −1.15..1.15. */
export function wrapUnit(v: number, limit = 1.15): number {
  if (v > limit) return -limit + (v - limit);
  if (v < -limit) return limit - (-limit - v);
  return v;
}

// ─── Hero legibility maths ───────────────────────────────────────────

export type Vec3 = [number, number, number];

/** Object axes (columns of R = Rx·Ry·Rz — three.js Euler 'XYZ'). */
export function eulerXYZBasis(rx: number, ry: number, rz: number): [Vec3, Vec3, Vec3] {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // R = Rx · Ry · Rz, written out column by column.
  const ex: Vec3 = [cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz];
  const ey: Vec3 = [-cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz];
  const ez: Vec3 = [sy, -sx * cy, cx * cy];
  return [ex, ey, ez];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function madd(p: Vec3, d: Vec3, t: number): Vec3 {
  return [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
}

/** Ray / oriented-box distance (slab test in the box's frame); +∞ on a miss. */
export function rayBoxDistance(
  origin: Vec3,
  dir: Vec3,
  centre: Vec3,
  axes: [Vec3, Vec3, Vec3],
  half: Vec3,
): number {
  const rel = sub(origin, centre);
  let tMin = Number.NEGATIVE_INFINITY;
  let tMax = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const a = axes[i]!;
    const o = dot(rel, a);
    const d = dot(dir, a);
    const h = half[i]!;
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(o) > h) return Number.POSITIVE_INFINITY;
      continue;
    }
    let t1 = (-h - o) / d;
    let t2 = (h - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return Number.POSITIVE_INFINITY;
  }
  if (tMax < 0) return Number.POSITIVE_INFINITY;
  return Math.max(tMin, 0);
}

export interface SlotVisibility {
  /** Face normal · direction to the camera (1 = square-on). */
  facing: number;
  /** Glyph sample points (corners + centre) hidden behind another tile. */
  occluded: number;
  /** Samples tested. */
  samples: number;
}

/**
 * For every hero slot, how squarely the camera sees its face and
 * whether the glyph region (the central `glyphFrac` of the face) is
 * hidden behind any other tile in the rack. Pure geometry — the view
 * offset only shifts the frustum, so this is exact for the rendered
 * frame. Used by the layout test to guarantee legible glyphs on every
 * viewport class.
 */
export function heroVisibility(layout: MenuLayout, glyphFrac = 0.72): SlotVisibility[] {
  const slots = fanSlots(HERO_COUNT, layout.fan);
  const cam = layout.camera.position;
  const boxes = slots.map((s) => ({
    centre: [s.x, s.y, s.z] as Vec3,
    axes: eulerXYZBasis(s.rx, s.ry, s.rz),
    half: [TILE_W / 2, TILE_H / 2, TILE_D / 2] as Vec3,
  }));
  return slots.map((s, i) => {
    const b = boxes[i]!;
    const [ex, ey, ez] = b.axes;
    const faceCentre = madd(b.centre, ez, TILE_D / 2 + 1e-4);
    const toCam = sub(cam, faceCentre);
    const facing = dot(ez, toCam) / len(toCam);
    const gw = (TILE_W / 2) * glyphFrac;
    const gh = (TILE_H / 2) * glyphFrac;
    const samples: Vec3[] = [
      faceCentre,
      madd(madd(faceCentre, ex, -gw), ey, -gh),
      madd(madd(faceCentre, ex, gw), ey, -gh),
      madd(madd(faceCentre, ex, -gw), ey, gh),
      madd(madd(faceCentre, ex, gw), ey, gh),
      madd(faceCentre, ey, gh),
      madd(faceCentre, ey, -gh),
    ];
    let occluded = 0;
    for (const p of samples) {
      const d = sub(p, cam);
      const dist = len(d);
      const dir: Vec3 = [d[0] / dist, d[1] / dist, d[2] / dist];
      for (let j = 0; j < boxes.length; j++) {
        if (j === i) continue;
        const o = boxes[j]!;
        if (rayBoxDistance(cam, dir, o.centre, o.axes, o.half) < dist - 1e-3) {
          occluded++;
          break;
        }
      }
    }
    return { facing, occluded, samples: samples.length };
  });
}
