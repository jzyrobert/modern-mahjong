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
import type { TileBackSkin } from '../../state/game';
import type { SceneContext, SceneHandle } from '../core/SceneHost';
import { buildLights } from '../core/lights';
import { clamp01, easeOutCubic, lerp } from '../core/tween';
import { TilePool } from '../tiles/TilePool';
import { BACK_CELL } from '../tiles/faceAtlas';
import { createDice } from './dice';
import {
  DRIFT_COUNT,
  type DriftTile,
  HERO_COUNT,
  HERO_ELEVATION,
  HERO_HAND_CELLS,
  MENU_TILE_COUNT,
  type MenuLayout,
  type Slot,
  driftField,
  fanSlots,
  frameWidthAt,
  menuLayout,
  seededRandom,
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
    p.faceCell = HERO_HAND_CELLS[i] ?? 0;
    p.tint.setScalar(1);
  }

  const drift: DriftState[] = driftField(DRIFT_COUNT).map((d) => ({
    ...d,
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
    const shade = lerp(1, 0.7, d.depth);
    p.tint.setScalar(shade);
  });

  // ── Dice ───────────────────────────────────────────────────────────
  const dice = createDice(2);
  scene.add(dice);
  const diceTween: Tween[] = [0, 1].map((i) => ({
    start: introStart + 520 + i * 160,
    duration: snap ? 0 : INTRO_DICE_MS,
  }));

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

  const writeDrift = (now: number, dt: number): boolean => {
    let live = false;
    const cam = layout.camera;
    const cosE = Math.cos(HERO_ELEVATION);
    for (let j = 0; j < drift.length; j++) {
      const d = drift[j]!;
      if (dt > 0) {
        d.ux = wrapUnit(d.ux + d.vx * dt);
        d.uy = wrapUnit(d.uy + d.vy * dt);
        d.ax += d.wx * dt;
        d.ay += d.wy * dt;
      }
      const depth = layout.drift.near + d.depth * (layout.drift.far - layout.drift.near);
      const halfW = (frameWidthAt(layout.distance + depth, cam.fov, layout.aspect) / 2) * 1.08;
      const halfH = halfW / layout.aspect / cosE;
      const par = parallaxOn ? 0.35 + d.depth * 1.1 : 0;
      const e = tweenProgress(d.scaleTween, now);
      if (e < 1) live = true;
      const p = pool.pose(HERO_COUNT + j);
      // Map the normalised field onto the (off-centre) frustum so the
      // tiles cover the whole viewport, not just the region around
      // the hero.
      const vc = layout.viewCenter;
      p.position.set(
        (d.ux + 1 - 2 * vc.x) * halfW + pointerSmooth.x * par,
        cam.target[1] + (2 * vc.y - 1 - d.uy) * halfH + pointerSmooth.y * par * 0.5,
        -depth,
      );
      p.quaternion.setFromEuler(_euler.set(d.ax, d.ay, d.rz, 'XYZ'));
      p.scale = 0.001 + 0.999 * e;
    }
    return live;
  };

  const writeDice = (now: number): boolean => {
    let live = false;
    for (let i = 0; i < 2; i++) {
      const s = layout.dice[i]!;
      const e = tweenProgress(diceTween[i]!, now);
      if (e < 1) live = true;
      _obj.position.set(
        s.x + pointerSmooth.x * 0.22,
        s.y + (1 - e) * 2.6 + pointerSmooth.y * 0.1,
        s.z,
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
    rig.setPreset(layout.camera);
    (scene.fog as FogExp2).density = layout.fogDensity;
    applyViewOffset(width, height);
    const next = fanSlots(HERO_COUNT, layout.fan);
    for (let i = 0; i < HERO_COUNT; i++) {
      const h = hero[i]!;
      const s = next[i]!;
      const p = pool.pose(i);
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
      // throttled cadence so the loop idles between steps.
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
      }

      if (live) {
        pool.markDirty();
        pool.commit();
      }
      firstFrame = false;
      return live;
    },
    resize(width, height) {
      applyLayout(width, height, performance.now());
    },
    dispose() {
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
  settleMs: Math.max(
    INTRO_DELAY_MS + (HERO_COUNT - 1) * INTRO_STAGGER_MS + INTRO_TILE_MS,
    520 + 160 + INTRO_DICE_MS,
  ),
};
