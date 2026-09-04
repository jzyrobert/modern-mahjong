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
import { TILE_H } from '../tiles/geometry';
import { DIE_SIZE, createDice } from './dice';
import {
  DRIFT_COUNT,
  type DriftTile,
  HERO_COUNT,
  MENU_TILE_COUNT,
  type MenuLayout,
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
 * (`occluderFactor`'s `glassInterior`). Wide viewports keep them as
 * faint depth cues (40 % size); on phones the card column is the whole
 * width and the form is the highest-attention area, so the field stays
 * out of the cards entirely and lives in the hero band.
 */
function glassInterior(cls: MenuLayout['cls']): number {
  return cls === 'wide' ? 0.4 : 0;
}
/** Fraction of a drift tile's disc allowed past the frame edge. */
const FRAME_SLACK = 0.5;
/** Minimum centre distance between re-seeded tiles, in summed radii. */
const SPREAD = 1.6;
/** Fade / keep-out disc radii in world units. */
const TILE_R = TILE_H * 0.72;
const DIE_R = DIE_SIZE * 0.87;
/** Dice re-placement after a resize waits for the camera ease. */
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
        reseeded: boolean;
        visible: number;
        fades: number[];
        tiles: { x: number; y: number; r: number; fade: number }[];
        dice: number[];
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
}

const _obj = new Object3D();
const _euler = new Euler();
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

  let layout: MenuLayout = menuLayout(ctx.size.width / Math.max(1, ctx.size.height));
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
  let occluders: OccluderRect[] = getOccluders();
  let occluderSeen = occluderVersion();
  let reseeded = false;
  const unsubscribeOccluders = subscribeOccluders(() => loop.requestRender());

  /** Root-owned chrome the DOM never registers: the FULLSCREEN /
   *  DISMISS chip in the top-right corner of landscape phones. */
  const chromeOccluders = (): OccluderRect[] =>
    layout.cls === 'landscape-phone'
      ? [{ x: ctx.size.width - 236, y: 0, w: 236, h: 104, kind: 'solid' }]
      : [];
  const refreshOccluders = () => {
    occluderSeen = occluderVersion();
    occluders = [...getOccluders(), ...chromeOccluders()];
  };
  refreshOccluders();

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
    if (reseeded || occluders.length === 0) return;
    reseeded = true;
    const rnd = seededRandom(97);
    const proj = { x: 0, y: 0, r: 0 };
    // The rack's own screen footprint: a seed whose centre is behind
    // the hero tiles is hidden by them, so the seeding avoids it —
    // a tile peeking out from behind the rack's edge is real depth
    // and stays allowed.
    let rx0 = Number.POSITIVE_INFINITY;
    let ry0 = Number.POSITIVE_INFINITY;
    let rx1 = Number.NEGATIVE_INFINITY;
    let ry1 = Number.NEGATIVE_INFINITY;
    for (const h of hero) {
      projectPoint(h.toPos, TILE_R, proj);
      rx0 = Math.min(rx0, proj.x - proj.r);
      ry0 = Math.min(ry0, proj.y - proj.r);
      rx1 = Math.max(rx1, proj.x + proj.r);
      ry1 = Math.max(ry1, proj.y + proj.r);
    }
    const rack: OccluderRect = { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0, kind: 'solid' };
    const solid: OccluderRect[] = occluders.map((r) => ({ ...r, kind: 'solid' as const }));
    const W = ctx.size.width;
    const H = ctx.size.height;
    const taken: { x: number; y: number; r: number }[] = [];
    const blocked = (x: number, y: number, r: number) =>
      x + r * FRAME_SLACK < 0 ||
      x - r * FRAME_SLACK > W ||
      y + r * FRAME_SLACK < 0 ||
      y - r * FRAME_SLACK > H ||
      rectSignedDistance(x, y, rack) < -r * 0.5 ||
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
    const cands = driftCandidates();
    const interior = glassInterior(layout.cls);
    let openLeft =
      layout.cls === 'wide' ? Math.ceil(layout.driftVisible * 0.6) : layout.driftVisible;
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
  const debugDice: number[] = [1, 1];

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
    return occluderFactor(proj.x, proj.y, proj.r, occluders, OCCLUDER_BAND_PX, 1);
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
    if (dicePlaced || occluders.length === 0 || now < dicePlaceAfter) return;
    dicePlaced = true;
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
    heroLive = true;
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
  const debugTiles: { x: number; y: number; r: number; fade: number }[] = [];
  const writeDrift = (now: number, dt: number): boolean => {
    let live = false;
    if (!reseeded || !dicePlaced || occluderVersion() !== occluderSeen) {
      refreshOccluders();
      // Projection needs the camera's matrices for this frame.
      rig.camera.updateMatrixWorld();
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
      p.visible = j < layout.driftVisible;
      driftWorldPos(d, d.ux, d.uy, pointerSmooth.x * par, pointerSmooth.y * par * 0.5, p.position);
      p.quaternion.setFromEuler(_euler.set(d.ax, d.ay, d.rz, 'XYZ'));
      // Shrink to nothing while straddling a glass edge / crossing copy,
      // and to a faint depth cue while fully behind a glass card.
      let fade = 1;
      if (occluders.length > 0) {
        projectPoint(p.position, TILE_R, _proj);
        fade = occluderFactor(
          _proj.x,
          _proj.y,
          _proj.r,
          occluders,
          OCCLUDER_BAND_PX,
          glassInterior(layout.cls),
        );
      } else {
        projectPoint(p.position, TILE_R, _proj);
      }
      p.scale = 0.001 + 0.999 * e * fade;
      debugFades[j] = fade;
      debugTiles[j] = { x: _proj.x, y: _proj.y, r: _proj.r * fade, fade };
    }
    globalThis.__MAHJONG_MENU_DEBUG__ = {
      occluders: occluders.length,
      reseeded,
      visible: layout.driftVisible,
      fades: debugFades.slice(0, layout.driftVisible),
      tiles: debugTiles.slice(0, layout.driftVisible),
      dice: [...debugDice],
    };
    return live;
  };

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
    layout = menuLayout(aspect);
    refreshOccluders();
    rig.setPreset(layout.camera);
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
    dicePlaced = false;
    dicePlaceAfter = now + DICE_PLACE_DELAY_MS;
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
      }

      // Drift field: full rate during intro / pointer motion, else a
      // throttled cadence so the loop idles between steps. The occluder
      // fade projects through the camera, whose matrices the rig has
      // just moved — refresh them first.
      if (occluders.length > 0) rig.camera.updateMatrixWorld();
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
      } else if (occluderVersion() !== occluderSeen) {
        // Frozen field, but a card moved (scroll / late measurement):
        // one pass so the fade tracks the DOM, then idle again.
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
      unsubscribeOccluders();
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
