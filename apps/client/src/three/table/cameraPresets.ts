import type { CameraPreset } from '../core/camera';
import { TILE_D, TILE_H } from '../tiles/geometry';
import {
  FELT_HALF,
  HELD_ROW_GAP,
  HELD_ROW_UNITS,
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
/**
 * Lowest elevation the portrait camera drops to on short phones. A phone
 * *in a browser* (1080×1830 device px once the address bar and system
 * bars take their share — ≈ 412×700 CSS px) leaves the table a band of
 * ~290 px between the seat strip and the held hand, where the 70° view
 * of a width-bound table (rail to rail ≈ 26 units) needs ~460. Instead
 * of zooming out until it fits (round-5 feedback: a 280 px table with
 * 65 px void columns and 13 px river tiles), the camera pitches down
 * until the near rail's corners just fill the width (`portraitFitFor`):
 * the table foreshortens into the band, the rails stay flush with the
 * viewport edges and a river tile keeps ~19 px. 50° is the floor: below
 * it the far river's glyphs (upside down, foreshortened to sin 50° ≈
 * 0.77 of their height) stop reading; only the 360×640 class goes
 * further down by zooming out a little at the floor.
 */
export const PORTRAIT_ELEV_MIN_DEG = 50;
export const PORTRAIT_FOV = 44;
/**
 * Portrait discards render 36 % larger than the other table tiles: the
 * full-table view is width-bound at ~17.8 CSS px per tile, and the river
 * is the one zone the player reads at a glance — 1.36 puts a river tile
 * at ~24 CSS px on a 412 px phone (the far row, foreshortened, ~22.5),
 * where the bold-cut 萬 numerals (`faceAtlas.drawMan`) read rather than
 * get guessed (round-4 #1: up from 1.3). It is the most six columns ×
 * three rows can take: with the first row's near edge pinned a fifth of
 * a tile off the plate (`layout.RIVER_NEAR_EDGE`) the third row's far
 * edge lands at 7.92 < 8.12 (the wall's inner edge), a 19th discard's
 * right edge at 8.06, and the dealer chip's pocket beyond the pinwheel
 * arm still clears the wall (`TableScene.CHIP_RADIUS`).
 */
export const PORTRAIT_RIVER_SCALE = 1.36;
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
 * edge is pinned this far under the seat strip. 38 px (round-4: down
 * from 66, which left the largest void in the default phone view) is
 * the least that keeps a 52 px toast — anchored so its bottom clears
 * the far rack's tops by 6 px — from touching the strip: the rack's
 * top edge projects 27 px below the rail's, so rail = strip + 6 + 52
 * − 21 − 1. The slack that used to sit here is spent below the table:
 * a lit ~38 px apron, a taller held-hand row gap and a 96 px action tray
 * (`HELD_ROW_GAP`, `PORTRAIT_TRAY_H`). Falls back to the centred fit
 * when the table fills the band (short phones).
 */
export const PORTRAIT_FAR_RAIL_GAP = 38;
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
  const m = portraitMetrics(height);
  const tilePx = heldHandTilePx(width, height);
  const block = (2 * TILE_H + m.rowGap) * tilePx;
  return height - m.heldBottom - block;
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
  elevDeg: number = PORTRAIT_ELEV_DEG,
): CameraPreset {
  const ppu = Math.max(1, width) / (2 * xHalf);
  const tanV = Math.tan((PORTRAIT_FOV * Math.PI) / 360);
  const dist = Math.max(1, height) / 2 / (tanV * ppu);
  const elev = (elevDeg * Math.PI) / 180;
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
  elevDeg: number = PORTRAIT_ELEV_DEG,
): CameraPreset {
  const ppu = Math.max(1, width) / (2 * xHalf);
  const tanV = Math.tan((PORTRAIT_FOV * Math.PI) / 360);
  const dist = Math.max(1, height) / 2 / (tanV * ppu);
  const elev = (elevDeg * Math.PI) / 180;
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

// ─── Landscape river zoom ──────────────────────────────────────────
/**
 * Elevation of the phone-landscape river zoom. The resting landscape
 * camera sits at 31°, where a flat far-row river tile foreshortens to
 * ~8 CSS px tall and its upside-down 萬 numerals smear (round-4 #2).
 * Round 4 lifted the zoom to 50°; round-5 feedback ("when zooming in
 * the view should be more top down to see the discard pile properly")
 * takes it to 62°: a flat tile keeps sin 62° ≈ 0.88 of its height, so
 * the four rivers read near plan-view with upright proportions, and the
 * block still fits the 2.2 : 1 frame between the chrome row and the
 * footer (the camera backs off a little — ~30 px tiles instead of ~34).
 */
export const LANDSCAPE_ZOOM_ELEV_DEG = 62;
export const LANDSCAPE_ZOOM_FOV = 42;
/**
 * Half-size of the square the zoom frames: the rivers' third-row far
 * edge at the wide presets' 1× scale (`riverMetrics(1).farEdge` ≈ 6.4)
 * plus a little felt, so the far wall's stacks stay behind the chrome
 * and the near wall's under the footer.
 */
export const LANDSCAPE_ZOOM_HALF = 6.75;

/** World point the landscape zoom keeps just off the bottom edge: the near wall's inner top edge. */
export const LANDSCAPE_ZOOM_NEAR_POINT: [number, number, number] = [
  0,
  2 * TILE_D,
  WALL_D - TILE_H / 2,
];

/**
 * Phone-landscape river zoom: a `LANDSCAPE_ZOOM_ELEV_DEG` camera whose
 * distance and pan put the river block's far edge (z = −HALF) at
 * `yTop` — under the chrome row — and the near wall's inner top edge
 * (`LANDSCAPE_ZOOM_NEAR_POINT`) at `yBottom`, just past the viewport's
 * bottom, so the whole near wall, the hand row (z ≈ 11) and the near rail
 * leave the frame and the footer pills sit on felt, never on stacks.
 * Nested bisections: for a distance, the pan (target z) that lands the
 * far edge on `yTop` is monotonic in the target; the near point's y then
 * falls as the distance grows. Pure. The ✕ in the chrome row brings the
 * table back.
 */
export function landscapeZoomCameraFor(
  width: number,
  height: number,
  yTop: number,
  yBottom: number,
): CameraPreset {
  const elev = (LANDSCAPE_ZOOM_ELEV_DEG * Math.PI) / 180;
  const make = (dist: number, tz: number): CameraPreset => ({
    position: [0, dist * Math.sin(elev), tz + dist * Math.cos(elev)],
    target: [0, 0, tz],
    fov: LANDSCAPE_ZOOM_FOV,
  });
  const far: [number, number, number] = [0, TILE_D / 2, -LANDSCAPE_ZOOM_HALF];
  const near = LANDSCAPE_ZOOM_NEAR_POINT;
  const panFor = (dist: number): number => {
    // Larger tz pans the camera toward +z, moving the scene *up* (smaller y).
    let lo = -40;
    let hi = 40;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (projectPreset(make(dist, mid), width, height, far).y > yTop) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // A farther camera spans fewer px per unit, so the near edge rises.
  let lo = 4;
  let hi = 80;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const p = make(mid, panFor(mid));
    if (projectPreset(p, width, height, near).y > yBottom) lo = mid;
    else hi = mid;
  }
  const dist = (lo + hi) / 2;
  return make(dist, panFor(dist));
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
/** The near rail's outer bottom edge (world), on the camera's centre line. */
export const PORTRAIT_NEAR_RAIL_POINT: [number, number, number] = [0, 0, FELT_HALF + RAIL_WIDTH];
/** The near rail's right corner, top edge — the widest projected point of the table. */
const NEAR_RAIL_CORNER: [number, number, number] = [
  FELT_HALF + RAIL_WIDTH,
  RAIL_H,
  FELT_HALF + RAIL_WIDTH,
];
/** Margin the near rail's corners may crop past the viewport edges before the elevation drops. */
const RAIL_FLUSH_PX = 2;

/** Elevation + framed half-width of the portrait full-table camera. */
export interface PortraitFit {
  elevDeg: number;
  xHalf: number;
}

/** Viewport-bound layout the portrait camera fits into (pure). */
export function portraitBandFor(
  width: number,
  height: number,
  topInset = 0,
): { bandTop: number; bandBottom: number } {
  return {
    bandTop: PORTRAIT_BAND_TOP + topInset,
    bandBottom: heldHandTopPx(width, height) - PORTRAIT_BAND_GAP,
  };
}

/**
 * Smallest half-width ≥ `PORTRAIT_X_HALF` at which the table (far rail's
 * top-back edge to near rail's bottom) fits the band at `elevDeg`, near
 * rail anchored `PORTRAIT_APRON_MIN` above the band's bottom. Wider
 * frames span fewer px per unit, so the rail span shrinks monotonically.
 */
function portraitXHalfFor(
  width: number,
  height: number,
  bandTop: number,
  bandBottom: number,
  elevDeg: number,
): number {
  const anchorY = bandBottom - PORTRAIT_APRON_MIN;
  // Rail-to-rail room once the apron is spent: far rail top at or below
  // the band's top.
  const bandH = Math.max(1, anchorY - bandTop);
  const span = (xHalf: number) => {
    const p = portraitCameraAnchored(
      width,
      height,
      xHalf,
      PORTRAIT_NEAR_RAIL_POINT,
      anchorY,
      elevDeg,
    );
    return anchorY - projectPreset(p, width, height, PORTRAIT_FAR_RAIL_POINT).y;
  };
  if (span(PORTRAIT_X_HALF) <= bandH) return PORTRAIT_X_HALF;
  let lo = PORTRAIT_X_HALF;
  let hi = 60;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (span(mid) > bandH) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Portrait fit: the elevation and half-width for a viewport. At
 * `PORTRAIT_ELEV_DEG` the width-bound table (`PORTRAIT_X_HALF`, rails
 * cropping off-screen) either fits the band — tall phones, done — or
 * the camera pitches down (never below `PORTRAIT_ELEV_MIN_DEG`) to the
 * steepest angle at which the fitted frame still keeps the near rail's
 * corners within `RAIL_FLUSH_PX` of the viewport edges: the table
 * shortens on screen without shrinking, so no void column opens beside
 * it. Only when the floor is reached does the frame widen further (the
 * rails then show whole with a little void either side). Pure.
 */
export function portraitFitFor(
  width: number,
  height: number,
  bandTop: number,
  bandBottom: number,
): PortraitFit {
  const fitAt = (elevDeg: number): PortraitFit => ({
    elevDeg,
    xHalf: portraitXHalfFor(width, height, bandTop, bandBottom, elevDeg),
  });
  // Rail corner's screen x for a fit: inside the viewport when ≤ width.
  const cornerX = (fit: PortraitFit) => {
    const p = portraitCameraAnchored(
      width,
      height,
      fit.xHalf,
      PORTRAIT_NEAR_RAIL_POINT,
      bandBottom - PORTRAIT_APRON_MIN,
      fit.elevDeg,
    );
    return projectPreset(p, width, height, NEAR_RAIL_CORNER).x;
  };
  const top = fitAt(PORTRAIT_ELEV_DEG);
  // Width-bound at the default elevation (rails crop): the tall-phone view.
  if (top.xHalf <= PORTRAIT_X_HALF + 1e-6 || cornerX(top) >= width + RAIL_FLUSH_PX) return top;
  const floor = fitAt(PORTRAIT_ELEV_MIN_DEG);
  if (cornerX(floor) <= width + RAIL_FLUSH_PX) return floor;
  // Lower elevation → the fitted frame narrows → the corner moves out.
  let lo = PORTRAIT_ELEV_MIN_DEG;
  let hi = PORTRAIT_ELEV_DEG;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (cornerX(fitAt(mid)) > width + RAIL_FLUSH_PX) lo = mid;
    else hi = mid;
  }
  return fitAt(hi);
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
    const { bandTop, bandBottom } = portraitBandFor(width, height, topInset);
    const { elevDeg, xHalf } = portraitFitFor(width, height, bandTop, bandBottom);
    // Slack in the band: pin the far rail `PORTRAIT_FAR_RAIL_GAP` under
    // the seat strip (toasts sit on the rail; the slack collects as the
    // lit apron above the hand) whenever the near rail then still clears
    // the hand by the minimum apron. A taller table (wide phones, short
    // phones) pins the near rail just above the hand instead and lets
    // the far rail rise toward the strip — the fit above keeps it below
    // the strip.
    const railY = PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H + topInset + PORTRAIT_FAR_RAIL_GAP;
    const anchored = portraitCameraAnchored(
      width,
      height,
      xHalf,
      PORTRAIT_FAR_RAIL_POINT,
      railY,
      elevDeg,
    );
    const nearY = projectPreset(anchored, width, height, PORTRAIT_NEAR_RAIL_POINT).y;
    if (nearY <= bandBottom - PORTRAIT_APRON_MIN) return anchored;
    return portraitCameraAnchored(
      width,
      height,
      xHalf,
      PORTRAIT_NEAR_RAIL_POINT,
      bandBottom - PORTRAIT_APRON_MIN,
      elevDeg,
    );
  }
  return TABLE_CAMERA[cls];
}

/** Elevation (degrees) of the portrait full-table camera for a viewport. */
export function portraitElevationFor(width: number, height: number, topInset = 0): number {
  const { bandTop, bandBottom } = portraitBandFor(width, height, topInset);
  return portraitFitFor(width, height, bandTop, bandBottom).elevDeg;
}

/** World point the river zoom keeps above the held hand: the near wall's outer bottom edge. */
export const ZOOM_NEAR_WALL_POINT: [number, number, number] = [0, 0, WALL_D + TILE_H / 2];
/** Least gap between the near wall's outer edge and the band's bottom while zoomed. */
export const ZOOM_NEAR_WALL_GAP = 4;

/**
 * Portrait river-zoom preset: same elevation as `cameraFor` at the
 * river-block scale, panned so the far wall's near-top edge sits at
 * the strip's bottom edge (`ZOOM_WALL_ANCHOR_Y`) — the far wall hides
 * behind the zoom header bar and the free felt between the near wall
 * and the held hand becomes the toast slot. Because the held-hand
 * frame is derived from whichever preset is active, the hand stays put
 * on screen while the table eases in underneath it. Short phones widen
 * the frame past `PORTRAIT_ZOOM_X_HALF` until the near wall's outer
 * edge clears the band's bottom (round-5: at 412×700 the wall's stacks
 * showed between the hand's rows).
 */
export function riverZoomCameraFor(width: number, height: number, topInset = 0): CameraPreset {
  const { bandBottom } = portraitBandFor(width, height, topInset);
  const elevDeg = portraitElevationFor(width, height, topInset);
  const anchorY = ZOOM_WALL_ANCHOR_Y + topInset;
  const make = (xHalf: number) =>
    portraitCameraAnchored(width, height, xHalf, ZOOM_WALL_ANCHOR, anchorY, elevDeg);
  const nearY = (xHalf: number) =>
    projectPreset(make(xHalf), width, height, ZOOM_NEAR_WALL_POINT).y;
  const limit = bandBottom - ZOOM_NEAR_WALL_GAP;
  if (nearY(PORTRAIT_ZOOM_X_HALF) <= limit) return make(PORTRAIT_ZOOM_X_HALF);
  // A wider frame spans fewer px per unit: the near wall rises (monotonic).
  let lo = PORTRAIT_ZOOM_X_HALF;
  let hi = 40;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (nearY(mid) > limit) lo = mid;
    else hi = mid;
  }
  return make(hi);
}

// ─── Held hand (phone portrait) ────────────────────────────────────
/**
 * Height reserved for the portrait *action tray* between the held hand
 * and the footer row: the turn chip while the table is quiet, the
 * claim strip / declare CTAs when the player has a call. A fixed
 * reservation keeps the hand from jumping when the strip appears, and
 * the two HUD rows under the hand are what closes the band between the
 * near rail and the hand (round-3 critique: 140 px of void there).
 * Tall-phone value; see `portraitMetrics` for the short-phone taper.
 */
export const PORTRAIT_TRAY_H = 96;
/** Gap between the hand's baseline and the tray, and the tray and the footer (tall phones). */
export const PORTRAIT_TRAY_GAP = 10;
/** Safe-area inset + footer row + tray + gaps, CSS px (tall phones; matches the shell). */
export const HELD_BOTTOM_PX = 12 + 44 + PORTRAIT_TRAY_GAP + PORTRAIT_TRAY_H + PORTRAIT_TRAY_GAP;

/**
 * Portrait HUD metrics that give ground on short phones. Everything
 * under the table competes with it for height: at 412×915 the tray
 * (96), its gaps (10 + 10) and a two-row hand at 49.5 px per tile with
 * a 0.55-tile row gap leave a 467 px band; at 412×700 the same stack
 * would leave 254. The metrics taper linearly from the tall values
 * (≥ `PORTRAIT_TALL_H`) to the short ones (≤ `PORTRAIT_SHORT_H`): the
 * tray shrinks to the 84 px its content needs (turn chip + table chip,
 * or the 78 px claim strip), the gaps to 8, the row gap to 0.3 tiles
 * and the tile width caps at 46 px (still ≥ 44 wide, 62 tall) — which
 * buys the table ~40 px, the rest coming from the lower camera
 * (`portraitFitFor`). Pure, rounded to whole px.
 */
export interface PortraitMetrics {
  /** Action tray height, CSS px. */
  trayH: number;
  /** Gap above and below the tray, CSS px. */
  trayGap: number;
  /** Safe pad + footer row + tray + gaps: the held hand's baseline offset from the bottom. */
  heldBottom: number;
  /** Gap between the held hand's two rows, tile widths. */
  rowGap: number;
  /** Own-hand tile width cap on screen, CSS px. */
  tileMax: number;
}
/** Viewport height at (and above) which the tall-phone metrics apply. */
export const PORTRAIT_TALL_H = 860;
/** Viewport height at (and below) which the short-phone metrics apply. */
export const PORTRAIT_SHORT_H = 700;
const PORTRAIT_TRAY_H_SHORT = 84;
const PORTRAIT_TRAY_GAP_SHORT = 8;
const HELD_ROW_GAP_SHORT = 0.3;
const HELD_TILE_MAX_PX_SHORT = 46;

export function portraitMetrics(height: number): PortraitMetrics {
  const h = Number.isFinite(height) ? height : PORTRAIT_TALL_H;
  const t = Math.min(1, Math.max(0, (h - PORTRAIT_SHORT_H) / (PORTRAIT_TALL_H - PORTRAIT_SHORT_H)));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const trayH = Math.round(lerp(PORTRAIT_TRAY_H_SHORT, PORTRAIT_TRAY_H));
  const trayGap = Math.round(lerp(PORTRAIT_TRAY_GAP_SHORT, PORTRAIT_TRAY_GAP));
  return {
    trayH,
    trayGap,
    heldBottom: 12 + 44 + trayGap + trayH + trayGap,
    rowGap: lerp(HELD_ROW_GAP_SHORT, HELD_ROW_GAP),
    tileMax: Math.round(lerp(HELD_TILE_MAX_PX_SHORT, HELD_TILE_MAX_PX)),
  };
}
/** Side margin the hand keeps from the viewport edges, CSS px (the phone safe area). */
export const HELD_SIDE_PX = 12;
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
export function heldHandTilePx(width: number, height: number = PORTRAIT_TALL_H): number {
  // The widest row is the front one: HELD_ROW_MAX − 1 tiles at pitch +
  // the drawn tile with its gap (7.78 tile widths at the default
  // metrics). `heldRowSplit` never lets a row exceed it.
  const px = (width - HELD_SIDE_PX * 2) / HELD_ROW_UNITS;
  return Math.min(portraitMetrics(height).tileMax, Math.max(HELD_TILE_MIN_PX, px));
}

/**
 * Screen-space baseline (CSS px from the top) of the held hand while it
 * is *parked* below the viewport: the whole two-row block plus a margin
 * past the bottom edge, so no tile top peeks in. The tutorial's opening-
 * dice step parks the hand on short phones (`portraitDiceBandShort`):
 * the dense dice card and the lesson card together need ~500 px under
 * the seat strip, and a 412×700 phone has ~300 before the hand — the
 * card would otherwise sit on the dimmed tiles (round-6). The frame is
 * derived from the same preset, so the hand springs up into place when
 * the step advances and the camera never moves.
 */
export function heldHandParkedBaseline(width: number, height: number): number {
  const m = portraitMetrics(height);
  const tilePx = heldHandTilePx(width, height);
  // 40 px past the block: the leaned top row projects a few px above
  // the flat estimate and the DOM hit-targets pad their rects.
  return height + (2 * TILE_H + m.rowGap) * tilePx + PARKED_HAND_MARGIN;
}
/** Margin the parked hand's block keeps below the viewport's bottom edge, CSS px. */
export const PARKED_HAND_MARGIN = 40;

/** Height of the regular (48 px dice, 2×2, stacked totals) opening-rolls glass card, CSS px. */
export const PORTRAIT_DICE_REGULAR_H = 434;
/**
 * Whether the band between the portrait seat strip and the held hand is
 * too short for the regular opening-rolls card: the dense card (40 px
 * dice, inline totals) takes over, and a tutorial step that spotlights
 * the dice parks the hand (`heldHandParkedBaseline`). A phone in a
 * browser (412×700) has ~300 px there; the tall 412×915 has ~490. Pure.
 */
export function portraitDiceBandShort(width: number, height: number, topInset = 0): boolean {
  const stripBottom = PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H + topInset;
  return heldHandTopPx(width, height) - stripBottom < PORTRAIT_DICE_REGULAR_H + 16;
}

/**
 * Height of the dense opening-rolls card (40 px dice, 2×2, inline totals)
 * before it has been measured, CSS px: the footer's dealer line and
 * dismiss hint share a row at ≥ 400 px wide and stack on a 360 px phone.
 */
export function portraitDiceDenseH(width: number): number {
  return width >= 400 ? 229 : 248;
}
/**
 * Height of the basics lesson's dice caption card, CSS px: four body
 * lines at ≥ 400 px wide, five on a 360 px phone (the body wraps).
 */
export function diceLessonCardH(width: number): number {
  return width >= 400 ? 236 : 270;
}
/** Air the tutorial overlay leaves between the dice card and the caption docked under it, CSS px. */
export const DICE_LESSON_GAP = 16;
/**
 * Top edge of the dice card on a short portrait phone while the lesson
 * spotlights it (`portraitDiceBandShort`, hand parked): the dice card and
 * the caption docked under it share the band between the seat strip and
 * the viewport bottom, so the slack splits equally above the dice and
 * below the caption instead of piling up as scrim under a top-pinned
 * stack (round-7). Never closer than 4 px to the strip; a phone whose
 * band the pair fills (360×640) keeps the pinned-top layout. Pure.
 */
export function portraitDiceLessonTop(
  width: number,
  height: number,
  topInset = 0,
  diceCardH: number | null = null,
): number {
  const stripBottom = PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H + topInset;
  const pair = (diceCardH ?? portraitDiceDenseH(width)) + DICE_LESSON_GAP + diceLessonCardH(width);
  const slack = height - stripBottom - pair;
  return stripBottom + Math.max(4, Math.round(slack / 2));
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
  baselineY: number = height - portraitMetrics(height).heldBottom,
): HeldHandFrame {
  const tanV = Math.tan((preset.fov * Math.PI) / 360);
  const m = portraitMetrics(height);
  const tilePx = heldHandTilePx(width, height);
  // Distance along the view axis where one world unit is `tilePx`.
  const d = height / 2 / (tanV * tilePx);
  const pos = preset.position;
  const fwd = norm(sub(preset.target, pos));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = norm(cross(right, fwd));
  const baseY = baselineY;
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
    rowPitch: TILE_H + m.rowGap,
  };
}

// ─── Portrait result card (`hud/ResultVeil`) ──────────────────────
/** Compact glass result card height assumed before it has been measured, CSS px. */
export const RESULT_PANEL_H_ESTIMATE = 350;
/**
 * Room a scoring-lesson caption card needs above a bottom-pinned result
 * card: the card's height (six body lines at ≥ 400 px wide, seven on a
 * 360 px phone — the body wraps) plus the overlay's 14 px dock gap and
 * 12 px safe inset.
 */
export function resultCaptionNeed(width: number): number {
  return (width >= 400 ? 272 : 316) + 14 + 12;
}
/**
 * Whether the portrait result card pins to the top of the veil. When
 * the band above a bottom-pinned card is shorter than a caption card
 * (`resultCaptionNeed`), the tutorial overlay's only option is its
 * overlap fallback — at 360×640 the card sat over the whole panel and
 * only the faan header peeked out (round-6). Pinned to the top, the
 * spotlit header + winning hand stay clear and the card docks below
 * them over the dimmed rules / buttons, as on the tall phone. Pure.
 */
export function resultPanelPinsTop(width: number, height: number, panelH: number | null): boolean {
  const pad = 12;
  const panel = panelH ?? RESULT_PANEL_H_ESTIMATE;
  return height - 2 * pad - panel < resultCaptionNeed(width);
}
