import type { CameraPreset } from '../core/camera';
import { TILE_D, TILE_H } from '../tiles/geometry';
import {
  DRAWN_GAP,
  FELT_HALF,
  HAND_PITCH,
  HELD_ROW_GAP,
  HELD_ROW_MAX,
  type HeldHandFrame,
  RAIL_H,
  RAIL_WIDTH,
  WALL_D,
} from './layout';

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
  // Solved numerically (30° camera elevation, 17.7 units from the
  // target) for a 915×412 viewport: a hand tile is 45 CSS px wide with
  // its bottom edge at y ≈ 360 — 9 px above the 37 px footer strip that
  // hosts the claim bar (round-3: at y ≈ 364 the strip's border touched
  // the tiles) — the near wall's backs at y ≈ 234–305 with the hand's
  // top edge meeting their bottom, the far wall's top edge at y ≈ 57 —
  // below the 46 px chrome row and its toast slot — and a ~62 px
  // free-felt band between a one-row river and the near wall. The pan
  // (target z 4.55, +0.27 vs. round 2) lifts the whole table 4 px.
  'phone-landscape': { position: [0, 9.06, 20.25], target: [0, 0, 4.55], fov: 42 },
  // Cinematic 3/4 view with the full table in frame.
  desktop: { position: [0, 22, 25], target: [0, 0, 1.5], fov: 40 },
};

// ─── Portrait (computed) ───────────────────────────────────────────
/**
 * Half-width of the world the portrait camera frames edge to edge at
 * the *target* depth. The side seats' rows stand at |x| = HAND_Z and
 * their flat melds (in the rack line at MELD_Z) reach |x| ≈ 11.2; the
 * near half of the table projects ~4 % larger than the target plane at
 * this elevation, so 11.6 keeps a side meld's nearest corner a few px
 * inside the viewport while the wood rails still crop off-screen. Any
 * tighter and the left seat's melds clip (round-3 critique at 11.2);
 * the remaining band under the table is closed by the HUD tray instead
 * (see `PORTRAIT_TRAY_H`).
 */
export const PORTRAIT_X_HALF = 11.6;
/**
 * Half-width framed by the portrait *river zoom* (tap the discards):
 * the four rivers' furthest rows (RIVER_Z0 + 3 rows ≈ 7.6) plus a
 * flat tile's half-depth. At 412 px this puts a river tile at ~26 CSS
 * px (vs ~18 in the full-table view); walls and hands crop off-screen
 * until the user taps again.
 */
export const PORTRAIT_ZOOM_X_HALF = 7.9;
/**
 * Camera elevation, degrees. 70° (round-2: down from 76°) shows the
 * walls' front faces, the rail bevels and the side rows' tops-vs-sides
 * so the table reads as an object rather than a flat plan, while the
 * keystone stays mild (near/far scale ratio ≈ 1.06) so the side rows
 * fit at both ends and river glyphs stay near face-on. The frame is
 * width-bound: the side seats' rows (|x| ≈ 11.6 at their near end) must
 * fit, which fixes the scale at ≈ 17 CSS px per unit on a 412 px phone
 * regardless of elevation — so the band above and below the table is
 * structural (toast slot above, lit apron + action tray below), not slack.
 */
export const PORTRAIT_ELEV_DEG = 70;
export const PORTRAIT_FOV = 44;
/**
 * Portrait discards render 28 % larger than the other table tiles: the
 * full-table view is width-bound at ~18 CSS px per tile, and the river
 * is the one zone the player reads at a glance — 1.28 puts a river tile
 * at ~22 CSS px on a 412 px phone, where 索 / 筒 faces read rather than
 * get guessed. Six columns × 1.28 still fit inside the walls in the
 * pinwheel (`layout.riverMetrics`: far edge 7.85 < 8.1).
 */
export const PORTRAIT_RIVER_SCALE = 1.28;
/**
 * Where the table centre sits in the band (0 top … 1 bottom). A touch
 * above centre: the far half of the table foreshortens, so 0.485 leaves
 * the visible rail-to-HUD gaps equal above (toast slot) and below
 * (apron) instead of ~100 / ~80 px.
 */
export const PORTRAIT_BAND_BIAS = 0.485;
/**
 * Top of the table band on portrait: safe pad + chrome row + gap +
 * dense seat strip + gap (mirrors `Table3DShell`'s layout constants).
 */
export const PORTRAIT_BAND_TOP = 12 + 44 + 8 + 34 + 8;
/** Top of the dense seat strip on portrait (safe pad + chrome row + gap). */
export const PORTRAIT_STRIP_TOP = 12 + 44 + 8;
/** Height of the dense seat strip, CSS px. */
export const PORTRAIT_STRIP_H = 34;
/** Gap kept between the table band and the held hand's top edge. */
export const PORTRAIT_BAND_GAP = 8;
/**
 * Portrait full table: the width-bound table is shorter than the band
 * between the seat strip and the held hand, so instead of centring it
 * (≈ 90 px of void above *and* below — round-2 #3) the far rail's top
 * edge is pinned this far under the seat strip; toasts overlap the far
 * rail and the slack collects under the near rail, where the shell
 * paints the table's floor shadow. Falls back to the centred fit when
 * the table fills the band (short phones).
 */
export const PORTRAIT_FAR_RAIL_GAP = 66;
/** Least apron (near rail bottom → hand top) the pinned view may leave. */
export const PORTRAIT_APRON_MIN = 12;
/** The far rail's top-back edge (world). */
export const PORTRAIT_FAR_RAIL_POINT: [number, number, number] = [
  0,
  RAIL_H,
  -(FELT_HALF + RAIL_WIDTH),
];
/**
 * River zoom: the far wall's near-top edge is pinned this far below the
 * strip's top — 20 px *above* the zoom header's bottom edge (strip +
 * 6 px pad), so the whole far wall row (~25 px tall on screen), the
 * dead-wall stacks that wrap onto it and the row's nearer right end
 * (perspective) sit behind the header bar the shell draws across the
 * strip; no tile top peeks out under HUD (round-3: a 5 px sliver did at
 * −6).
 */
export const ZOOM_WALL_ANCHOR_Y = PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H - 14;
/** World point pinned by the river zoom: the far wall's near-top edge. */
export const ZOOM_WALL_ANCHOR: [number, number, number] = [0, 2 * TILE_D, -(WALL_D - TILE_H / 2)];

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

/**
 * Pure world → CSS-px projection of a preset (look-at basis, vertical
 * fov). Mirrors `PerspectiveCamera` + `Vector3.project` closely enough
 * to anchor presets on world points without a three.js object; unit
 * tested against the presets' known landmarks.
 */
export function projectPreset(
  preset: CameraPreset,
  width: number,
  height: number,
  point: readonly [number, number, number],
): { x: number; y: number; depth: number } {
  const pos = preset.position;
  const fwd = norm(sub(preset.target, pos));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = norm(cross(right, fwd));
  const d: V3 = [point[0] - pos[0], point[1] - pos[1], point[2] - pos[2]];
  const depth = dot(d, fwd);
  const tanV = Math.tan((preset.fov * Math.PI) / 360);
  const aspect = Math.max(1e-6, width) / Math.max(1e-6, height);
  const ndcX = dot(d, right) / Math.max(1e-6, depth) / (tanV * aspect);
  const ndcY = dot(d, up) / Math.max(1e-6, depth) / tanV;
  return { x: (ndcX * 0.5 + 0.5) * width, y: (-ndcY * 0.5 + 0.5) * height, depth };
}

/**
 * Portrait camera with the same scale + elevation as `portraitCameraFor`
 * but panned so `point` projects at screen `y = screenY` (bisection on
 * the target's z — the pan is monotonic). Used by the river zoom to
 * tuck the far wall behind the strip instead of centring the table.
 */
export function portraitCameraAnchored(
  width: number,
  height: number,
  xHalf: number,
  point: readonly [number, number, number],
  screenY: number,
): CameraPreset {
  const ppu = Math.max(1, width) / (2 * xHalf);
  const tanV = Math.tan((PORTRAIT_FOV * Math.PI) / 360);
  const dist = Math.max(1, height) / 2 / (tanV * ppu);
  const elev = (PORTRAIT_ELEV_DEG * Math.PI) / 180;
  const make = (tz: number): CameraPreset => ({
    position: [0, dist * Math.sin(elev), tz + dist * Math.cos(elev)],
    target: [0, 0, tz],
    fov: PORTRAIT_FOV,
  });
  // Larger tz pans the camera toward +z, moving the scene *up* on
  // screen (smaller y).
  let lo = -40;
  let hi = 40;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const y = projectPreset(make(mid), width, height, point).y;
    if (y > screenY) lo = mid;
    else hi = mid;
  }
  return make((lo + hi) / 2);
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
export function cameraFor(rawWidth: number, rawHeight: number, topInset = 0): CameraPreset {
  // A host measured before layout (0×0) must still yield a *finite*
  // preset: the rig's springs would otherwise hold NaN forever, and the
  // real size arrives through `resize` a frame later.
  const width = Number.isFinite(rawWidth) && rawWidth >= 2 ? rawWidth : 412;
  const height = Number.isFinite(rawHeight) && rawHeight >= 2 ? rawHeight : 915;
  const cls = classifyViewport(width, height);
  if (cls === 'phone-portrait') {
    const bandTop = PORTRAIT_BAND_TOP + topInset;
    const bandBottom = heldHandTopPx(width, height) - PORTRAIT_BAND_GAP;
    let fit = portraitCameraFor(width, height, bandTop, bandBottom);
    // Short phones: when the width-bound table is taller than the band
    // (rail to rail), zoom out until it fits — the side rows crop a
    // little rather than the near rail running under the hand.
    const railSpan = () =>
      projectPreset(fit, width, height, [0, 0, FELT_HALF + RAIL_WIDTH]).y -
      projectPreset(fit, width, height, PORTRAIT_FAR_RAIL_POINT).y;
    let xHalf = PORTRAIT_X_HALF;
    const bandH = Math.max(1, bandBottom - bandTop - 6);
    for (let i = 0; i < 3 && railSpan() > bandH; i++) {
      const k = (railSpan() / bandH) * 1.01;
      if (!Number.isFinite(k) || k <= 1) break;
      xHalf *= k;
      fit = portraitCameraFor(width, height, bandTop, bandBottom, xHalf);
    }
    // Slack in the band: pin the far rail `PORTRAIT_FAR_RAIL_GAP` under
    // the seat strip (toasts sit on the rail; the slack collects as the
    // lit apron above the hand) whenever the near rail then still clears
    // the hand by the minimum apron. A taller table (wide phones, short
    // phones) pins the near rail just above the hand instead and lets
    // the far rail rise toward the strip — the height fit above keeps it
    // below the strip.
    const nearRail: [number, number, number] = [0, 0, FELT_HALF + RAIL_WIDTH];
    const railY = PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H + topInset + PORTRAIT_FAR_RAIL_GAP;
    const anchored = portraitCameraAnchored(width, height, xHalf, PORTRAIT_FAR_RAIL_POINT, railY);
    if (projectPreset(anchored, width, height, nearRail).y <= bandBottom - PORTRAIT_APRON_MIN) {
      return anchored;
    }
    return portraitCameraAnchored(width, height, xHalf, nearRail, bandBottom - PORTRAIT_APRON_MIN);
  }
  return TABLE_CAMERA[cls];
}

/**
 * Portrait river-zoom preset: same elevation as `cameraFor` at the
 * river-block scale, panned so the far wall's near-top edge sits at
 * the strip's bottom edge (`ZOOM_WALL_ANCHOR_Y`) — the far wall hides
 * behind the zoom header bar and the free felt between the near wall
 * and the held hand becomes the toast slot. Because the held-hand
 * frame is derived from whichever preset is active, the hand stays put
 * on screen while the table eases in underneath it.
 */
export function riverZoomCameraFor(width: number, height: number, topInset = 0): CameraPreset {
  return portraitCameraAnchored(
    width,
    height,
    PORTRAIT_ZOOM_X_HALF,
    ZOOM_WALL_ANCHOR,
    ZOOM_WALL_ANCHOR_Y + topInset,
  );
}

// ─── Held hand (phone portrait) ────────────────────────────────────
/**
 * Height reserved for the portrait *action tray* between the held hand
 * and the footer row: the turn chip while the table is quiet, the
 * claim strip / declare CTAs when the player has a call. A fixed
 * reservation keeps the hand from jumping when the strip appears, and
 * the two HUD rows under the hand are what closes the band between the
 * near rail and the hand (round-3 critique: 140 px of void there).
 */
export const PORTRAIT_TRAY_H = 84;
/** Gap between the hand's baseline and the tray, and the tray and the footer. */
export const PORTRAIT_TRAY_GAP = 10;
/** Safe-area inset + footer row + tray + gaps, CSS px (matches the shell). */
export const HELD_BOTTOM_PX = 12 + 44 + PORTRAIT_TRAY_GAP + PORTRAIT_TRAY_H + PORTRAIT_TRAY_GAP;
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
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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
