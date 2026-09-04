import type { GameState, Seat, Wind } from '@mahjong/game-logic';
import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  type Scene,
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
import { publishRiverInterior } from '../core/sceneRects';
import { getSpotlightTiles, spotlightPulse, spotlightVersion } from '../core/spotlight';
import { TilePool } from '../tiles/TilePool';
import { TILE_D, TILE_H, TILE_W } from '../tiles/geometry';
import { feltColors, setTileBackFinish } from '../tiles/materials';
import { Choreographer, slotPose } from './choreography';
import {
  CENTRE_PLATE_RADIUS,
  FELT_HALF,
  type HeldHandFrame,
  type Layout,
  RAIL_H,
  RAIL_WIDTH,
  type Rel,
  WALL_D,
  computeLayout,
  dealerChipLocal,
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
  /**
   * The table between hands (pre-game lobby): walls built, no dealer
   * yet — the plate shows the wind only, the dealer chip and dice stay
   * hidden, and the layout is applied without a dispense.
   */
  waiting?: boolean | undefined;
  /**
   * Apply the layout without motion (default: `waiting`). The lobby
   * snaps its first layout and lets later seat changes animate.
   */
  snap?: boolean | undefined;
  /** Show the user's own hand backs-out (the waiting table's racks). */
  concealOwn?: boolean | undefined;
  /** Portrait river zoom — see `LayoutOptions.hideSideWallsBeyondZ`. */
  hideSideWallsBeyondZ?: number | undefined;
  /**
   * Albedo multiplier for the near wall's stacks (rel 0). Phone
   * landscape sets 0.85: the hand stands directly in front of the wall
   * there, so the wall steps back a shade and the hand reads in front.
   */
  nearWallDim?: number | undefined;
  /** Side seats' outward shift — see `LayoutOptions.sideSeatOut`. */
  sideSeatOut?: number | undefined;
  /** Right seat's melds at the near end — see `LayoutOptions.sideMeldsNear`. */
  sideMeldsNear?: boolean | undefined;
  /**
   * Draw the dead-wall hairline along the stacks' *inner* (felt-side)
   * edge instead of the outer one. The wide presets look at the table
   * from a low angle: the outer hairline of the far and side walls hides
   * behind their stacks, and the near wall's lands in the seam between
   * the wall's bottom and the hand's top edge, where it reads as an
   * underline for the hand (round-4 #3). Inside the walls it runs at
   * the foot of each visible wall face (the near wall's is hidden by its
   * own stacks — the darker backs mark that one). Portrait (near-
   * overhead) keeps the outer edge, clear of the 1.28× rivers.
   */
  deadMarkerInner?: boolean | undefined;
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

/** `SceneHost` pool shared by the waiting table and the match table. */
export const TABLE_POOL_KEY = 'table';
/**
 * Tile-back finish: a matte inlay (clearcoat almost off, rough) so the
 * blue / plum skin reads as its swatch colour under the bright key and
 * env instead of washing to near-white at the gradient's light end
 * (round-2: opponents' racks looked like white sticks).
 */
export const TABLE_BACK_FINISH = { clearcoat: 0.12, roughness: 0.72 } as const;
/**
 * Dealer chip: a red lacquer disc parked in the dealer's near-left
 * corner pocket — the patch the pinwheel rivers never reach (see
 * `layout.dealerChipLocal`). At the wide presets' river scale it sits at
 * z ≈ 5.6, which keeps its near edge above the near wall's inner top
 * edge from the low phone-landscape camera, so the glyph is never
 * half-occluded.
 */
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
const _settleScale = new Vector3(1, 1, 1);
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
  private plateInfo: { wind: Wind | null; count: number | null } = { wind: null, count: -1 };
  private marker: Mesh;
  private markerRel: Rel | null = null;
  private markerScale = 1;
  private dice: InstancedMesh;
  private diceValues: [number, number] | null = null;
  /** Gold hairline on the felt along the dead-wall stacks (`syncDeadMarker`). */
  private deadMarker: Mesh;
  private deadMarkerKey = '';
  private textures: Texture[] = [];
  private geometries: BufferGeometry[] = [];
  private disposed = false;

  private tileSheet: boolean;
  private latestDiscardId: number | null = null;
  /**
   * The tile that most recently landed in a river, derived from the
   * layout diff. The engine-side `latestDiscardId` only lives for the
   * claim window (gone the instant the next seat draws), so this keeps
   * the gold cue on the newest discard through its flight and for
   * `PULSE_MS` after it lands — the still a player reads the table by.
   */
  private cueDiscardId: number | null = null;
  private drawnTileId: number | null = null;
  private hintTileId: number | null = null;
  private nextDrawId: number | null = null;
  private needsDraw = false;
  private hoverId: number | null = null;
  /** Tutorial spotlight (additive poll of `core/spotlight`): per-tile
   *  mask rebuilt when the published set's version changes. */
  private readonly spotMask = new Uint8Array(136);
  private spotSeq = -1;
  /** Tutorial river clip (additive publish to `core/sceneRects`): the
   *  camera matrix at the last publish, so the eight projections run
   *  only while the camera moves. */
  private readonly interiorCam = new Matrix4();
  private interiorPublished = false;
  private lift = new Float32Array(136);
  private pulseT = 0;
  /** Pulses run for a few seconds after each cue, then hold steady so a still table idles. */
  private pulseUntil = 0;
  /** Last `update()` timestamp — springs use wall-clock time, not the loop's clamped dt. */
  private lastNow = 0;
  private nearWallDim = 1;
  private lastLayout: Layout | null = null;
  /** Stable disposer for `SceneContext.onDestroy` while parked. */
  readonly destroyHook = (): void => this.dispose();

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

    // Dead-wall marker: a gold hairline on the felt along the outer edge
    // of the dead stacks, rebuilt (two quads at most) when the segment
    // changes. Together with the darker back shade it marks the segment
    // without a second tile colour or a positional kink.
    const deadMat = new MeshBasicMaterial({
      color: 0xd8a85a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.deadMarker = new Mesh(new BufferGeometry(), deadMat);
    this.deadMarker.visible = false;
    this.deadMarker.name = 'dead-wall-marker';
    this.deadMarker.renderOrder = 1;
    scene.add(this.deadMarker);

    // Tiles. River glyphs are minified 3–4× and seen at 30–45° on the
    // wide presets, so the atlas takes the strongest anisotropy the GPU
    // offers (mid / high tiers; low keeps the profile's value) — the
    // shader also biases the mip pick a little sharper.
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.pool = new TilePool(opts.tileBack, {
      anisotropy: Math.max(1, Math.min(maxAniso, quality.tier === 'low' ? quality.anisotropy : 16)),
      atlasScale: quality.tier === 'high' ? 1.25 : 1,
    });
    setTileBackFinish(this.pool.material, TABLE_BACK_FINISH);
    scene.add(this.pool.mesh);

    if (this.tileSheet) {
      // Debug sheet: bare felt, no plate under the rows.
      this.plate.visible = false;
      this.plateTopMesh.visible = false;
      const layout = tileSheetLayout();
      this.lastLayout = layout;
      this.choreo.setLayout(layout, null, 0, 0, { snap: true });
      this.writePoses(performance.now());
    }
  }

  /**
   * Return a parked scene to its just-built state for a new host: no
   * layout, no cues, chip / dice hidden, plate blank, skins current.
   * Meshes, materials (compiled programs) and textures are untouched —
   * that is the point of parking (see `acquireTableScene`).
   */
  reset(opts: TableSceneOptions): void {
    this.choreo.reset();
    this.choreo.reducedMotion = opts.reducedMotion;
    this.lastLayout = null;
    this.latestDiscardId = null;
    this.cueDiscardId = null;
    this.drawnTileId = null;
    this.hintTileId = null;
    this.nextDrawId = null;
    this.needsDraw = false;
    this.hoverId = null;
    this.lift.fill(0);
    this.pulseT = 0;
    this.pulseUntil = 0;
    this.lastNow = 0;
    this.nearWallDim = 1;
    this.plateInfo = { wind: null, count: -1 };
    this.marker.visible = false;
    this.markerRel = null;
    this.markerScale = 1;
    this.deadMarker.visible = false;
    this.deadMarkerKey = '';
    this.dice.visible = false;
    this.diceValues = null;
    this.pool.hideAll();
    this.pool.commit();
    this.setSkins(opts.felt, opts.tileBack);
    this.ctx.renderer.shadowMap.autoUpdate = false;
    this.ctx.renderer.shadowMap.needsUpdate = true;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get isTileSheet(): boolean {
    return this.tileSheet;
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
      hideSideWallsBeyondZ: input.hideSideWallsBeyondZ,
      concealOwn: input.concealOwn,
      sideSeatOut: input.sideSeatOut,
      sideMeldsNear: input.sideMeldsNear,
      waitingWalls: input.waiting,
    });
    const prevLayout = this.lastLayout;
    this.lastLayout = layout;
    const waiting = input.waiting === true;
    this.choreo.setLayout(layout, state, me, now, {
      shuffling: input.shuffling,
      snap: input.snap ?? waiting,
    });
    // Newest discard: a tile whose zone just became `discard`. A claimed
    // (or otherwise moved) cue tile drops the cue.
    if (prevLayout) {
      for (let id = 0; id < 136; id++) {
        if (layout[id]?.zone === 'discard' && prevLayout[id]?.zone !== 'discard') {
          this.cueDiscardId = id;
          this.pulseUntil = now + PULSE_MS;
        }
      }
    }
    if (this.cueDiscardId !== null && layout[this.cueDiscardId]?.zone !== 'discard') {
      this.cueDiscardId = null;
    }
    if (input.latestDiscardId !== this.latestDiscardId || input.needsDraw !== this.needsDraw) {
      this.pulseUntil = now + PULSE_MS;
    }
    this.latestDiscardId = input.latestDiscardId;
    this.drawnTileId = input.drawnTileId;
    this.hintTileId = input.hintTileId;
    this.needsDraw = input.needsDraw;
    this.nearWallDim = input.nearWallDim ?? 1;
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

    this.syncDeadMarker(layout, waiting, input.deadMarkerInner === true);

    // Centre plate + marker + dice. No dealer exists before the opening
    // roll, so the waiting table shows neither chip nor dice.
    this.updatePlate(state.prevailingWind, waiting ? null : state.wall.length);
    const rel = relOf(state.dealer, me);
    const riverScale = input.riverScale ?? 1;
    if (waiting) {
      this.marker.visible = false;
      this.markerRel = null;
    } else if (rel !== this.markerRel || riverScale !== this.markerScale) {
      this.markerRel = rel;
      this.markerScale = riverScale;
      // Parked in the dealer's near-left corner pocket, glyph facing
      // the dealer.
      const [lx, lz] = dealerChipLocal(riverScale, CHIP_RADIUS);
      const [mx, mz] = toWorld(rel, lx, lz);
      this.marker.position.set(mx, CHIP_H / 2, mz);
      this.marker.quaternion.setFromAxisAngle(Y_AXIS, (rel * Math.PI) / 2);
      this.marker.visible = true;
    }
    const rolls = waiting ? undefined : state.openingRolls;
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

  /**
   * Rebuild the dead-wall hairline for the current layout: one quad per
   * wall side the dead stacks occupy (the segment wraps a corner at
   * most once), laid on the felt just outside the stacks' outer edge.
   * Hidden on the waiting table (no break yet).
   */
  private syncDeadMarker(layout: Layout, waiting: boolean, inner: boolean): void {
    const byRel = new Map<Rel, { min: number; max: number }>();
    if (!waiting) {
      for (const slot of layout) {
        if (!slot || slot.zone !== 'deadWall') continue;
        // Along-the-wall coordinate in the wall seat's frame.
        const along =
          slot.rel === 0 ? slot.x : slot.rel === 1 ? -slot.z : slot.rel === 2 ? -slot.x : slot.z;
        const e = byRel.get(slot.rel);
        if (!e) byRel.set(slot.rel, { min: along, max: along });
        else {
          e.min = Math.min(e.min, along);
          e.max = Math.max(e.max, along);
        }
      }
    }
    const key = `${inner ? 'i' : 'o'}|${[...byRel.entries()]
      .map(([rel, e]) => `${rel}:${e.min.toFixed(2)}:${e.max.toFixed(2)}`)
      .sort()
      .join('|')}`;
    if (key === this.deadMarkerKey) return;
    this.deadMarkerKey = key;
    if (byRel.size === 0) {
      this.deadMarker.visible = false;
      return;
    }
    const pos: number[] = [];
    const idx: number[] = [];
    const half = TILE_W / 2 + 0.02;
    const w = 0.09;
    // Outer: 0.14 off the stacks' outer edge. Inner: the same clearance
    // off their inner edge, the line running toward the centre.
    const zOut = inner ? WALL_D - TILE_H / 2 - 0.14 - w : WALL_D + TILE_H / 2 + 0.14;
    const y = 0.012;
    for (const [rel, e] of byRel) {
      const corners: [number, number][] = [
        toWorld(rel, e.min - half, zOut),
        toWorld(rel, e.max + half, zOut),
        toWorld(rel, e.max + half, zOut + w),
        toWorld(rel, e.min - half, zOut + w),
      ];
      const base = pos.length / 3;
      for (const [cx, cz] of corners) pos.push(cx, y, cz);
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.deadMarker.geometry.dispose();
    this.deadMarker.geometry = geo;
    this.deadMarker.visible = true;
  }

  private updatePlate(wind: Wind, count: number | null): void {
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
      (this.latestDiscardId !== null ||
        this.cueDiscardId !== null ||
        (this.needsDraw && this.nextDrawId !== null));
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
    // Tutorial spotlight: the active lesson step publishes the tiles it
    // is about (`three/tutorial/Tutorial3D` → `core/spotlight`); they
    // breathe gold while the set is non-empty, and a change of set
    // renders one frame even when it just cleared.
    const spotIds = getSpotlightTiles();
    if (spotlightVersion() !== this.spotSeq || (spotIds.length > 0 && !this.choreo.reducedMotion))
      live = true;
    this.writePoses(now);
    if (live) this.ctx.renderer.shadowMap.needsUpdate = true;
    this.publishInterior();
    return live;
  }

  /**
   * Additive (tutorial): publish the river interior — the felt square
   * inside the four walls' visible edges — in client px through
   * `core/sceneRects`, so the discard-pool coach-mark ring is clipped
   * to it instead of the projected square's bounding box, which widens
   * with perspective onto the near wall row and the side wall columns.
   * Bounds: the side and far walls' felt contact lines (their inner
   * faces at y 0) and the near wall's inner top edge (its top face is
   * what the camera sees), sampled along each wall.
   */
  private publishInterior(): void {
    const cam = this.ctx.rig.camera;
    if (this.interiorPublished && cam.matrixWorld.equals(this.interiorCam)) return;
    this.interiorCam.copy(cam.matrixWorld);
    this.interiorPublished = true;
    const face = WALL_D - TILE_H / 2;
    const stackTop = TILE_D * 2;
    let left = Number.NEGATIVE_INFINITY;
    let right = Number.POSITIVE_INFINITY;
    let top = Number.NEGATIVE_INFINITY;
    let bottom = Number.POSITIVE_INFINITY;
    for (const t of [-9.5, 0, 9.5]) {
      left = Math.max(left, this.projectPoint(-face, 0, t).x);
      right = Math.min(right, this.projectPoint(face, 0, t).x);
      top = Math.max(top, this.projectPoint(t, 0, -face).y);
      bottom = Math.min(bottom, this.projectPoint(t, stackTop, face).y);
    }
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    publishRiverInterior({
      left: r.left + left,
      top: r.top + top,
      right: r.left + right,
      bottom: r.top + bottom,
    });
  }

  private writePoses(now: number): void {
    const pulse = this.pulseT === 0 ? 0.6 : 0.5 + 0.5 * Math.sin(this.pulseT * 4.2);
    const spotIds = getSpotlightTiles();
    const spotSeq = spotlightVersion();
    if (spotSeq !== this.spotSeq) {
      this.spotSeq = spotSeq;
      this.spotMask.fill(0);
      for (const id of spotIds) this.spotMask[id] = 1;
    }
    const spotLevel = spotIds.length > 0 ? spotlightPulse(now, this.choreo.reducedMotion) : 0;
    const cueId = this.latestDiscardId ?? this.cueDiscardId;
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
      } else if (id === cueId) hl = 0.5 + 0.45 * pulse;
      else if (id === this.drawnTileId) hl = 0.22;
      else if (id === this.hintTileId) hl = 0.12;
      if (spotLevel > 0 && this.spotMask[id] === 1) hl = Math.max(hl, spotLevel);
      p.highlight = hl;
      p.tint.setScalar(1);
      const zone = t.slot?.zone;
      // Dead wall reads as a shaded segment of the same set: its backs
      // take the skin's darker shade (`uDeadBack*`, derived from the skin
      // in `materials.deadBackColors`) and a gold hairline runs along
      // the felt beside the stacks (`syncDeadMarker`). No positional
      // step (see `wallSlotPosition`).
      p.backVariant = zone === 'deadWall' ? 1 : 0;
      if ((zone === 'wall' || zone === 'deadWall') && t.slot?.rel === 0 && this.nearWallDim !== 1)
        p.tint.setScalar(this.nearWallDim);
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

  /**
   * Screen rect (CSS px) of a tile at its *settled* pose — the flight
   * destination while it is in the air (or has not started), the current
   * pose once it has landed — projected through the camera's goal
   * preset; null when the tile has no slot. Additive
   * (tutorial): the coach-mark overlay keys the hand-row keep-out off
   * this so the dice card docks the same way before, during and after
   * the deal instead of re-docking when the tiles land.
   */
  settledTileRect(id: number, out?: ScreenRect): ScreenRect | null {
    const t = this.choreo.tiles[id];
    if (!t?.slot) return null;
    const pose = t.target ?? (t.flight ? t.flight.to : t.visible ? t : slotPose(t.slot));
    _settleScale.setScalar(t.slot.scale ?? 1);
    _m.compose(pose.pos, pose.quat, _settleScale);
    // …seen from where the camera is *going*, not where its ease-in has
    // reached: on match start the intro move keeps the hand off-screen
    // for a second or more.
    const cam = this.ctx.rig.goalCamera();
    return projectTileRect(_m, cam, this.ctx.size.width, this.ctx.size.height, out);
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
    publishRiverInterior(null);
    if (this.disposed) return;
    this.disposed = true;
    const { scene } = this.ctx;
    scene.remove(
      this.feltMesh,
      this.railMesh,
      this.plate,
      this.plateTopMesh,
      this.marker,
      this.deadMarker,
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
    this.deadMarker.geometry.dispose();
    (this.deadMarker.material as MeshBasicMaterial).dispose();
    (this.dice.material as MeshPhysicalMaterial).dispose();
    this.dice.dispose();
    this.ctx.renderer.shadowMap.autoUpdate = true;
  }
}

/** Scenes parked in a pooled runtime, keyed by the runtime's three `Scene`. */
const PARKED = new WeakMap<Scene, TableScene>();

/**
 * The table scene for a `SceneContext`: the one parked in it by the
 * previous host (pre-game lobby → match, or back) reset for `opts`, or
 * a fresh build. Pair with `releaseTableScene` in the handle's
 * `dispose()`. Parking keeps the compiled tile / felt / rail programs
 * and the uploaded face atlas alive across the hand-off, so the match
 * table's first frame costs a layout, not a shader compile.
 */
export function acquireTableScene(ctx: SceneContext, opts: TableSceneOptions): TableScene {
  const parked = PARKED.get(ctx.scene);
  if (parked) {
    PARKED.delete(ctx.scene);
    ctx.onDestroy.delete(parked.destroyHook);
    if (!parked.isDisposed && parked.isTileSheet === (opts.tileSheet ?? false)) {
      parked.reset(opts);
      return parked;
    }
    parked.dispose();
  }
  return new TableScene(ctx, opts);
}

/** Park the scene in a pooled runtime, or dispose it in an unpooled one. */
export function releaseTableScene(ctx: SceneContext, scene: TableScene): void {
  if (!ctx.pooled || scene.isDisposed) {
    scene.dispose();
    return;
  }
  PARKED.set(ctx.scene, scene);
  ctx.onDestroy.add(scene.destroyHook);
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
