import {
  Euler,
  Mesh,
  PCFShadowMap,
  PlaneGeometry,
  Quaternion,
  ShadowMaterial,
  Vector3,
} from 'three';
import type { TileBackSkin } from '../../state/game';
import type { SceneContext, SceneHandle } from '../core/SceneHost';
import type { CameraPreset } from '../core/camera';
import { buildLights } from '../core/lights';
import { clamp01, easeOutCubic } from '../core/tween';
import { TilePool } from '../tiles/TilePool';
import { BACK_CELL } from '../tiles/faceAtlas';
import { type FanParams, type Slot, fanSlots, fanWidth, fitDistance } from './layout';

/**
 * The replay library's "empty shelf": seven tiles resting in a shallow
 * arc on an unseen felt (ShadowMaterial — only the contact shadows
 * paint) — dim face-down backs at the ends, 東 南 西 face-up in the
 * middle — rendered with the same TilePool / atlas / lights as the
 * menu hero so the library stays inside the 3D visual language
 * instead of falling back to the classic flat tile art.
 *
 * Still life: a short settle intro (tiles drop into place, ≤ 600 ms;
 * instant under reduced motion) and then the loop idles — the scene
 * re-renders only on resize or a tile-back skin change (rebuild).
 */
export interface ShelfSceneOptions {
  tileBack: TileBackSkin;
}

/** Atlas cells left → right: back, back, 東, 南, 西, back, back. */
export const SHELF_CELLS: readonly number[] = [
  BACK_CELL,
  BACK_CELL,
  27,
  28,
  29,
  BACK_CELL,
  BACK_CELL,
];
/** Body tint per slot — the outer backs recede like the 2D shelf did. */
export const SHELF_TINTS: readonly number[] = [0.6, 0.78, 1, 1, 1, 0.78, 0.6];
export const SHELF_FAN: FanParams = {
  spacing: 1.1,
  lean: 0.5,
  yaw: 0.07,
  zStep: 0.04,
  curve: 0.014,
  rows: 1,
  rowGap: 0,
};
export const SHELF_FOV = 28;
export const SHELF_ELEVATION = 0.52;
/** World units of air either side of the arc. */
export const SHELF_MARGIN = 1.4;
/** World height the frustum must span at the arc (leaning tiles +
 *  their contact shadows) — letterbox canvases fit this instead of the
 *  width, otherwise a 4:1 strip puts the camera so close that only a
 *  band through the tiles is in frame. */
export const SHELF_FRAME_H = 2.7;
const INTRO_DELAY_MS = 80;
const INTRO_STAGGER_MS = 40;
const INTRO_TILE_MS = 520;

/** Camera that frames the arc at `aspect`: as wide as the canvas allows
 *  while keeping `SHELF_FRAME_H` of height in view. */
export function shelfCamera(aspect: number): CameraPreset {
  const width = fanWidth(SHELF_CELLS.length, SHELF_FAN.spacing) + SHELF_MARGIN;
  const a = Math.max(0.5, aspect);
  const distance = Math.max(
    fitDistance(width, SHELF_FOV, a),
    fitDistance(SHELF_FRAME_H * a, SHELF_FOV, a),
  );
  const target: [number, number, number] = [0, 0.42, -0.1];
  return {
    position: [
      0,
      target[1] + distance * Math.sin(SHELF_ELEVATION),
      target[2] + distance * Math.cos(SHELF_ELEVATION),
    ],
    target,
    fov: SHELF_FOV,
  };
}

const _euler = new Euler();

export function buildShelfScene(ctx: SceneContext, opts: ShelfSceneOptions): SceneHandle {
  const { scene, renderer, rig, quality, loop, reducedMotion } = ctx;
  renderer.shadowMap.type = PCFShadowMap;
  rig.snap(shelfCamera(ctx.size.width / Math.max(1, ctx.size.height)));

  const lights = buildLights(scene, renderer, quality, {
    keyColor: 0xffe4bd,
    skyColor: 0xc9d6e6,
    groundColor: 0x1e2a23,
    shadowExtent: 6,
  });
  lights.key.position.set(-3.5, 7, 5);
  lights.key.intensity = 2.3;
  lights.key.shadow.camera.far = 16;
  lights.hemi.intensity = 0.7;
  lights.ambient.intensity = 0.12;
  if (scene.environment) scene.environmentIntensity = 0.45;

  const floorGeo = new PlaneGeometry(40, 40);
  const floorMat = new ShadowMaterial({ color: 0x000000, opacity: 0.55 });
  const floor = new Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.001;
  floor.receiveShadow = true;
  scene.add(floor);

  const pool = new TilePool(opts.tileBack);
  pool.mesh.count = SHELF_CELLS.length;
  scene.add(pool.mesh);

  const slots: Slot[] = fanSlots(SHELF_CELLS.length, SHELF_FAN);
  const start = performance.now();
  const rest = slots.map((s) => new Vector3(s.x, s.y, s.z));
  const quats = slots.map((s) =>
    new Quaternion().setFromEuler(_euler.set(s.rx, s.ry, s.rz, 'XYZ')),
  );
  slots.forEach((_, i) => {
    const p = pool.pose(i);
    p.visible = true;
    p.faceCell = SHELF_CELLS[i] ?? BACK_CELL;
    p.tint.setScalar(SHELF_TINTS[i] ?? 1);
    p.quaternion.copy(quats[i]!);
  });
  const settleAt = start + INTRO_DELAY_MS + (slots.length - 1) * INTRO_STAGGER_MS + INTRO_TILE_MS;

  const write = (now: number): boolean => {
    let live = false;
    for (let i = 0; i < slots.length; i++) {
      const t0 = start + INTRO_DELAY_MS + i * INTRO_STAGGER_MS;
      const e = reducedMotion ? 1 : easeOutCubic(clamp01((now - t0) / INTRO_TILE_MS));
      if (e < 1) live = true;
      const p = pool.pose(i);
      p.position.copy(rest[i]!);
      p.position.y += (1 - e) * 1.1;
      p.scale = 1;
    }
    pool.markDirty();
    pool.commit();
    return live;
  };
  write(start);

  return {
    update(_dt, now) {
      if (reducedMotion || now > settleAt + 50) return false;
      return write(now);
    },
    resize(width, height) {
      rig.snap(shelfCamera(width / Math.max(1, height)));
      loop.requestRender();
    },
    dispose() {
      lights.dispose();
      pool.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      scene.remove(floor, pool.mesh);
    },
  };
}
