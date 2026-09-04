import {
  Color,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  type Texture,
  Vector2,
  Vector3,
} from 'three';
import type { FeltSkin, TileBackSkin } from '../../state/game';
import type { SceneContext, SceneHandle } from '../core/SceneHost';
import { type LightRig, buildLights, buildStudioEnv } from '../core/lights';
import { type SpringState, springStep } from '../core/tween';
import { TilePool } from '../tiles/TilePool';
import { TILE_D } from '../tiles/geometry';
import { feltColors, setTileBackFinish, tileBackColors } from '../tiles/materials';
import {
  AUTO_ORBIT_MS,
  ORBIT_AMPLITUDE,
  ORBIT_SPEED,
  PREVIEW_BACK_FINISH,
  PREVIEW_CAMERA,
  PREVIEW_LIGHTS,
  PREVIEW_TABLE,
  PREVIEW_TILES,
  TINT_HALF_LIFE,
  compensateBackColor,
  verticalFovFor,
} from './previewConfig';
import { buildClothNormal, buildFeltVignette, buildWoodGrain } from './textures';

/**
 * Settings live preview: a felt swatch inside a lacquered wood rail
 * with three tiles (五萬, 發, one face-down) resting on it. On mid /
 * high tiers the stage sways slowly for `AUTO_ORBIT_MS` after mount, a
 * skin change or a drag, then settles and the loop goes render-on-
 * demand idle. On the low tier (and under reduced motion) it never
 * sways — renders happen only on skin change, drag or resize — and
 * reduced motion also makes re-tints instant.
 *
 * Skin changes are uniform writes (`setSkins`) — the scene is never
 * rebuilt for them. Draw calls: felt + rail + tiles (+ two shadow
 * casters) = 5, well under the ≤ 8 settings budget.
 */
export interface PreviewSkins {
  felt: FeltSkin;
  tileBack: TileBackSkin;
}

const _flatUp = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
const _flatDown = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
const _yaw = new Quaternion();
const _up = new Vector3(0, 1, 0);

export class PreviewScene implements SceneHandle {
  private readonly stage = new Group();
  private readonly felt: Mesh;
  private readonly rail: Mesh;
  private readonly feltMat: MeshStandardMaterial;
  private readonly railMat: MeshPhysicalMaterial;
  private readonly pool: TilePool;
  private readonly lights: LightRig;
  private ownEnv: Texture | null = null;
  private readonly textures: Texture[] = [];

  private readonly feltTarget = new Color();
  private readonly backTopTarget = new Color();
  private readonly backBottomTarget = new Color();

  private sway: SpringState = { value: 0, velocity: 0 };
  private drag: SpringState = { value: 0, velocity: 0 };
  private phase = 0;
  private activeUntil = 0;
  private dragging = false;
  private dragX = 0;
  private readonly reducedMotion: boolean;
  /** Auto-sway is a motion extra: off under reduced motion and on the
   *  low tier (battery / software GL), where the preview renders on
   *  demand only. Drag-to-turn still works everywhere. */
  private readonly swayEnabled: boolean;
  private readonly detachPointer: () => void;

  constructor(
    private readonly ctx: SceneContext,
    skins: PreviewSkins,
  ) {
    const { scene, renderer, quality, canvas } = ctx;
    this.reducedMotion = ctx.reducedMotion;
    this.swayEnabled = !ctx.reducedMotion && quality.parallax;

    // Lights — pull the key in close so the 512² low-tier shadow map
    // still resolves crisp tile contact shadows on the small stage.
    this.lights = buildLights(scene, renderer, quality, { shadowExtent: 4.6 });
    // Key from the back-left so the tiles throw their contact shadows
    // toward the camera instead of hiding them behind themselves.
    this.lights.key.position.set(-2.6, 6.2, -2.2);
    this.lights.key.intensity = PREVIEW_LIGHTS.keyIntensity;
    this.lights.hemi.intensity = PREVIEW_LIGHTS.hemiIntensity;
    if (!this.lights.env) {
      // The preview is three tiles; reflections are what sell the
      // clearcoat, so build the studio env even on the low tier.
      this.ownEnv = buildStudioEnv(renderer);
      scene.environment = this.ownEnv;
    }
    scene.environmentIntensity = PREVIEW_LIGHTS.envIntensity;

    // Felt slab (its square corners hide under the rail's inner edge).
    const fc = feltColors(skins.felt);
    const cloth = buildClothNormal();
    cloth.repeat.set(6, 4.2);
    const vignette = buildFeltVignette();
    this.textures.push(cloth, vignette);
    this.feltMat = new MeshStandardMaterial({
      color: fc.top,
      roughness: 0.96,
      metalness: 0,
      map: vignette,
      normalMap: cloth,
      normalScale: new Vector2(0.4, 0.4),
    });
    this.feltTarget.copy(fc.top);
    this.felt = new Mesh(new PlaneGeometry(PREVIEW_TABLE.feltW, PREVIEW_TABLE.feltD), this.feltMat);
    this.felt.rotation.x = -Math.PI / 2;
    this.felt.receiveShadow = true;
    this.stage.add(this.felt);

    // Wood rail — rounded ring, extruded with a bevelled chamfer.
    const wood = buildWoodGrain();
    wood.repeat.set(0.22, 0.9);
    this.textures.push(wood);
    this.railMat = new MeshPhysicalMaterial({
      color: 0xffffff,
      map: wood,
      roughness: 0.45,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.28,
    });
    this.rail = new Mesh(buildRailGeometry(), this.railMat);
    this.rail.rotation.x = -Math.PI / 2;
    this.rail.position.y = 0.005;
    this.rail.castShadow = true;
    this.rail.receiveShadow = true;
    this.stage.add(this.rail);

    // Tiles.
    this.pool = new TilePool(skins.tileBack);
    // Matte back so the skin colour reads true instead of washing out
    // under the clearcoat's env reflection.
    setTileBackFinish(this.pool.material, PREVIEW_BACK_FINISH);
    this.setBackTargets(skins.tileBack);
    this.snapTints();
    for (const t of PREVIEW_TILES) {
      const p = this.pool.pose(t.id);
      p.visible = true;
      p.faceCell = t.cell;
      p.position.set(t.x, TILE_D / 2, t.z);
      _yaw.setFromAxisAngle(_up, t.yaw);
      p.quaternion.copy(_yaw).multiply(t.faceUp ? _flatUp : _flatDown);
    }
    this.pool.markDirty();
    this.pool.commit();
    // Only the three placed instances are drawn — the other 133 would
    // still cost vertex work as zero-scale degenerates.
    this.pool.mesh.count = PREVIEW_TILES.length;
    this.stage.add(this.pool.mesh);

    scene.add(this.stage);

    // Drag to turn the stage; release springs it back to the sway.
    const onDown = (e: PointerEvent) => {
      this.dragging = true;
      this.dragX = e.clientX;
      canvas.setPointerCapture?.(e.pointerId);
      this.wake();
    };
    const onMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragX;
      this.dragX = e.clientX;
      this.drag.value += dx * 0.008;
      this.ctx.loop.requestRender();
    };
    const onUp = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.wake();
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    this.detachPointer = () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };

    this.wake();
  }

  /** Restart the auto-sway window (mount, skin change, interaction). */
  wake(): void {
    this.activeUntil = performance.now() + AUTO_ORBIT_MS;
    this.ctx.loop.requestRender();
  }

  /** Re-tint felt + tile backs. Uniform writes only — no rebuild. */
  setSkins(skins: PreviewSkins): void {
    this.feltTarget.copy(feltColors(skins.felt).top);
    this.setBackTargets(skins.tileBack);
    if (this.reducedMotion) this.snapTints();
    this.wake();
  }

  private setBackTargets(skin: TileBackSkin): void {
    const back = tileBackColors(skin);
    this.backTopTarget.setRGB(...compensateBackColor([back.top.r, back.top.g, back.top.b]));
    this.backBottomTarget.setRGB(
      ...compensateBackColor([back.bottom.r, back.bottom.g, back.bottom.b]),
    );
  }

  private snapTints(): void {
    this.feltMat.color.copy(this.feltTarget);
    const u = this.pool.material.tileUniforms;
    u.uBackColor.value.copy(this.backTopTarget);
    u.uBackColor2.value.copy(this.backBottomTarget);
  }

  update = (dt: number, now: number): boolean => {
    let live = false;

    // Tint tween toward the target skin colours.
    const u = this.pool.material.tileUniforms;
    const k = this.reducedMotion ? 1 : 1 - 2 ** (-dt / TINT_HALF_LIFE);
    live = lerpColor(this.feltMat.color, this.feltTarget, k) || live;
    live = lerpColor(u.uBackColor.value, this.backTopTarget, k) || live;
    live = lerpColor(u.uBackColor2.value, this.backBottomTarget, k) || live;

    // Sway while in the active window (never under reduced motion).
    let swayGoal = 0;
    if (this.swayEnabled && now < this.activeUntil) {
      this.phase += dt * ORBIT_SPEED;
      swayGoal = Math.sin(this.phase) * ORBIT_AMPLITUDE;
      live = true;
    }
    live = springStep(this.sway, swayGoal, dt, 0.35) || live;
    if (this.dragging) {
      live = true;
    } else {
      live = springStep(this.drag, 0, dt, 0.5) || live;
    }
    this.stage.rotation.y = this.sway.value + this.drag.value;
    return live;
  };

  private sizedOnce = false;

  /** Keep the horizontal fov constant so the rail fits at any panel width. */
  resize = (width: number, height: number): void => {
    const preset = { ...PREVIEW_CAMERA, fov: verticalFovFor(width / Math.max(1, height)) };
    if (this.sizedOnce) this.ctx.rig.setPreset(preset);
    else this.ctx.rig.snap(preset);
    this.sizedOnce = true;
    this.ctx.loop.requestRender();
  };

  dispose(): void {
    this.detachPointer();
    this.ctx.scene.remove(this.stage);
    this.pool.dispose();
    this.felt.geometry.dispose();
    this.rail.geometry.dispose();
    this.feltMat.dispose();
    this.railMat.dispose();
    for (const t of this.textures) t.dispose();
    if (this.ownEnv) {
      this.ctx.scene.environment = null;
      this.ownEnv.dispose();
    }
    this.lights.dispose();
  }
}

/** Lerp `c` toward `target`; returns true while still converging. */
function lerpColor(c: Color, target: Color, k: number): boolean {
  const dr = target.r - c.r;
  const dg = target.g - c.g;
  const db = target.b - c.b;
  if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) < 0.002) {
    if (c.r !== target.r || c.g !== target.g || c.b !== target.b) c.copy(target);
    return false;
  }
  c.setRGB(c.r + dr * k, c.g + dg * k, c.b + db * k);
  return true;
}

function roundedRectPath(w: number, h: number, r: number): Path {
  const p = new Path();
  const x = -w / 2;
  const y = -h / 2;
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

function buildRailGeometry(): ExtrudeGeometry {
  const T = PREVIEW_TABLE;
  const outer = roundedRectPath(T.railOuterW, T.railOuterD, T.railOuterR);
  const shape = new Shape(outer.getPoints(12));
  const hole = roundedRectPath(T.railInnerW, T.railInnerD, T.railInnerR);
  shape.holes.push(new Path(hole.getPoints(10)));
  const geo = new ExtrudeGeometry(shape, {
    depth: T.railH,
    bevelEnabled: true,
    bevelThickness: T.railBevel,
    bevelSize: T.railBevel,
    bevelSegments: 3,
    curveSegments: 12,
  });
  geo.computeVertexNormals();
  return geo;
}
