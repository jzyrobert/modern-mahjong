import {
  Euler,
  FogExp2,
  Mesh,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShadowMaterial,
  Vector3,
} from 'three';
import { PCFShadowMap } from 'three';
import type { TileBackSkin } from '../../state/game';
import { getHeroBand, heroBandVersion, subscribeHeroBand } from '../../ui/menu/heroBand';
import {
  OCCLUDER_BAND_PX,
  type OccluderRect,
  getOccluders,
  occluderFactor,
  occluderVersion,
  rectSignedDistance,
  subscribeOccluders,
} from '../../ui/menu/menuOccluders';
import type { SceneContext, SceneHandle } from '../core/SceneHost';
import { buildLights } from '../core/lights';
import { clamp01, easeOutCubic, lerp } from '../core/tween';
import { TilePool } from '../tiles/TilePool';
import { BACK_CELL } from '../tiles/faceAtlas';
import { TILE_D, TILE_H, TILE_W } from '../tiles/geometry';
import { createDice } from './dice';
import {
  DIE_R,
  DRIFT_COUNT,
  type DriftTile,
  HERO_COUNT,
  MENU_TILE_COUNT,
  type MenuLayout,
  type MenuView,
  type Slot,
  diceCandidateOffsets,
  driftCandidates,
  driftField,
  fanSlots,
  frameWidthAt,
  heroCells,
  inKeepOut,
  menuLayout,
  placeOutsideKeepOut,
  seededRandom,
  wrapDriftY,
  wrapUnit,
} from './layout';

/**
 * Menu hero backdrop. A fanned winning hand + two dice rest on an
 * unseen felt plane (ShadowMaterial — only the soft key-light shadows
 * paint), while a sparse field of tiles drifts very slowly in the fog
 * behind them. The canvas is transparent; the void gradient is DOM.
 *
 * Motion budget (ARCHITECTURE.md §2): an intro settle of ~1.5 s, then
 * the field drifts at a throttled ~11 fps cadence (render-on-demand —
 * the loop skips `renderer.render` between drift steps) and springs to
 * full rate only while the pointer moves. Reduced motion: no intro,
 * no drift, no parallax → the loop idles completely.
 */
export interface MenuSceneOptions {
  tileBack: TileBackSkin;
}

const INTRO_DELAY_MS = 120;
const INTRO_STAGGER_MS = 45;
const INTRO_TILE_MS = 720;
const INTRO_DRIFT_MS = 700;
const INTRO_DICE_MS = 820;
const RELAYOUT_MS = 420;
/** Drift renders at this cadence when the pointer is still. */
const DRIFT_STEP_MS = 90;
/** Pointer movement keeps full-rate rendering alive for this long. */
const POINTER_HOT_MS = 700;
const FOG_COLOR = 0x0f1914;
/**
 * Visibility cap for a drift tile sitting fully inside a glass card
 * (`occluderFactor`'s `glassInterior`): 0 — the field stays out of the
 * cards on every class. Wide viewports used to keep 40 %-size tiles
 * behind the glass as depth cues, but at 16 px blur they were not
 * recognisable as tiles and read as smudges under the card copy.
 */
const GLASS_INTERIOR = 0;
/** Fraction of a drift tile's disc allowed past the frame edge while
 *  the field moves. A frozen (reduced-motion) field keeps whole discs
 *  inside the frame (`FRAME_SLACK_FROZEN`, negative = inset) so no tile
 *  stays half-cut forever. */
const FRAME_SLACK = 0.5;
/** Frozen field: whole disc inside the frame; portrait keeps ≥ 70 % of
 *  the (over-bounding) disc inside — its only open ground is the hero
 *  band's narrow side margins, and the disc is ~2× the tile's area. */
const FRAME_SLACK_FROZEN = -1.0;
const FRAME_SLACK_FROZEN_PORTRAIT = -0.4;
/** Phones: the hero rack's projected silhouette (tiles + dice) is a
 *  solid keep-out with this fade ramp, so a drifting tile is gone
 *  before any part of it can poke out from under the rack's edge
 *  (slivers there read as debris). The drift disc (`TILE_R`) already
 *  over-bounds the tile's silhouette, so a disc merely tangent to the
 *  rack is clear of it; the ramp only needs to cover projection slop,
 *  and staying short keeps the hero band's ~40 px side margins open
 *  for whole far tiles. Wide viewports let tiles pass behind the fan:
 *  one peeking past its edge there is real depth. */
const RACK_BAND_PX = 2;
/** Re-seed lattice columns: portrait's only open ground is the hero
 *  band's narrow side margins, which a 14-column lattice (~30 px
 *  steps on a 412 px phone) skips right over. */
const LATTICE_COLS_PORTRAIT = 28;
/** DOM rects keep moving for a while after the scene mounts (the cards'
 *  entrance slide, the 800 ms settle re-measure): re-run the keep-out
 *  placement on every rect change inside this window after build. */
const OCCLUDER_SETTLE_MS = 3000;
/** Below this best-case visibility a re-seeded tile is parked (hidden)
 *  rather than shown as a speck in an edge band. */
const PARK_BELOW = 0.75;
/** Minimum centre distance between re-seeded tiles, in summed radii. */
const SPREAD = 1.6;
/** Fade / keep-out disc radii in world units. */
const TILE_R = TILE_H * 0.72;
/** Dice re-placement after a resize waits for the camera ease (0 under
 *  reduced motion, where the camera snaps and the loop idles). */
const DICE_PLACE_DELAY_MS = 450;
/** Intro is fully settled (hero + dice) by this many ms after mount. */
const MENU_MOTION_SETTLE_MS = Math.max(
  INTRO_DELAY_MS + (HERO_COUNT - 1) * INTRO_STAGGER_MS + INTRO_TILE_MS,
  520 + 160 + INTRO_DICE_MS,
);

declare global {
  /** `'running'` from scene build until the intro tweens finish, then
   *  `'settled'`; `undefined` when no menu scene is mounted. */
  // eslint-disable-next-line no-var
  var __MAHJONG_MENU_INTRO__: 'running' | 'settled' | undefined;
  /** Drift-field diagnostics for the verifier / specs: how many DOM
   *  occluders the scene sees, each visible tile's fade factor and
   *  projected disc (CSS px), and the dice pair's keep-out factors. */
  // eslint-disable-next-line no-var
  var __MAHJONG_MENU_DEBUG__:
    | {
        occluders: number;
        /** The rects the fade currently runs against (CSS px). */
        occluderRects: OccluderRect[];
        reseeded: boolean;
        visible: number;
        /** Visible-slot tiles the re-seed parked (no open spot) — hidden. */
        parked: number;
        fades: number[];
        tiles: { x: number; y: number; r: number; fade: number; parked: boolean }[];
        /** Keep-out factor per die (1 = clear of every rect). */
        dice: number[];
        /** How many times the dice keep-out pass ran, and how many DOM
         *  rects it saw the last time. */
        dicePlaceRuns: number;
        dicePlaceRects: number;
        /** Projected disc per die, CSS px. */
        diceRects: { x: number; y: number; r: number }[];
        /** The hero rack's projected footprint (phones: a solid keep-out). */
        rack: { x: number; y: number; w: number; h: number };
        /** The measured hero band the layout was fitted to (unscrolled
         *  viewport CSS px), `null` while the DOM has not reported one. */
        band: { x: number; y: number; w: number; h: number } | null;
        /** Where the pure layout maths expects the settled rack (tiles
         *  + dice) to project — the live `rack` converges on it. */
        rackGoal: { x: number; y: number; w: number; h: number } | null;
      }
    | undefined;
}

interface Tween {
  start: number;
  duration: number;
}

interface HeroTile {
  fromPos: Vector3;
  fromQuat: Quaternion;
  toPos: Vector3;
  toQuat: Quaternion;
  tween: Tween;
}

interface DriftState extends DriftTile {
  ax: number;
  ay: number;
  scaleTween: Tween;
  /** Re-seed found no spot with any visibility: the tile is hidden
   *  rather than left on its seed (which may sit under the rack or
   *  half off the frame). */
  parked: boolean;
}

const _obj = new Object3D();
const _euler = new Euler();
const TILE_CORNERS: readonly [number, number, number][] = [
  [-1, -1, -1],
  [1, -1, -1],
  [-1, 1, -1],
  [1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [-1, 1, 1],
  [1, 1, 1],
];
const _q = new Quaternion();
const _vWorld = new Vector3();
const _vCam = new Vector3();
const _vNdc = new Vector3();

function tweenProgress(t: Tween, now: number): number {
  if (t.duration <= 0) return 1;
  return easeOutCubic(clamp01((now - t.start) / t.duration));
}

function slotQuat(s: Slot, out: Quaternion): Quaternion {
  return out.setFromEuler(_euler.set(s.rx, s.ry, s.rz, 'XYZ'));
}

export function buildMenuScene(ctx: SceneContext, opts: MenuSceneOptions): SceneHandle {
  const { scene, renderer, rig, quality, loop, reducedMotion } = ctx;
  const snap = reducedMotion;
  // three ≥ 0.18x retired PCFSoftShadowMap (SceneHost's default) and
  // logs a deprecation warning on the first shadow pass; pick the
  // supported filter up front so the console stays clean.
  renderer.shadowMap.type = PCFShadowMap;

  const menuView = (width: number, height: number): MenuView => ({
    width,
    height,
    band: getHeroBand(),
  });
  let layout: MenuLayout = menuLayout(
    ctx.size.width / Math.max(1, ctx.size.height),
    menuView(ctx.size.width, ctx.size.height),
  );
  rig.snap(layout.camera);
  rig.halfLife = 0.28;

  // ── Lights + unseen felt ───────────────────────────────────────────
  const lights = buildLights(scene, renderer, quality, {
    keyColor: 0xffe4bd,
    skyColor: 0xc9d6e6,
    groundColor: 0x1e2a23,
    shadowExtent: 9.5,
  });
  lights.key.position.set(-5, 8.5, 6.5);
  lights.key.intensity = 2.5;
  lights.key.shadow.camera.far = 18;
  lights.key.shadow.bias = -0.0008;
  lights.hemi.intensity = 0.75;
  lights.ambient.intensity = 0.1;
  if (scene.environment) scene.environmentIntensity = 0.45;

  const floorGeo = new PlaneGeometry(80, 80);
  const floorMat = new ShadowMaterial({ color: 0x000000, opacity: 0.5 });
  const floor = new Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.001;
  floor.receiveShadow = true;
  scene.add(floor);

  scene.fog = new FogExp2(FOG_COLOR, layout.fogDensity);

  // ── Tiles ──────────────────────────────────────────────────────────
  const pool = new TilePool(opts.tileBack);
  pool.mesh.count = MENU_TILE_COUNT;
  scene.add(pool.mesh);

  const rnd = seededRandom(31);
  const introStart = performance.now();
  // Verifier hook: the shot recipes wait for the intro to settle
  // instead of sleeping a fixed time (`scripts/shot-states.mjs`).
  globalThis.__MAHJONG_MENU_INTRO__ = 'running';
  const settleAt = introStart + (snap ? 0 : MENU_MOTION_SETTLE_MS) + 50;
  const hero: HeroTile[] = [];
  const slots = fanSlots(HERO_COUNT, layout.fan);
  for (let i = 0; i < HERO_COUNT; i++) {
    const s = slots[i]!;
    const toPos = new Vector3(s.x, s.y, s.z);
    const toQuat = slotQuat(s, new Quaternion());
    const fromPos = toPos.clone().add(new Vector3((rnd() - 0.5) * 1.2, 2.4 + rnd() * 1.2, 0.9));
    const fromQuat = toQuat
      .clone()
      .multiply(_q.setFromEuler(_euler.set(-0.7, (rnd() - 0.5) * 1.1, (rnd() - 0.5) * 0.4)));
    hero.push({
      fromPos,
      fromQuat,
      toPos,
      toQuat,
      tween: {
        start: introStart + INTRO_DELAY_MS + i * INTRO_STAGGER_MS,
        duration: snap ? 0 : INTRO_TILE_MS,
      },
    });
    const p = pool.pose(i);
    p.visible = true;
    p.faceCell = heroCells(layout.fan.rows)[i] ?? 0;
    p.tint.setScalar(1);
  }

  const drift: DriftState[] = driftField(DRIFT_COUNT).map((d) => ({
    ...placeOutsideKeepOut(d, layout.keepOut),
    ax: d.rx,
    ay: d.ry,
    parked: false,
    scaleTween: {
      start: introStart + 200 + d.stagger * 520,
      duration: snap ? 0 : INTRO_DRIFT_MS,
    },
  }));
  drift.forEach((d, j) => {
    const p = pool.pose(HERO_COUNT + j);
    p.visible = true;
    p.faceCell = d.cell < 0 ? BACK_CELL : d.cell;
    // Far tiles sink toward the void: dimmer body + the fog does the rest.
    const shade = lerp(0.92, 0.5, d.depth);
    p.tint.setScalar(shade);
  });

  // ── DOM occluders (cards, footer, title) ───────────────────────────
  // Lobby surfaces register their window rects (`useMenuOccluder`); a
  // drift tile shrinks to nothing while it straddles a glass edge or
  // crosses solid copy (`occluderFactor`). Rects change on scroll /
  // resize, so a change wakes the loop for one pass.
  /** Rects the lobby DOM registered — the gate for re-seeding. */
  let domOccluders: OccluderRect[] = getOccluders();
  /** DOM rects + the scene's own keep-outs (`sceneOccluders`). */
  let occluders: OccluderRect[] = domOccluders;
  let occluderSeen = occluderVersion();
  let reseeded = false;
  const unsubscribeOccluders = subscribeOccluders(() => loop.requestRender());

  /** World position of a drift tile at normalised (ux, uy) — the same
   *  mapping `writeDrift` uses (field plane `depth` behind the hero,
   *  centred on the tilted optical axis, spanning the off-centre
   *  frustum). `parX` / `parY` are the pointer-parallax offsets. */
  const driftWorldPos = (
    d: { depth: number },
    ux: number,
    uy: number,
    parX: number,
    parY: number,
    out: Vector3,
  ): Vector3 => {
    const cam = layout.camera;
    const cosE = Math.cos(layout.elevation);
    const tanE = Math.tan(layout.elevation);
    const depth = layout.drift.near + d.depth * (layout.drift.far - layout.drift.near);
    const dist = layout.distance + depth / cosE;
    const halfW = (frameWidthAt(dist, cam.fov, layout.aspect) / 2) * 1.08;
    const halfH = halfW / layout.aspect / cosE;
    const yc = cam.target[1] - depth * tanE;
    const vc = layout.viewCenter;
    return out.set(
      (ux + 1 - 2 * vc.x) * halfW + parX,
      yc + (2 * vc.y - 1 - uy) * halfH + parY,
      -depth,
    );
  };

  /** Exact screen position (CSS px) + projected radius of a disc of
   *  `worldRadius` at a world point through the live camera (view
   *  offset included). */
  const projectPoint = (
    world: Vector3,
    worldRadius: number,
    out: { x: number; y: number; r: number },
  ) => {
    const camera = rig.camera;
    _vCam.copy(world).applyMatrix4(camera.matrixWorldInverse);
    const depth = Math.max(0.01, -_vCam.z);
    _vNdc.copy(world).project(camera);
    out.x = ((_vNdc.x + 1) / 2) * ctx.size.width;
    out.y = ((1 - _vNdc.y) / 2) * ctx.size.height;
    const pxPerUnit = ctx.size.height / (2 * depth * Math.tan((camera.fov * Math.PI) / 360));
    out.r = worldRadius * pxPerUnit;
  };

  /**
   * The hero rack's projected silhouette (every hero tile's eight
   * corners at its resting pose, plus the dice pair's discs), in CSS
   * px through the live camera — tight to the pixels the rack covers,
   * unlike the disc union, which over-bounds a leaning tile by ~20 px
   * a side.
   */
  const rackRect = (): OccluderRect => {
    const proj = { x: 0, y: 0, r: 0 };
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    const grow = (x: number, y: number, r: number) => {
      x0 = Math.min(x0, x - r);
      y0 = Math.min(y0, y - r);
      x1 = Math.max(x1, x + r);
      y1 = Math.max(y1, y + r);
    };
    for (const h of hero) {
      for (const c of TILE_CORNERS) {
        _vWorld
          .set((c[0] * TILE_W) / 2, (c[1] * TILE_H) / 2, (c[2] * TILE_D) / 2)
          .applyQuaternion(h.toQuat)
          .add(h.toPos);
        projectPoint(_vWorld, 0, proj);
        grow(proj.x, proj.y, 0);
      }
    }
    for (const d of layout.dice) {
      projectPoint(_vWorld.set(d.x, d.y, d.z), DIE_R, proj);
      grow(proj.x, proj.y, proj.r);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, kind: 'solid', band: RACK_BAND_PX };
  };

  /**
   * Keep-outs the DOM never registers: the root FULLSCREEN / DISMISS
   * chip in the top-right corner of landscape phones, and — on phones
   * — the hero rack itself, so a drifting tile fades out before any
   * part of it can poke out from under the rack's edge (a blue corner
   * under the bottom-right 中 read as debris). Wide viewports let tiles
   * pass behind the fan: a tile peeking past its edge there is depth.
   */
  const chromeOccluders = (): OccluderRect[] =>
    layout.cls === 'landscape-phone'
      ? [{ x: ctx.size.width - 236, y: 0, w: 236, h: 104, kind: 'solid' }]
      : [];
  const sceneOccluders = (): OccluderRect[] => {
    const out = chromeOccluders();
    if (layout.cls !== 'wide') {
      rig.camera.updateMatrixWorld();
      out.push(rackRect());
    }
    return out;
  };
  const refreshOccluders = () => {
    occluderSeen = occluderVersion();
    domOccluders = getOccluders();
    occluders = [...domOccluders, ...sceneOccluders()];
  };
  refreshOccluders();

  /**
   * Bias the seed field toward the open void: once the DOM rects are
   * known, every visible tile that would start faded (behind an edge or
   * inside copy) scans a stratified lattice of alternatives
   * (`driftCandidates`) and keeps the most visible one. Phones send
   * every tile to a spot clear of *every* rect first (the card column
   * is the whole width there and the form is high-attention); wide
   * viewports keep ~40 % deep behind glass where the blur reads as
   * depth. Tiles that find no open spot fall back to the best "any"
   * spot, where the glass-interior cap shrinks them to depth cues. A
   * spot mostly hidden behind the hero rack, off-screen or crowding an
   * already-placed tile scores zero. With reduced motion the field never
   * moves, so this decides how full the backdrop looks; in motion mode
   * it just makes the first settled frame read better.
   */
  const reseedForOccluders = () => {
    if (reseeded || domOccluders.length === 0) return;
    reseeded = true;
    const rnd = seededRandom(97);
    const proj = { x: 0, y: 0, r: 0 };
    // The rack's own screen footprint. On wide viewports a seed whose
    // centre is behind the hero tiles is hidden by them, so the seeding
    // avoids it — a tile peeking out from behind the fan's edge is real
    // depth and stays allowed. On phones the rack is already a solid
    // keep-out in `occluders` (`sceneOccluders`), so every disc that
    // touches it scores zero through `occluderFactor` as well.
    const rack = rackRect();
    const solid: OccluderRect[] = occluders.map((r) => ({ ...r, kind: 'solid' as const }));
    const W = ctx.size.width;
    const H = ctx.size.height;
    const slack = !reducedMotion
      ? FRAME_SLACK
      : layout.cls === 'portrait'
        ? FRAME_SLACK_FROZEN_PORTRAIT
        : FRAME_SLACK_FROZEN;
    const taken: { x: number; y: number; r: number }[] = [];
    const blocked = (x: number, y: number, r: number) =>
      x + r * slack < 0 ||
      x - r * slack > W ||
      y + r * slack < 0 ||
      y - r * slack > H ||
      (layout.cls === 'wide' && rectSignedDistance(x, y, rack) < -r * 0.3) ||
      taken.some((t) => Math.hypot(t.x - x, t.y - y) < (t.r + r) * SPREAD);
    const factorAt = (
      d: DriftState,
      ux: number,
      uy: number,
      rects: OccluderRect[],
      interior: number,
    ) => {
      if (inKeepOut(ux, uy, layout.keepOut)) return 0;
      projectPoint(driftWorldPos(d, ux, uy, 0, 0, _vWorld), TILE_R, proj);
      if (blocked(proj.x, proj.y, proj.r)) return 0;
      return occluderFactor(proj.x, proj.y, proj.r, rects, OCCLUDER_BAND_PX, interior);
    };
    const cands = driftCandidates(layout.cls === 'portrait' ? LATTICE_COLS_PORTRAIT : undefined);
    const interior = GLASS_INTERIOR;
    let openLeft = layout.driftVisible;
    // Nearest (largest, brightest) tiles pick first so the open void
    // gets the ones that actually read; far tiles can sit behind glass.
    const order = drift
      .map((d, j) => ({ d, j }))
      .filter((x) => x.j < layout.driftVisible)
      .sort((a, b) => a.d.depth - b.d.depth)
      .map((x) => x.d);
    for (const d of order) {
      let bestOpen = factorAt(d, d.ux, d.uy, solid, 1);
      let bestAny = factorAt(d, d.ux, d.uy, occluders, interior);
      const opens: { ux: number; uy: number }[] = bestOpen >= 0.9 ? [{ ux: d.ux, uy: d.uy }] : [];
      let openX = d.ux;
      let openY = d.uy;
      let anyX = d.ux;
      let anyY = d.uy;
      if (bestOpen < 0.9) {
        for (const c of cands) {
          const fOpen = factorAt(d, c.ux, c.uy, solid, 1);
          if (fOpen >= 0.9) opens.push(c);
          if (fOpen > bestOpen) {
            bestOpen = fOpen;
            openX = c.ux;
            openY = c.uy;
          }
          const fAny = fOpen >= 0.9 ? fOpen : factorAt(d, c.ux, c.uy, occluders, interior);
          if (fAny > bestAny) {
            bestAny = fAny;
            anyX = c.ux;
            anyY = c.uy;
          }
        }
      }
      if (Math.max(bestOpen, bestAny) < PARK_BELOW) {
        // Nowhere worth going (blocked, straddling or off-frame
        // everywhere the lattice looked, or only a speck in an edge
        // band): hide it. Leaving it on its seed is how a far back
        // ended up poking out from under the phone rack and how frozen
        // reduced-motion fields kept tiles half-cut at the edge.
        d.parked = true;
        continue;
      }
      d.parked = false;
      if (opens.length > 0 && (openLeft > 0 || bestOpen >= bestAny)) {
        // Any fully open spot is as good as another — pick one at random
        // so the field spreads instead of filling lattice order.
        const pick = opens[Math.floor(rnd() * opens.length)] ?? { ux: openX, uy: openY };
        openLeft--;
        d.ux = pick.ux;
        d.uy = pick.uy;
      } else if (bestOpen >= bestAny) {
        d.ux = openX;
        d.uy = openY;
      } else {
        d.ux = anyX;
        d.uy = anyY;
      }
      projectPoint(driftWorldPos(d, d.ux, d.uy, 0, 0, _vWorld), TILE_R, proj);
      taken.push({ x: proj.x, y: proj.y, r: proj.r });
    }
  };

  // ── Dice ───────────────────────────────────────────────────────────
  const dice = createDice(2);
  scene.add(dice);
  const diceTween: Tween[] = [0, 1].map((i) => ({
    start: introStart + 520 + i * 160,
    duration: snap ? 0 : INTRO_DICE_MS,
  }));
  /** Where each die rests (layout slot + the keep-out nudge). */
  const diceRest: Slot[] = layout.dice.map((d) => ({ ...d }));
  /** Eased move from the previous rest when a nudge lands post-intro. */
  const diceMove = diceRest.map((d) => ({ from: { ...d }, tween: { start: 0, duration: 0 } }));
  let dicePlaced = false;
  let dicePlaceAfter = 0;
  /** Wakes the (possibly idle) loop once the camera ease is over so the
   *  deferred keep-out pass actually runs. */
  let diceWake: ReturnType<typeof setTimeout> | undefined;
  const debugDice: number[] = [1, 1];
  let dicePlaceRuns = 0;
  let dicePlaceRects = 0;
  let diceMoved = false;

  /** Keep-out factor for a die resting at `slot` against every DOM rect
   *  (glass edges + solid copy), zero when its disc leaves the frame. */
  const diceFactor = (slot: Slot): number => {
    const proj = { x: 0, y: 0, r: 0 };
    _vWorld.set(slot.x, slot.y, slot.z);
    projectPoint(_vWorld, DIE_R, proj);
    if (
      proj.x - proj.r < 0 ||
      proj.x + proj.r > ctx.size.width ||
      proj.y - proj.r < 0 ||
      proj.y + proj.r > ctx.size.height
    )
      return 0;
    // DOM rects + chrome only: the rack keep-out in `occluders` is the
    // dice's own footprint.
    return occluderFactor(
      proj.x,
      proj.y,
      proj.r,
      [...domOccluders, ...chromeOccluders()],
      OCCLUDER_BAND_PX,
      1,
    );
  };

  /**
   * Run the dice pair through the same keep-out test as the drift
   * field: if either die straddles a glass edge (or sits on copy) in
   * its layout slot, nudge the pair along `diceCandidateOffsets` until
   * both clear every rect, else keep the best offset found. Once per
   * layout (not on scroll — the dice can't fade, and a scrolled card
   * over the hero band is transient). After the intro the move eases.
   */
  const placeDice = (now: number) => {
    if (dicePlaced || domOccluders.length === 0 || now < dicePlaceAfter) return;
    dicePlaced = true;
    dicePlaceRuns++;
    dicePlaceRects = domOccluders.length;
    let best = { dx: 0, dz: 0 };
    let bestF = Number.NEGATIVE_INFINITY;
    let bestFs = [1, 1];
    for (const o of diceCandidateOffsets(layout.cls)) {
      const fs = layout.dice.map((d) => diceFactor({ ...d, x: d.x + o.dx, z: d.z + o.dz }));
      const f = Math.min(fs[0] ?? 0, fs[1] ?? 0);
      if (f > bestF) {
        bestF = f;
        best = o;
        bestFs = fs;
      }
      if (f >= 0.9) break;
    }
    const last = diceTween[1]!;
    const settled = now >= last.start + last.duration;
    for (let i = 0; i < 2; i++) {
      const d = layout.dice[i]!;
      const to: Slot = { ...d, x: d.x + best.dx, z: d.z + best.dz };
      const rest = diceRest[i]!;
      const move = diceMove[i]!;
      if (settled && (to.x !== rest.x || to.z !== rest.z)) {
        move.from = { ...rest };
        move.tween = { start: now, duration: snap ? 0 : RELAYOUT_MS };
      } else {
        move.from = to;
        move.tween = { start: now, duration: 0 };
      }
      diceRest[i] = to;
      debugDice[i] = bestFs[i] ?? 1;
    }
    // The hero pass for this frame has already run: pose the dice next
    // frame and make sure that frame renders even if nothing else is
    // live (a frozen reduced-motion scene otherwise idles on the frame
    // that still shows the un-nudged pair).
    heroLive = true;
    diceMoved = true;
  };

  // ── Pointer parallax ───────────────────────────────────────────────
  const parallaxOn = quality.parallax && !reducedMotion;
  const pointer = { x: 0, y: 0 };
  const pointerSmooth = { x: 0, y: 0 };
  let lastPointerAt = Number.NEGATIVE_INFINITY;
  const onPointer = (e: PointerEvent) => {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    pointer.x = (e.clientX / w) * 2 - 1;
    pointer.y = -((e.clientY / h) * 2 - 1);
    lastPointerAt = performance.now();
    rig.setPointer(pointer.x, pointer.y);
  };
  if (parallaxOn) window.addEventListener('pointermove', onPointer, { passive: true });

  // ── Per-frame pose writers ─────────────────────────────────────────
  let heroLive = true;
  let driftAccum = 0;
  let driftLive = true;
  let firstFrame = true;

  const writeHero = (now: number): boolean => {
    let live = false;
    const px = pointerSmooth.x * 0.22;
    const py = pointerSmooth.y * 0.1;
    for (let i = 0; i < HERO_COUNT; i++) {
      const h = hero[i]!;
      const e = tweenProgress(h.tween, now);
      if (e < 1) live = true;
      const p = pool.pose(i);
      p.position.lerpVectors(h.fromPos, h.toPos, e);
      p.position.x += px;
      p.position.y += py;
      p.quaternion.slerpQuaternions(h.fromQuat, h.toQuat, e);
      p.scale = 1;
    }
    return live;
  };

  const _proj = { x: 0, y: 0, r: 0 };
  const debugFades: number[] = [];
  const debugTiles: { x: number; y: number; r: number; fade: number; parked: boolean }[] = [];
  const writeDrift = (now: number, dt: number): boolean => {
    let live = false;
    if (!reseeded || !dicePlaced || occluderVersion() !== occluderSeen) {
      // Projection needs the camera's matrices for this frame.
      rig.camera.updateMatrixWorld();
      const changed = occluderVersion() !== occluderSeen;
      refreshOccluders();
      // The lobby's rects settle over the first seconds (entrance slide,
      // the 800 ms re-measure): a placement made against a card that is
      // still sliding in leaves a die on its final corner, so redo the
      // dice (eased) — and the frozen reduced-motion field, whose one
      // frame is all anyone sees — while rects are still changing.
      if (changed && now - introStart < OCCLUDER_SETTLE_MS) {
        dicePlaced = false;
        if (snap) reseeded = false;
      }
      reseedForOccluders();
      placeDice(now);
    }
    for (let j = 0; j < drift.length; j++) {
      const d = drift[j]!;
      if (dt > 0) {
        d.ux = wrapUnit(d.ux + d.vx * dt);
        d.uy = wrapDriftY(d.uy + d.vy * dt, d.ux, layout.keepOut);
        d.ax += d.wx * dt;
        d.ay += d.wy * dt;
      }
      // The field is a vertical plane `depth` behind the hero. The
      // camera looks down by `layout.elevation`, so its optical axis
      // meets that plane below the target and the frustum's vertical
      // extent on the plane stretches by 1 / cos(e). Centring the field
      // on that point keeps screen position ≈ (ux, uy) at every depth —
      // far tiles don't bunch toward the top, and the title keep-out
      // (`layout.keepOut`) means what it says. Mapping the normalised
      // field onto the (off-centre) frustum covers the whole viewport,
      // not just the region around the hero.
      const par = parallaxOn ? 0.35 + d.depth * 1.1 : 0;
      const e = tweenProgress(d.scaleTween, now);
      if (e < 1) live = true;
      const p = pool.pose(HERO_COUNT + j);
      p.visible = j < layout.driftVisible && !d.parked;
      driftWorldPos(d, d.ux, d.uy, pointerSmooth.x * par, pointerSmooth.y * par * 0.5, p.position);
      p.quaternion.setFromEuler(_euler.set(d.ax, d.ay, d.rz, 'XYZ'));
      // Shrink to nothing while straddling a glass edge / crossing copy,
      // and to a faint depth cue while fully behind a glass card.
      let fade = 1;
      if (domOccluders.length > 0) {
        projectPoint(p.position, TILE_R, _proj);
        fade = occluderFactor(
          _proj.x,
          _proj.y,
          _proj.r,
          occluders,
          OCCLUDER_BAND_PX,
          GLASS_INTERIOR,
        );
      } else {
        projectPoint(p.position, TILE_R, _proj);
      }
      if (d.parked) fade = 0;
      p.scale = 0.001 + 0.999 * e * fade;
      debugFades[j] = fade;
      debugTiles[j] = { x: _proj.x, y: _proj.y, r: _proj.r * fade, fade, parked: d.parked };
    }
    let parked = 0;
    for (let j = 0; j < layout.driftVisible; j++) if (drift[j]?.parked) parked++;
    const rack =
      layout.cls === 'wide' ? rackRect() : (occluders[occluders.length - 1] ?? rackRect());
    globalThis.__MAHJONG_MENU_DEBUG__ = {
      occluders: occluders.length,
      occluderRects: occluders.map((r) => ({ ...r })),
      reseeded,
      visible: layout.driftVisible,
      parked,
      fades: debugFades.slice(0, layout.driftVisible),
      tiles: debugTiles.slice(0, layout.driftVisible),
      dice: [...debugDice],
      dicePlaceRuns,
      dicePlaceRects,
      diceRects: debugDiceRects.map((r) => ({ ...r })),
      rack: { x: rack.x, y: rack.y, w: rack.w, h: rack.h },
      band: layout.band ? { ...layout.band } : null,
      rackGoal: layout.footprint ? { ...layout.footprint.all } : null,
    };
    return live;
  };

  const debugDiceRects = [
    { x: 0, y: 0, r: 0 },
    { x: 0, y: 0, r: 0 },
  ];
  const writeDice = (now: number): boolean => {
    let live = false;
    for (let i = 0; i < 2; i++) {
      const s = diceRest[i]!;
      const m = diceMove[i]!;
      const e = tweenProgress(diceTween[i]!, now);
      const em = tweenProgress(m.tween, now);
      if (e < 1 || em < 1) live = true;
      _obj.position.set(
        lerp(m.from.x, s.x, em) + pointerSmooth.x * 0.22,
        s.y + (1 - e) * 2.6 + pointerSmooth.y * 0.1,
        lerp(m.from.z, s.z, em),
      );
      _obj.quaternion.setFromEuler(
        _euler.set(s.rx + (1 - e) * 2.2, s.ry + (1 - e) * 3.1, s.rz + (1 - e) * 1.3, 'XYZ'),
      );
      _obj.scale.setScalar(1);
      _obj.updateMatrix();
      dice.setMatrixAt(i, _obj.matrix);
      projectPoint(_obj.position, DIE_R, debugDiceRects[i]!);
    }
    dice.instanceMatrix.needsUpdate = true;
    return live;
  };

  /** Off-axis frustum so the hero lands at `layout.viewCenter`. */
  const applyViewOffset = (width: number, height: number) => {
    const vc = layout.viewCenter;
    rig.camera.setViewOffset(
      width,
      height,
      Math.round((0.5 - vc.x) * width),
      Math.round((0.5 - vc.y) * height),
      width,
      height,
    );
    rig.camera.updateProjectionMatrix();
  };

  const applyLayout = (width: number, height: number, now: number) => {
    const aspect = width / Math.max(1, height);
    layout = menuLayout(aspect, menuView(width, height));
    refreshOccluders();
    if (snap) rig.snap(layout.camera);
    else rig.setPreset(layout.camera);
    (scene.fog as FogExp2).density = layout.fogDensity;
    applyViewOffset(width, height);
    // A rotation moves the title block — keep the field out from under it.
    for (const d of drift) {
      const moved = placeOutsideKeepOut(d, layout.keepOut);
      d.uy = moved.uy;
    }
    // Dice: snap to the new layout slot now, re-run the keep-out test
    // once the camera has eased to the new preset.
    for (let i = 0; i < 2; i++) {
      const d = layout.dice[i]!;
      diceRest[i] = { ...d };
      diceMove[i] = { from: { ...d }, tween: { start: now, duration: 0 } };
    }
    // Under reduced motion the camera has just snapped and the loop
    // idles after the next frame, so the test must run in that frame:
    // no wait at all (not even `now + 0` — the first rAF timestamp can
    // trail a `performance.now()` taken while scheduling it by a few
    // ms, which is exactly how the desktop pair stayed on the Tutorial
    // card's corner). In motion the drift cadence keeps the loop alive,
    // but a scroll-quiet idle loop still needs the timer nudge.
    dicePlaced = false;
    dicePlaceAfter = snap ? 0 : now + DICE_PLACE_DELAY_MS;
    if (diceWake !== undefined) clearTimeout(diceWake);
    if (!snap) diceWake = setTimeout(() => loop.requestRender(), DICE_PLACE_DELAY_MS + 40);
    const next = fanSlots(HERO_COUNT, layout.fan);
    const cells = heroCells(layout.fan.rows);
    for (let i = 0; i < HERO_COUNT; i++) {
      const h = hero[i]!;
      const s = next[i]!;
      const p = pool.pose(i);
      p.faceCell = cells[i] ?? 0;
      h.fromPos.copy(p.position);
      h.fromQuat.copy(p.quaternion);
      h.toPos.set(s.x, s.y, s.z);
      slotQuat(s, h.toQuat);
      h.tween = { start: now, duration: snap ? 0 : RELAYOUT_MS };
    }
    heroLive = true;
    loop.requestRender();
  };

  // Initial view offset (SceneHost sizes the renderer right after build).
  applyViewOffset(ctx.size.width, ctx.size.height);

  /**
   * The lobby re-measures its hero band on scroll, on resize, when the
   * web fonts land and when the title reflows. A band that only *moved*
   * (a scroll: same size, so the fit — camera distance — is unchanged)
   * shifts the frustum in place so the rack travels with the title
   * frame-exactly; a band that changed size re-fits the rack the way a
   * resize does (eased camera, dice re-placed).
   */
  let bandSeen = heroBandVersion();
  const applyBand = () => {
    if (heroBandVersion() === bandSeen) return;
    bandSeen = heroBandVersion();
    const width = ctx.size.width;
    const height = ctx.size.height;
    const next = menuLayout(width / Math.max(1, height), menuView(width, height));
    if (next.cls !== layout.cls || Math.abs(next.distance - layout.distance) > 1e-6) {
      applyLayout(width, height, performance.now());
      return;
    }
    layout = next;
    applyViewOffset(width, height);
    refreshOccluders();
    // Re-pose (same world poses) so this frame's drift pass sees the
    // moved rack keep-out and the moved title keep-out.
    heroLive = true;
    loop.requestRender();
  };
  const unsubscribeBand = subscribeHeroBand(applyBand);

  return {
    update(dt, now) {
      let live = false;
      // Pointer smoothing — exponential, frame-rate independent.
      if (parallaxOn) {
        const k = 1 - 2 ** (-dt / 0.16);
        const dx = pointer.x - pointerSmooth.x;
        const dy = pointer.y - pointerSmooth.y;
        if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
          pointerSmooth.x += dx * k;
          pointerSmooth.y += dy * k;
          live = true;
        }
      }
      const pointerHot = now - lastPointerAt < POINTER_HOT_MS;

      // Hero + dice: animate while any tween is running or the
      // parallax offset is still settling.
      if (heroLive || live || firstFrame) {
        heroLive = writeHero(now);
        const diceLive = writeDice(now);
        heroLive = heroLive || diceLive;
        live = live || heroLive;
        if (diceMoved) {
          diceMoved = false;
          live = true;
        }
      }

      // Drift field: full rate during intro / pointer motion, else a
      // throttled cadence so the loop idles between steps. The occluder
      // fade projects through the camera, whose matrices the rig has
      // just moved — refresh them first.
      if (domOccluders.length > 0) rig.camera.updateMatrixWorld();
      if (driftLive || live || pointerHot || firstFrame) {
        driftLive = writeDrift(now, reducedMotion ? 0 : dt);
        driftAccum = 0;
        live = true;
      } else if (!reducedMotion) {
        driftAccum += dt;
        if (driftAccum * 1000 >= DRIFT_STEP_MS) {
          writeDrift(now, driftAccum);
          driftAccum = 0;
          live = true;
        }
      } else if (
        occluderVersion() !== occluderSeen ||
        ((!reseeded || !dicePlaced) && now >= dicePlaceAfter && getOccluders().length > 0)
      ) {
        // Frozen field, but a card moved (scroll / late measurement) or
        // a keep-out pass is still owed (a relayout reset it): one pass
        // so the fade / placement tracks the DOM, then idle again.
        writeDrift(now, 0);
        live = true;
      }

      if (live) {
        pool.markDirty();
        pool.commit();
      }
      if (globalThis.__MAHJONG_MENU_INTRO__ === 'running' && !heroLive && now >= settleAt) {
        globalThis.__MAHJONG_MENU_INTRO__ = 'settled';
      }
      firstFrame = false;
      return live;
    },
    resize(width, height) {
      applyLayout(width, height, performance.now());
    },
    dispose() {
      globalThis.__MAHJONG_MENU_INTRO__ = undefined;
      globalThis.__MAHJONG_MENU_DEBUG__ = undefined;
      if (diceWake !== undefined) clearTimeout(diceWake);
      unsubscribeOccluders();
      unsubscribeBand();
      if (parallaxOn) window.removeEventListener('pointermove', onPointer);
      lights.dispose();
      pool.dispose();
      (dice.material as { dispose(): void }).dispose();
      floorGeo.dispose();
      floorMat.dispose();
      scene.remove(floor, pool.mesh, dice);
      scene.fog = null;
    },
  };
}

/** Test seam: the frame-to-frame contract of `update` in words. */
export const MENU_MOTION = {
  INTRO_DELAY_MS,
  INTRO_STAGGER_MS,
  INTRO_TILE_MS,
  INTRO_DICE_MS,
  DRIFT_STEP_MS,
  /** Intro is fully settled (hero + dice) by this many ms after mount. */
  settleMs: MENU_MOTION_SETTLE_MS,
};
