import type { GameState, Seat, Wind } from '@mahjong/game-logic';
import {
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  type Texture,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FeltSkin, TileBackSkin } from '../../state/game';
import type { SortMode } from '../../ui/match/SortPicker';
import type { SceneContext } from '../core/SceneHost';
import { type LightRig, buildLights } from '../core/lights';
import type { QualityProfile } from '../core/quality';
import { TilePool } from '../tiles/TilePool';
import { feltColors } from '../tiles/materials';
import { Choreographer } from './choreography';
import {
  CENTRE_PLATE_RADIUS,
  FELT_HALF,
  type HeldHandFrame,
  type Layout,
  RAIL_WIDTH,
  type Rel,
  computeLayout,
  relOf,
  tileSheetLayout,
  toWorld,
} from './layout';
import { type ScreenRect, projectTileRect } from './picking';
import {
  buildDealerMarkerTexture,
  buildDiceTexture,
  buildFeltNormalMap,
  buildFeltShadeMap,
  buildPlateTexture,
  buildWoodMap,
  drawPlate,
} from './textures';

/**
 * The in-game scene graph: felt, wood rail, centre plate (+ dealer
 * marker, dice), the `TilePool`, lights. `sync()` projects a
 * `GameState` into a `Layout` and hands it to the `Choreographer`;
 * `update()` runs every frame from the loop and writes poses into the
 * pool. Nothing here touches React.
 *
 * Draw calls: felt 1, rail 1, plate 2 (side + top), marker 1, dice 1,
 * tiles 1 (+ shadow pass casters). ≈ 10 per frame.
 */
export interface SyncInput {
  state: GameState;
  me: Seat;
  sortMode: SortMode;
  manualOrder: readonly number[];
  drawnTileId: number | null;
  latestDiscardId: number | null;
  hintTileId: number | null;
  needsDraw: boolean;
  shuffling: boolean;
  /** Phone portrait: the near-camera frame the user's hand is held in. */
  heldHand?: HeldHandFrame | null | undefined;
  /** River tile scale (portrait draws discards 1.1×). */
  riverScale?: number | undefined;
}

export interface TableDebugTile {
  id: number;
  zone: string | null;
  x: number;
  y: number;
  z: number;
  scale: number;
  flight: { kind: string; startsIn: number; ms: number } | null;
}

export interface TableDebugSnapshot {
  now: number;
  tiles: TableDebugTile[];
  flights: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface TableSceneOptions {
  felt: FeltSkin;
  tileBack: TileBackSkin;
  reducedMotion: boolean;
  /** Debug: show every face standing in rows instead of the table. */
  tileSheet?: boolean | undefined;
}

const RAIL_H = 0.55;
/**
 * Dealer chip centre in the dealer's seat frame (x right, z toward
 * them): the near-right corner pocket inside the walls. Every river
 * grows within |x| ≤ 3.2 of its owner's axis and toward its owner, so
 * the pocket x, z ∈ [3.2, 8.1] in the dealer's frame is the one patch
 * no river ever reaches. 5.2 (not deeper into the corner) keeps the
 * chip's near edge above the near wall's inner top edge from the low
 * phone-landscape camera, so the glyph is never half-occluded.
 */
export const MARKER_LOCAL: [number, number] = [5.2, 5.2];
export const CHIP_RADIUS = 0.62;
export const CHIP_H = 0.22;
/**
 * Dice offsets in *world* space on the plate's far rim (the camera
 * always looks from +z, so the far rim is behind the wind glyph from
 * every preset) — clear of the glyph and the wall count.
 */
const DICE_WORLD: [number, number][] = [
  [-0.55, -1.3],
  [0.32, -1.36],
];
const DICE_SCALE = 0.8;
/** How long the gold cue pulses before settling to a steady glow. */
const PULSE_MS = 3200;
const _m = new Matrix4();
const _obj = new Object3D();
const _q = new Quaternion();
const _lift = new Vector3();
const Y_AXIS = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** Quaternions that bring die face `value` to +Y (opposite faces sum to 7). */
const DIE_UP: Record<number, Quaternion> = {
  2: new Quaternion(),
  5: new Quaternion().setFromAxisAngle(X_AXIS, Math.PI),
  1: new Quaternion().setFromAxisAngle(Z_AXIS, Math.PI / 2),
  6: new Quaternion().setFromAxisAngle(Z_AXIS, -Math.PI / 2),
  3: new Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 2),
  4: new Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2),
};

export class TableScene {
  readonly pool: TilePool;
  readonly choreo: Choreographer;
  private readonly ctx: SceneContext;
  private lights: LightRig;
  private feltMesh: Mesh;
  private feltMat: MeshStandardMaterial;
  private railMesh: Mesh;
  private plate: Mesh;
  private plateTopMesh: Mesh;
  private plateTex: { texture: Texture; ctx: CanvasRenderingContext2D; size: number };
  private plateInfo: { wind: Wind | null; count: number } = { wind: null, count: -1 };
  private marker: Mesh;
  private markerRel: Rel | null = null;
  private dice: InstancedMesh;
  private diceValues: [number, number] | null = null;
  private textures: Texture[] = [];
  private geometries: BufferGeometry[] = [];
  private disposed = false;

  private tileSheet: boolean;
  private latestDiscardId: number | null = null;
  private drawnTileId: number | null = null;
  private hintTileId: number | null = null;
  private nextDrawId: number | null = null;
  private needsDraw = false;
  private hoverId: number | null = null;
  private lift = new Float32Array(136);
  private pulseT = 0;
  /** Pulses run for a few seconds after each cue, then hold steady so a still table idles. */
  private pulseUntil = 0;
  /** Last `update()` timestamp — springs use wall-clock time, not the loop's clamped dt. */
  private lastNow = 0;
  private lastLayout: Layout | null = null;

  constructor(ctx: SceneContext, opts: TableSceneOptions) {
    this.ctx = ctx;
    this.tileSheet = opts.tileSheet ?? false;
    const { scene, renderer, quality } = ctx;
    this.choreo = new Choreographer({ reducedMotion: opts.reducedMotion });

    // Lights — one shadow-casting key, refreshed only when tiles move.
    this.lights = buildLights(scene, renderer, quality, { shadowExtent: 14.5 });
    this.lights.key.position.set(7, 18, 9);
    this.lights.key.intensity = 2.4;
    this.lights.hemi.intensity = 0.75;
    this.lights.hemi.color.set(0xcfd9e8);
    this.lights.hemi.groundColor.set(0x2f3a30);
    if (this.lights.key.castShadow) {
      this.lights.key.shadow.camera.near = 4;
      this.lights.key.shadow.camera.far = 50;
      this.lights.key.shadow.bias = -0.0008;
      this.lights.key.shadow.normalBias = 0.03;
      this.lights.key.shadow.camera.updateProjectionMatrix();
    }
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    // Felt.
    const fc = feltColors(opts.felt);
    const feltNormal = buildFeltNormalMap(256, quality.tier === 'low' ? 0.7 : 1);
    const feltShade = buildFeltShadeMap();
    this.textures.push(feltNormal, feltShade);
    this.feltMat = new MeshStandardMaterial({
      color: fc.top,
      roughness: 0.96,
      metalness: 0,
      map: feltShade,
      normalMap: feltNormal,
    });
    this.feltMat.normalScale.set(0.45, 0.45);
    const feltGeo = new PlaneGeometry((FELT_HALF + 0.3) * 2, (FELT_HALF + 0.3) * 2);
    this.geometries.push(feltGeo);
    this.feltMesh = new Mesh(feltGeo, this.feltMat);
    this.feltMesh.rotation.x = -Math.PI / 2;
    this.feltMesh.receiveShadow = true;
    this.feltMesh.name = 'felt';
    scene.add(this.feltMesh);

    // Rail — four chamfered wood slabs merged into one geometry.
    const wood = buildWoodMap();
    wood.repeat.set(0.16, 1);
    this.textures.push(wood);
    const railMat = new MeshPhysicalMaterial({
      map: wood,
      roughness: 0.45,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.35,
    });
    const len = (FELT_HALF + RAIL_WIDTH) * 2;
    const mid = FELT_HALF + RAIL_WIDTH / 2;
    const parts: BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const g = new RoundedBoxGeometry(len, RAIL_H, RAIL_WIDTH, 2, 0.12);
      const rot = new Matrix4().makeRotationY((i * Math.PI) / 2);
      const [tx, tz] = toWorld(i as Rel, 0, mid);
      g.applyMatrix4(rot);
      g.applyMatrix4(new Matrix4().makeTranslation(tx, RAIL_H / 2 - 0.02, tz));
      parts.push(g);
    }
    const railGeo = mergeGeometries(parts, false) ?? parts[0]!;
    for (const p of parts) p.dispose();
    this.geometries.push(railGeo);
    this.railMesh = new Mesh(railGeo, railMat);
    this.railMesh.castShadow = false;
    this.railMesh.receiveShadow = true;
    this.railMesh.name = 'rail';
    scene.add(this.railMesh);

    // Centre plate — lacquer disc + a flat canvas-textured top. The top
    // is a CircleGeometry lying in the XZ plane (not the cylinder's cap,
    // whose UVs run u↔z / v↔x and rotate the glyph) so the canvas reads
    // upright from the user's seat.
    this.plateTex = buildPlateTexture(512);
    this.textures.push(this.plateTex.texture);
    const plateGeo = new CylinderGeometry(
      CENTRE_PLATE_RADIUS,
      CENTRE_PLATE_RADIUS * 0.97,
      0.14,
      48,
    );
    this.geometries.push(plateGeo);
    const lacquer = new MeshPhysicalMaterial({
      color: 0x1a1613,
      roughness: 0.35,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
    });
    this.plate = new Mesh(plateGeo, lacquer);
    this.plate.position.y = 0.07;
    this.plate.castShadow = true;
    this.plate.receiveShadow = true;
    this.plate.name = 'plate';
    scene.add(this.plate);
    const topGeo = new CircleGeometry(CENTRE_PLATE_RADIUS * 0.985, 48);
    this.geometries.push(topGeo);
    const plateTop = new MeshPhysicalMaterial({
      map: this.plateTex.texture,
      roughness: 0.3,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
    });
    this.plateTopMesh = new Mesh(topGeo, plateTop);
    this.plateTopMesh.rotation.x = -Math.PI / 2;
    this.plateTopMesh.position.y = 0.14 + 0.002;
    this.plateTopMesh.receiveShadow = true;
    this.plateTopMesh.name = 'plate-top';
    scene.add(this.plateTopMesh);

    // Dealer chip — a thick red-lacquer disc with a white 莊 on top.
    // One merged geometry (open cylinder side + flat top disc) under a
    // single textured material, so it stays one draw call; the side's
    // UVs collapse onto the texture's plain lacquer corner.
    const markerTex = buildDealerMarkerTexture();
    this.textures.push(markerTex);
    const markerGeo = buildChipGeometry(CHIP_RADIUS, CHIP_H);
    this.geometries.push(markerGeo);
    const markerMat = new MeshPhysicalMaterial({
      map: markerTex,
      roughness: 0.32,
      clearcoat: 0.75,
      clearcoatRoughness: 0.18,
    });
    this.marker = new Mesh(markerGeo, markerMat);
    this.marker.castShadow = true;
    this.marker.receiveShadow = true;
    this.marker.name = 'dealer-marker';
    this.marker.visible = false;
    scene.add(this.marker);

    // Dice — one InstancedMesh with two instances.
    const diceTex = buildDiceTexture();
    this.textures.push(diceTex);
    const dieGeo = new BoxGeometry(0.52, 0.52, 0.52);
    remapDieUv(dieGeo);
    this.geometries.push(dieGeo);
    const dieMat = new MeshPhysicalMaterial({
      map: diceTex,
      roughness: 0.25,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
    });
    this.dice = new InstancedMesh(dieGeo, dieMat, 2);
    this.dice.castShadow = true;
    this.dice.receiveShadow = true;
    this.dice.visible = false;
    this.dice.name = 'dice';
    scene.add(this.dice);

    // Tiles. River glyphs are minified 3–4× and seen at 30–45° on the
    // wide presets, so the atlas takes the strongest anisotropy the GPU
    // offers (mid / high tiers; low keeps the profile's value) — the
    // shader also biases the mip pick a little sharper.
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.pool = new TilePool(opts.tileBack, {
      anisotropy: Math.max(1, Math.min(maxAniso, quality.tier === 'low' ? quality.anisotropy : 16)),
      atlasScale: quality.tier === 'high' ? 1.25 : 1,
    });
    scene.add(this.pool.mesh);

    if (this.tileSheet) {
      // Debug sheet: bare felt, no plate under the rows.
      this.plate.visible = false;
      this.plateTopMesh.visible = false;
      const layout = tileSheetLayout();
      this.lastLayout = layout;
      this.choreo.setLayout(layout, null, 0, 0, { snap: true });
      this.writePoses();
    }
  }

  setQuality(q: QualityProfile): void {
    this.lights.dispose();
    this.lights = buildLights(this.ctx.scene, this.ctx.renderer, q, { shadowExtent: 14.5 });
    this.lights.key.position.set(7, 18, 9);
    this.ctx.renderer.shadowMap.needsUpdate = true;
  }

  /** Live skin change — re-tint, no rebuild. */
  setSkins(felt: FeltSkin, tileBack: TileBackSkin): void {
    this.feltMat.color.copy(feltColors(felt).top);
    this.pool.setBackSkin(tileBack);
    this.ctx.loop.requestRender();
  }

  setHover(id: number | null): void {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.ctx.loop.requestRender();
  }

  /** Project a `GameState` into the scene. Call on every store change. */
  sync(input: SyncInput, now: number): void {
    if (this.tileSheet) return;
    const { state, me } = input;
    const layout = computeLayout(state, me, {
      sortMode: input.sortMode,
      manualOrder: input.manualOrder,
      drawnTileId: input.drawnTileId,
      reveal: state.phase === 'resolved',
      heldHand: input.heldHand ?? null,
      riverScale: input.riverScale ?? 1,
    });
    this.lastLayout = layout;
    this.choreo.setLayout(layout, state, me, now, { shuffling: input.shuffling });
    if (input.latestDiscardId !== this.latestDiscardId || input.needsDraw !== this.needsDraw) {
      this.pulseUntil = now + PULSE_MS;
    }
    this.latestDiscardId = input.latestDiscardId;
    this.drawnTileId = input.drawnTileId;
    this.hintTileId = input.hintTileId;
    this.needsDraw = input.needsDraw;
    const next = state.wall[state.wall.length - 1];
    this.nextDrawId = next
      ? (layout.findIndex((s) => s?.zone === 'wall' && s.index === 0) ?? null)
      : null;
    if (this.nextDrawId === -1) this.nextDrawId = null;

    // Face cells: concealed opponents show the back on the printed side.
    for (let id = 0; id < 136; id++) {
      const slot = layout[id];
      if (!slot) continue;
      if (slot.back && slot.zone !== 'wall' && slot.zone !== 'deadWall') this.pool.showBack(id);
      else this.pool.showFace(id);
    }

    // Centre plate + marker + dice.
    this.updatePlate(state.prevailingWind, state.wall.length);
    const rel = relOf(state.dealer, me);
    if (rel !== this.markerRel) {
      this.markerRel = rel;
      // Parked in the dealer's near-right corner pocket, glyph facing
      // the dealer.
      const [mx, mz] = toWorld(rel, MARKER_LOCAL[0], MARKER_LOCAL[1]);
      this.marker.position.set(mx, CHIP_H / 2, mz);
      this.marker.quaternion.setFromAxisAngle(Y_AXIS, (rel * Math.PI) / 2);
      this.marker.visible = true;
    }
    const rolls = state.openingRolls;
    const pair = rolls
      ? (rolls.dice[state.dealer] ?? Object.values(rolls.dice).find((d) => d !== undefined))
      : undefined;
    if (
      pair &&
      (this.diceValues === null || pair[0] !== this.diceValues[0] || pair[1] !== this.diceValues[1])
    ) {
      this.diceValues = [pair[0], pair[1]];
      this.placeDice(pair[0], pair[1]);
    } else if (!pair && this.dice.visible) {
      this.dice.visible = false;
      this.diceValues = null;
    }
    this.ctx.renderer.shadowMap.needsUpdate = true;
    this.ctx.loop.requestRender();
  }

  private updatePlate(wind: Wind, count: number): void {
    if (this.plateInfo.wind === wind && this.plateInfo.count === count) return;
    this.plateInfo = { wind, count };
    drawPlate(this.plateTex.ctx, this.plateTex.size, { prevailingWind: wind, wallCount: count });
    this.plateTex.texture.needsUpdate = true;
  }

  private placeDice(a: number, b: number): void {
    // Two small dice resting on the plate's far rim.
    [a, b].forEach((value, i) => {
      const [x, z] = DICE_WORLD[i]!;
      _obj.position.set(x, 0.14 + 0.26 * DICE_SCALE, z);
      const up = DIE_UP[value] ?? DIE_UP[2]!;
      _q.setFromAxisAngle(Y_AXIS, i === 0 ? 0.35 : -0.6);
      _obj.quaternion.copy(_q).multiply(up);
      _obj.scale.setScalar(DICE_SCALE);
      _obj.updateMatrix();
      this.dice.setMatrixAt(i, _obj.matrix);
    });
    this.dice.instanceMatrix.needsUpdate = true;
    this.dice.visible = true;
  }

  /** Per-frame: advance motion, write poses. Returns true while animating. */
  update(_dt: number, now: number): boolean {
    // The loop clamps dt to 0.1 s so a returning tab doesn't teleport;
    // our springs are exponential smoothers (stable for any step), so
    // use the real elapsed time — at a software rasteriser's 2–3 fps a
    // slide still completes in wall-clock time instead of 4× slower.
    const dt = this.lastNow === 0 ? _dt : Math.min(0.5, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    let live = this.choreo.update(dt, now);
    const pulsing =
      !this.choreo.reducedMotion &&
      now < this.pulseUntil &&
      (this.latestDiscardId !== null || (this.needsDraw && this.nextDrawId !== null));
    if (pulsing) {
      this.pulseT += dt;
      live = true;
    } else if (this.pulseT !== 0) {
      // Settle on the pulse's mid-point so the glow doesn't jump.
      this.pulseT = 0;
      live = true;
    }
    // Hover lift eases in/out.
    for (let id = 0; id < 136; id++) {
      const target = id === this.hoverId ? 0.14 : 0;
      const cur = this.lift[id]!;
      if (Math.abs(cur - target) > 0.001) {
        this.lift[id] = cur + (target - cur) * Math.min(1, dt * 14);
        live = true;
      } else if (cur !== target) {
        this.lift[id] = target;
      }
    }
    this.writePoses();
    if (live) this.ctx.renderer.shadowMap.needsUpdate = true;
    return live;
  }

  private writePoses(): void {
    const pulse = this.pulseT === 0 ? 0.6 : 0.5 + 0.5 * Math.sin(this.pulseT * 4.2);
    const tiles = this.choreo.tiles;
    for (let id = 0; id < 136; id++) {
      const t = tiles[id]!;
      const p = this.pool.pose(id);
      p.visible = t.visible && t.scale > 0.001;
      if (!p.visible) continue;
      p.position.copy(t.pos);
      p.position.y += t.bounceY;
      // Hover lift only applies while the tile is in the user's hand: a
      // tapped tile keeps its hover id through the discard on touch
      // (no pointerleave fires when the button unmounts), and must not
      // float once it lands in the river.
      const lift = t.slot?.zone === 'hand' ? this.lift[id]! : 0;
      if (lift !== 0) {
        // Lift along the tile's own up axis so a held (camera-facing)
        // tile rises on screen the same way a table-standing one does.
        _lift.set(0, 1, 0).applyQuaternion(t.quat).multiplyScalar(lift);
        p.position.add(_lift);
      }
      p.quaternion.copy(t.quat);
      p.scale = t.scale * (t.slot?.scale ?? 1);
      let hl = 0;
      if (this.needsDraw && id === this.nextDrawId) {
        // Primary cue: strong gold pulse plus a small lift off the stack.
        hl = 0.7 + 0.3 * pulse;
        p.position.y += 0.06 + 0.06 * pulse;
      } else if (id === this.latestDiscardId) hl = 0.4 + 0.45 * pulse;
      else if (id === this.drawnTileId) hl = 0.22;
      else if (id === this.hintTileId) hl = 0.12;
      p.highlight = hl;
      p.tint.setScalar(1);
      // Dead wall reads as a separate block: a clearly darker, slightly
      // warmer back (no positional step — see `wallSlotPosition`).
      if (t.slot?.zone === 'deadWall') p.tint.setRGB(0.56, 0.5, 0.46);
    }
    this.pool.markDirty();
    this.pool.commit();
  }

  /** Screen rect (CSS px) of a tile instance, or null when hidden. */
  tileRect(id: number, out?: ScreenRect): ScreenRect | null {
    const t = this.choreo.tiles[id];
    if (!t || !t.visible) return null;
    this.pool.mesh.updateMatrixWorld();
    const m = this.pool.matrixAt(id, _m);
    return projectTileRect(m, this.ctx.rig.camera, this.ctx.size.width, this.ctx.size.height, out);
  }

  /** Project an arbitrary world point to CSS px. */
  projectPoint(x: number, y: number, z: number): { x: number; y: number } {
    const v = new Vector3(x, y, z).project(this.ctx.rig.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.ctx.size.width,
      y: (-v.y * 0.5 + 0.5) * this.ctx.size.height,
    };
  }

  get nextDrawTileId(): number | null {
    return this.nextDrawId;
  }

  /** Test / debug introspection — every visible tile's pose + motion. */
  debugSnapshot(now: number): TableDebugSnapshot {
    const tiles: TableDebugTile[] = [];
    this.choreo.tiles.forEach((t, id) => {
      if (!t.visible) return;
      tiles.push({
        id,
        zone: t.slot?.zone ?? null,
        x: round2(t.pos.x),
        y: round2(t.pos.y),
        z: round2(t.pos.z),
        scale: round2(t.scale),
        flight: t.flight
          ? {
              kind: t.flight.kind,
              startsIn: Math.round(t.flight.start - now),
              ms: t.flight.duration,
            }
          : null,
      });
    });
    return { now, tiles, flights: tiles.filter((t) => t.flight !== null).length };
  }

  get layout(): Layout | null {
    return this.lastLayout;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const { scene } = this.ctx;
    scene.remove(
      this.feltMesh,
      this.railMesh,
      this.plate,
      this.plateTopMesh,
      this.marker,
      this.dice,
      this.pool.mesh,
    );
    this.lights.dispose();
    this.pool.dispose();
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
    this.feltMat.dispose();
    (this.railMesh.material as MeshPhysicalMaterial).dispose();
    (this.plate.material as MeshPhysicalMaterial).dispose();
    (this.plateTopMesh.material as MeshPhysicalMaterial).dispose();
    (this.marker.material as MeshPhysicalMaterial).dispose();
    (this.dice.material as MeshPhysicalMaterial).dispose();
    this.dice.dispose();
    this.ctx.renderer.shadowMap.autoUpdate = true;
  }
}

/**
 * Dealer chip: an open cylinder side plus a flat top disc, merged. The
 * top disc lies in XZ (like the centre plate's top) so the canvas
 * reads upright once the chip is yawed toward the dealer; the side's
 * UVs collapse onto the texture's top-left corner, which the texture
 * paints in plain lacquer.
 */
function buildChipGeometry(radius: number, height: number): BufferGeometry {
  const side = new CylinderGeometry(radius, radius * 0.96, height, 40, 1, true);
  const sideUv = side.getAttribute('uv');
  for (let i = 0; i < sideUv.count; i++) sideUv.setXY(i, 0.03, 0.97);
  const top = new CircleGeometry(radius, 40);
  top.rotateX(-Math.PI / 2);
  top.translate(0, height / 2, 0);
  const merged = mergeGeometries([side, top], false) ?? side;
  side.dispose();
  top.dispose();
  return merged;
}

/** Map each BoxGeometry face of a die onto its 1..6 cell in the strip. */
function remapDieUv(geo: BufferGeometry): void {
  const uv = geo.getAttribute('uv');
  const arr = new Float32Array(uv.array as Float32Array);
  // +x=1, −x=6, +y=2, −y=5, +z=3, −z=4
  const faceValue = [1, 6, 2, 5, 3, 4];
  for (let f = 0; f < 6; f++) {
    const cell = faceValue[f]! - 1;
    for (let v = 0; v < 4; v++) {
      const i = (f * 4 + v) * 2;
      arr[i] = (cell + arr[i]!) / 6;
    }
  }
  geo.setAttribute('uv', new Float32BufferAttribute(arr, 2));
}
