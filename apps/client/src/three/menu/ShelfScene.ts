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
import { TILE_D, TILE_H, TILE_W } from '../tiles/geometry';
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
 *
 * The camera looks down steeply enough (`SHELF_ELEVATION`) that the
 * faces read square-on with a sliver of the bottom edge for depth; the
 * frame is derived from the leaning tile's projected height
 * (`shelfFrameHeight`) so the tops are never cut by the canvas edge.
 * `__MAHJONG_SHELF_DEBUG__` publishes the projected tile bounds for
 * the verifier / specs.
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
export const SHELF_TINTS: readonly number[] = [0.62, 0.8, 1, 1, 1, 0.8, 0.62];
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
/**
 * Camera elevation above the felt, radians. With the 0.5 rad lean the
 * faces meet the view at sin(0.5 + 0.82) ≈ 0.97 (square-on) while
 * cos(1.32) ≈ 0.25 of the bottom edge still shows, so the tiles read
 * as solid blocks rather than flat cards. (0.52 put the camera nearly
 * tangent to the faces: slivers with the glyphs unreadable.)
 */
export const SHELF_ELEVATION = 0.82;
/** World units of air either side of the arc. */
export const SHELF_MARGIN = 1.0;
/** Vertical margin above and below the tile + shadow group, world units. */
export const SHELF_FRAME_PAD = 0.4;
/** Floor the contact shadow is allowed to spread over, world units. */
export const SHELF_SHADOW_REACH = 0.7;
/** Canvas aspect the `ReplayShelf3D` host sizes to (width / height). */
export const SHELF_CANVAS_ASPECT = 8.6 / 3.2;
const INTRO_DELAY_MS = 80;
const INTRO_STAGGER_MS = 40;
const INTRO_TILE_MS = 520;

declare global {
  /** Projected bounds (CSS px, canvas space) of the shelf tiles once
   *  the pose has been written, for the verifier / specs. */
  // eslint-disable-next-line no-var
  var __MAHJONG_SHELF_DEBUG__:
    | {
        top: number;
        bottom: number;
        left: number;
        right: number;
        width: number;
        height: number;
        settled: boolean;
      }
    | undefined;
}

/** World width the frame must span at the arc. */
export function shelfFrameWidth(): number {
  return fanWidth(SHELF_CELLS.length, SHELF_FAN.spacing) + SHELF_MARGIN;
}

/**
 * World height the frustum must span at the arc: the leaning tile's
 * extent along the camera's up vector (long side × sin(lean + elev.)
 * plus the bottom edge × cos(lean + elev.)), the contact shadow on
 * the floor seen at the elevation, and `SHELF_FRAME_PAD` either side.
 * Letterbox canvases fit this instead of the width, otherwise a wide
 * strip puts the camera so close that a band through the tiles is all
 * that is in frame.
 */
export function shelfFrameHeight(lean = SHELF_FAN.lean, elevation = SHELF_ELEVATION): number {
  const a = lean + elevation;
  const tile = TILE_H * Math.abs(Math.sin(a)) + TILE_D * Math.abs(Math.cos(a));
  const shadow = SHELF_SHADOW_REACH * Math.sin(elevation);
  return tile + shadow + 2 * SHELF_FRAME_PAD;
}

/** Camera that frames the arc at `aspect`: as wide as the canvas allows
 *  while keeping `shelfFrameHeight()` of height in view. */
export function shelfCamera(aspect: number): CameraPreset {
  const a = Math.max(0.5, aspect);
  const distance = Math.max(
    fitDistance(shelfFrameWidth(), SHELF_FOV, a),
    fitDistance(shelfFrameHeight() * a, SHELF_FOV, a),
  );
  // Aim a touch in front of the tile centres so the group (tile +
  // forward-falling contact shadow) sits centred in the frame.
  const target: [number, number, number] = [0, 0.5, -0.05];
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
const _corner = new Vector3();
const CORNERS: readonly [number, number, number][] = [
  [-1, -1, -1],
  [1, -1, -1],
  [-1, 1, -1],
  [1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [-1, 1, 1],
  [1, 1, 1],
];

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
  // Key from high back-left so each tile throws a short contact shadow
  // to its right-front, onto the floor the camera sees.
  lights.key.position.set(-3.2, 7.5, -1.6);
  lights.key.intensity = 2.3;
  lights.key.shadow.camera.far = 16;
  lights.key.shadow.radius = 5;
  lights.hemi.intensity = 0.75;
  lights.ambient.intensity = 0.14;
  if (scene.environment) scene.environmentIntensity = 0.45;

  const floorGeo = new PlaneGeometry(40, 40);
  // Soft enough to read as contact shadow on the void, not a slab.
  const floorMat = new ShadowMaterial({ color: 0x000000, opacity: 0.32 });
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

  /** Projected bounds of every tile corner through the live camera. */
  const publishBounds = (settled: boolean) => {
    const camera = rig.camera;
    camera.updateMatrixWorld();
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < slots.length; i++) {
      const p = pool.pose(i);
      for (const c of CORNERS) {
        _corner
          .set((c[0] * TILE_W) / 2, (c[1] * TILE_H) / 2, (c[2] * TILE_D) / 2)
          .applyQuaternion(p.quaternion)
          .add(p.position)
          .project(camera);
        const sx = ((_corner.x + 1) / 2) * ctx.size.width;
        const sy = ((1 - _corner.y) / 2) * ctx.size.height;
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
      }
    }
    globalThis.__MAHJONG_SHELF_DEBUG__ = {
      top: y0,
      bottom: y1,
      left: x0,
      right: x1,
      width: ctx.size.width,
      height: ctx.size.height,
      settled,
    };
  };

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
  // Keep writing until every tween has landed. (Gating on a wall-clock
  // settle time left the tiles frozen mid-drop when the first frame
  // came late — SwiftShader's warm-up is ~1 s — so they hovered 1.1
  // units above the floor with their tops cut by the canvas edge.)
  let settled = false;

  return {
    update(_dt, now) {
      if (settled) return false;
      const live = write(now);
      if (!live) settled = true;
      publishBounds(settled);
      // This frame wrote poses, so it must render — including the one
      // that lands the last tween (`write` returns false for it): a
      // scene that idles right there leaves the canvas on the previous,
      // mid-drop frame for good (tops cut by the canvas edge, shadow
      // smeared) — which is what a 2 fps software rasteriser shows.
      return true;
    },
    resize(width, height) {
      rig.snap(shelfCamera(width / Math.max(1, height)));
      publishBounds(settled);
      loop.requestRender();
    },
    dispose() {
      globalThis.__MAHJONG_SHELF_DEBUG__ = undefined;
      lights.dispose();
      pool.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      scene.remove(floor, pool.mesh);
    },
  };
}
