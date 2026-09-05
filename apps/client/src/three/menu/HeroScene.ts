import {
  Euler,
  FogExp2,
  Mesh,
  Object3D,
  PCFShadowMap,
  PlaneGeometry,
  Quaternion,
  ShadowMaterial,
  Vector3,
} from 'three';
import type { TileBackSkin } from '../../state/game';
import {
  OCCLUDER_BAND_PX,
  type OccluderRect,
  getOccluders,
  occluderFactor,
  occluderVersion,
} from '../../ui/menu/menuOccluders';
import type { SceneContext, SceneHandle } from '../core/SceneHost';
import { buildLights } from '../core/lights';
import { clamp01, easeOutCubic, lerp } from '../core/tween';
import { TilePool } from '../tiles/TilePool';
import { TILE_D, TILE_H, TILE_W } from '../tiles/geometry';
import { createDice } from './dice';
import {
  DIE_R,
  HERO_COUNT,
  type MenuLayout,
  type MenuView,
  type ScreenRect,
  type Slot,
  diceCandidateOffsets,
  fanSlots,
  heroCells,
  menuLayout,
  seededRandom,
} from './layout';
import { setHeroDebugProvider } from './menuDebug';

/**
 * Menu hero: the fanned winning hand + two dice resting on an unseen
 * felt plane (ShadowMaterial — only the soft key-light shadows paint),
 * rendered into the canvas the lobby mounts *inside its hero band*
 * (`HeroBandSlot`). The band is ScrollView content, so the compositor
 * moves the rack with the title it belongs to — no scroll listener,
 * no camera re-aim, nothing to lag a frame behind (round-3 feedback:
 * the rack jittering against the title on Android Chrome while the
 * fixed backdrop chased scroll events). The drift field behind the
 * page is the other canvas (`DriftScene`).
 *
 * Framing: the layout maths (`menuLayout`) fit the rack into a band
 * inside a *viewport-sized frame* — the class (portrait / landscape /
 * wide), the fov and the camera distance all follow from the viewport,
 * which is what keeps the rack's perspective the same as when one
 * canvas drew everything. The canvas is only the band, so the camera
 * renders the band's sub-rectangle of that frame (`setViewOffset` with
 * the full frame = viewport, the sub-frame = canvas). Because the fit
 * is translation-invariant, the band is laid out at the frame's origin
 * and the canvas's position on the page never enters the maths: only
 * a resize (viewport or band) re-fits.
 *
 * Motion budget (ARCHITECTURE.md §2): an intro settle of ~1.5 s, then
 * the loop idles (pointer parallax on wide viewports wakes it).
 * Reduced motion: no intro, no parallax → one frame, then idle.
 */
export interface HeroSceneOptions {
  tileBack: TileBackSkin;
}

const INTRO_DELAY_MS = 120;
const INTRO_STAGGER_MS = 45;
const INTRO_TILE_MS = 720;
const INTRO_DICE_MS = 820;
const RELAYOUT_MS = 420;
const FOG_COLOR = 0x0f1914;
/** DOM rects keep moving for a while after the scene mounts (the cards'
 *  entrance slide, the 800 ms settle re-measure): re-run the dice
 *  keep-out on every rect change inside this window after build. */
const OCCLUDER_SETTLE_MS = 3000;
/** Dice re-placement after a re-fit waits for the camera ease (0 under
 *  reduced motion, where the camera snaps and the loop idles). */
const DICE_PLACE_DELAY_MS = 450;
/** Intro is fully settled (hero + dice) by this many ms after mount. */
const MENU_MOTION_SETTLE_MS = Math.max(
  INTRO_DELAY_MS + (HERO_COUNT - 1) * INTRO_STAGGER_MS + INTRO_TILE_MS,
  520 + 160 + INTRO_DICE_MS,
);

declare global {
  /** `'running'` from scene build until the intro tweens finish, then
   *  `'settled'`; `undefined` when no hero scene is mounted. */
  // eslint-disable-next-line no-var
  var __MAHJONG_MENU_INTRO__: 'running' | 'settled' | undefined;
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

/** The frame the hero is laid out in — the viewport, CSS px. */
export function heroFrame(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return {
    width: Math.max(1, window.innerWidth || 1),
    height: Math.max(1, window.innerHeight || 1),
  };
}

/**
 * The view `menuLayout` fits the hero canvas to: a viewport-sized frame
 * with the band (the canvas) laid out at its origin. The canvas's page
 * position is irrelevant — the fit is translation-invariant (see the
 * layout test) and the sub-frame render (`setViewOffset`) shows the
 * band's own rectangle whatever the page scrolled to.
 */
export function heroView(
  frame: { width: number; height: number },
  bandW: number,
  bandH: number,
): MenuView {
  return { width: frame.width, height: frame.height, band: { x: 0, y: 0, w: bandW, h: bandH } };
}

/** Hero scenes built on this page — the debug seam's remount detector. */
let heroBuilds = 0;

export function buildHeroScene(ctx: SceneContext, opts: HeroSceneOptions): SceneHandle {
  const { scene, renderer, rig, quality, loop, reducedMotion } = ctx;
  const snap = reducedMotion;
  heroBuilds++;
  // three ≥ 0.18x retired PCFSoftShadowMap (SceneHost's default) and
  // logs a deprecation warning on the first shadow pass; pick the
  // supported filter up front so the console stays clean.
  renderer.shadowMap.type = PCFShadowMap;

  let frame = heroFrame();
  const fit = (bandW: number, bandH: number): MenuLayout =>
    menuLayout(frame.width / frame.height, heroView(frame, bandW, bandH));
  let layout = fit(ctx.size.width, ctx.size.height);
  /** False while the band is degenerate (mid-layout): nothing draws. */
  let fitted = layout.band !== null;
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
  pool.mesh.count = HERO_COUNT;
  scene.add(pool.mesh);

  const introStart = performance.now();
  // Verifier hook: the shot recipes wait for the intro to settle
  // instead of sleeping a fixed time (`scripts/shot-states.mjs`).
  globalThis.__MAHJONG_MENU_INTRO__ = 'running';
  const settleAt = introStart + (snap ? 0 : MENU_MOTION_SETTLE_MS) + 50;
  const hero: HeroTile[] = [];
  {
    // Seeded scatter for the drop-in — the same every visit.
    const rnd = seededRandom(31);
    const slots = fanSlots(HERO_COUNT, layout.fan);
    for (let i = 0; i < HERO_COUNT; i++) {
      const slot = slots[i]!;
      const toPos = new Vector3(slot.x, slot.y, slot.z);
      const toQuat = slotQuat(slot, new Quaternion());
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
      p.visible = fitted;
      p.faceCell = heroCells(layout.fan.rows)[i] ?? 0;
      p.tint.setScalar(1);
    }
  }

  // ── DOM occluders (cards, footer, title) → dice keep-out ───────────
  // Lobby surfaces register their *window* rects (`useMenuOccluder`);
  // the dice pair is nudged off any glass edge / copy they straddle.
  // The canvas is a sub-rectangle of the page, so rects are brought
  // into canvas space with the canvas's own client rect — read when a
  // placement runs, never per frame.
  let domOccluders: OccluderRect[] = getOccluders();
  let occluderSeen = occluderVersion();

  const canvasRect = (): ScreenRect => {
    const r = ctx.canvas.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const toCanvas = (rects: readonly OccluderRect[]): OccluderRect[] => {
    const c = canvasRect();
    return rects.map((r) => ({ ...r, x: r.x - c.x, y: r.y - c.y }));
  };

  /** Exact canvas position (CSS px) + projected radius of a disc of
   *  `worldRadius` at a world point through the live camera. The pixel
   *  scale is the *frame's* (the camera's vertical fov spans the
   *  viewport height, of which the canvas shows a slice). */
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
    const pxPerUnit = frame.height / (2 * depth * Math.tan((camera.fov * Math.PI) / 360));
    out.r = worldRadius * pxPerUnit;
  };

  /**
   * The rack's projected silhouette (every hero tile's eight corners
   * at its resting pose, plus the dice pair's discs), canvas CSS px
   * through the live camera.
   */
  const rackRect = (): ScreenRect => {
    rig.camera.updateMatrixWorld();
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
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
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
  let dicePlaceRuns = 0;
  let dicePlaceRects = 0;
  let diceMoved = false;

  /** Keep-out factor for a die resting at `slot` against every DOM rect
   *  (glass edges + solid copy) in canvas space; zero when its disc
   *  leaves the canvas (the band is the rack's whole world). */
  const diceFactor = (slot: Slot, rects: readonly OccluderRect[]): number => {
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
    return occluderFactor(proj.x, proj.y, proj.r, rects, OCCLUDER_BAND_PX, 1);
  };

  /**
   * Run the dice pair through the keep-out test: if either die
   * straddles a glass edge (or sits on copy) in its layout slot, nudge
   * the pair along `diceCandidateOffsets` until both clear every rect,
   * else keep the best offset found. Once per layout (not on scroll —
   * the band and the cards scroll together, so their relation never
   * changes). After the intro the move eases.
   */
  const placeDice = (now: number) => {
    if (dicePlaced || domOccluders.length === 0 || now < dicePlaceAfter) return;
    dicePlaced = true;
    dicePlaceRuns++;
    dicePlaceRects = domOccluders.length;
    rig.camera.updateMatrixWorld();
    const rects = toCanvas(domOccluders);
    let best = { dx: 0, dz: 0 };
    let bestF = Number.NEGATIVE_INFINITY;
    let bestFs = [1, 1];
    for (const o of diceCandidateOffsets(layout.cls)) {
      const fs = layout.dice.map((d) => diceFactor({ ...d, x: d.x + o.dx, z: d.z + o.dz }, rects));
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
    diceMoved = true;
  };

  // ── Pointer parallax ───────────────────────────────────────────────
  const parallaxOn = quality.parallax && !reducedMotion;
  const pointer = { x: 0, y: 0 };
  const pointerSmooth = { x: 0, y: 0 };
  const onPointer = (e: PointerEvent) => {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    pointer.x = (e.clientX / w) * 2 - 1;
    pointer.y = -((e.clientY / h) * 2 - 1);
    rig.setPointer(pointer.x, pointer.y);
  };
  if (parallaxOn) window.addEventListener('pointermove', onPointer, { passive: true });

  // ── Per-frame pose writers ─────────────────────────────────────────
  let heroLive = true;
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
      p.visible = fitted;
      p.position.lerpVectors(h.fromPos, h.toPos, e);
      p.position.x += px;
      p.position.y += py;
      p.quaternion.slerpQuaternions(h.fromQuat, h.toQuat, e);
      p.scale = 1;
    }
    return live;
  };

  const debugDiceRects = [
    { x: 0, y: 0, r: 0 },
    { x: 0, y: 0, r: 0 },
  ];
  const writeDice = (now: number): boolean => {
    let live = false;
    rig.camera.updateMatrixWorld();
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
      _obj.scale.setScalar(fitted ? 1 : 0.001);
      _obj.updateMatrix();
      dice.setMatrixAt(i, _obj.matrix);
      projectPoint(_obj.position, DIE_R, debugDiceRects[i]!);
    }
    dice.instanceMatrix.needsUpdate = true;
    return live;
  };

  /**
   * Render the band's sub-rectangle of the viewport-sized frame: the
   * camera's aspect is the frame's, and `setViewOffset` picks the
   * canvas-sized window whose top-left is where the fit put the band
   * (the frame's origin) after shifting the projection centre to
   * `layout.viewCenter`. Re-applied only from `applyLayout`.
   */
  let viewOffsetApplies = 0;
  const applyViewOffset = () => {
    const vc = layout.viewCenter;
    const cam = rig.camera;
    cam.aspect = frame.width / frame.height;
    cam.setViewOffset(
      frame.width,
      frame.height,
      Math.round((0.5 - vc.x) * frame.width),
      Math.round((0.5 - vc.y) * frame.height),
      ctx.size.width,
      ctx.size.height,
    );
    cam.updateProjectionMatrix();
    viewOffsetApplies++;
  };

  const sameFit = (a: MenuLayout, b: MenuLayout): boolean =>
    a.cls === b.cls &&
    Math.abs(a.distance - b.distance) < 1e-6 &&
    Math.abs(a.viewCenter.x - b.viewCenter.x) < 1e-6 &&
    Math.abs(a.viewCenter.y - b.viewCenter.y) < 1e-6 &&
    (a.band === null) === (b.band === null);

  /**
   * Re-fit to the canvas (band) size and the frame: eased camera, dice
   * back to their slots then re-placed once the camera has eased, the
   * tiles tweened onto their new slots. A call that changes nothing
   * (SceneHost's first `applySize` right after build, a window resize
   * that left both the viewport and the band alone) only re-applies
   * the view offset — SceneHost has just reset the rig's aspect to the
   * canvas's — and leaves the intro tweens running.
   */
  const applyLayout = (width: number, height: number, now: number) => {
    const next = fit(width, height);
    const same = sameFit(next, layout);
    layout = next;
    fitted = layout.band !== null;
    applyViewOffset();
    if (same) {
      loop.requestRender();
      return;
    }
    if (snap) rig.snap(layout.camera);
    else rig.setPreset(layout.camera);
    (scene.fog as FogExp2).density = layout.fogDensity;
    // Dice: snap to the new layout slot now, re-run the keep-out test
    // once the camera has eased to the new preset.
    for (let i = 0; i < 2; i++) {
      const d = layout.dice[i]!;
      diceRest[i] = { ...d };
      diceMove[i] = { from: { ...d }, tween: { start: now, duration: 0 } };
    }
    // Under reduced motion the camera has just snapped and the loop
    // idles after the next frame, so the test must run in that frame:
    // no wait at all. In motion, wait for the ease (the loop ticks on
    // regardless of rendering, so no wake timer is needed).
    dicePlaced = false;
    dicePlaceAfter = snap ? 0 : now + DICE_PLACE_DELAY_MS;
    const slots = fanSlots(HERO_COUNT, layout.fan);
    const cells = heroCells(layout.fan.rows);
    for (let i = 0; i < HERO_COUNT; i++) {
      const h = hero[i]!;
      const s = slots[i]!;
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
  applyViewOffset();

  // The band is the canvas, so a band resize reaches us through
  // SceneHost's ResizeObserver (`resize`). A viewport change that left
  // the band's size alone (a landscape / desktop band is `flex: 1`)
  // still changes the frame — the class, the fov, the pixel scale —
  // so watch the window too. Resize only; scroll never gets here.
  const onWindowResize = () => {
    const next = heroFrame();
    if (next.width === frame.width && next.height === frame.height) return;
    frame = next;
    applyLayout(ctx.size.width, ctx.size.height, performance.now());
  };
  window.addEventListener('resize', onWindowResize);

  setHeroDebugProvider({
    canvasRect,
    rack: rackRect,
    rackGoal: () => (layout.footprint ? { ...layout.footprint.all } : null),
    diceRects: () => debugDiceRects.map((r) => ({ ...r })),
    dice: () => [...debugDice],
    dicePlaceRuns: () => dicePlaceRuns,
    dicePlaceRects: () => dicePlaceRects,
    viewOffsetApplies: () => viewOffsetApplies,
    heroBuilds: () => heroBuilds,
  });

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

      // The lobby's rects settle over the first seconds (entrance
      // slide, the 800 ms re-measure): a placement made against a card
      // still sliding in leaves a die on its final corner, so redo the
      // dice while rects are still changing. Later changes (a scroll)
      // don't matter — the band scrolls with the cards.
      if (occluderVersion() !== occluderSeen) {
        occluderSeen = occluderVersion();
        domOccluders = getOccluders();
        if (now - introStart < OCCLUDER_SETTLE_MS) dicePlaced = false;
      }
      if (!dicePlaced) placeDice(now);

      // Hero + dice: animate while any tween is running or the
      // parallax offset is still settling. A frame that wrote poses
      // must render — including the one that lands the last tween on
      // its target (`writeHero` returns false for it): otherwise the
      // canvas keeps the previous, mid-tween frame for good once the
      // loop idles (on a 2 fps software rasteriser that was the rack
      // floating half-way through its drop-in, "settled").
      let wrote = false;
      if (heroLive || live || firstFrame || diceMoved) {
        const tilesLive = writeHero(now);
        const diceLive = writeDice(now);
        heroLive = tilesLive || diceLive;
        diceMoved = false;
        wrote = true;
        pool.markDirty();
        pool.commit();
      }
      if (globalThis.__MAHJONG_MENU_INTRO__ === 'running' && !heroLive && now >= settleAt) {
        globalThis.__MAHJONG_MENU_INTRO__ = 'settled';
      }
      firstFrame = false;
      return live || wrote;
    },
    resize(width, height) {
      frame = heroFrame();
      applyLayout(width, height, performance.now());
    },
    dispose() {
      globalThis.__MAHJONG_MENU_INTRO__ = undefined;
      setHeroDebugProvider(null);
      window.removeEventListener('resize', onWindowResize);
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
  /** Intro is fully settled (hero + dice) by this many ms after mount. */
  settleMs: MENU_MOTION_SETTLE_MS,
};
