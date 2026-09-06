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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FeltSkin, TileBackSkin } from '../../state/game';
import type { SortMode } from '../../ui/match/SortPicker';
import type { SceneContext } from '../core/SceneHost';
import { type LightRig, buildLights } from '../core/lights';
import type { QualityProfile } from '../core/quality';
import { publishRiverInterior } from '../core/sceneRects';
import { getSpotlightTiles, spotlightPulse, spotlightVersion } from '../core/spotlight';
import { TilePool, type TilePose } from '../tiles/TilePool';
import { TILE_D, TILE_H, TILE_RADIUS, TILE_W } from '../tiles/geometry';
import { feltColors, setTileBackFinish, setTileBackGradient } from '../tiles/materials';
import { Choreographer, type TileMotionState, slotPose } from './choreography';
import { DRAG_LIFT, DRAG_TILT } from './dragReorder';
import {
  CENTRE_PLATE_RADIUS,
  FELT_HALF,
  type HeldHandFrame,
  type Layout,
  RAIL_H,
  RAIL_WIDTH,
  type Rel,
  computeLayout,
  dealerChipLocal,
  relOf,
  tileSheetLayout,
  toWorld,
  wallInnerFaceAt,
} from './layout';
import { type ScreenRect, projectPlaneRect, projectTileFaceRect, projectTileRect } from './picking';
import { buildRailGeometry } from './rail';
import {
  buildCueBandTexture,
  buildCueHaloTexture,
  buildDealerMarkerTexture,
  buildDiceTexture,
  buildFeltNormalMap,
  buildFeltShadeMap,
  buildHintFrameTexture,
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
 * cue halo 1, discard-hint frame 1, tiles 1 (+ shadow pass casters).
 * ≈ 12 per frame.
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
  /** The user has drawn and must discard (lights the hand row). */
  canDiscard?: boolean | undefined;
  shuffling: boolean;
  /** Phone portrait: the near-camera frame the user's hand is held in. */
  heldHand?: HeldHandFrame | null | undefined;
  /** River tile scale (portrait draws discards 1.36×). */
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
  /** Portrait river zoom: no walls — see `LayoutOptions.hideWalls`. */
  hideWalls?: boolean | undefined;
  /**
   * Albedo multiplier for the near wall's stacks (rel 0). Phone
   * landscape sets 0.85: the hand stands directly in front of the wall
   * there, so the wall steps back a shade and the hand reads in front.
   */
  nearWallDim?: number | undefined;
  /** Side seats' outward shift — see `LayoutOptions.sideSeatOut`. */
  sideSeatOut?: number | undefined;
  /** Far seat's outward shift — see `LayoutOptions.farSeatOut`. */
  farSeatOut?: number | undefined;
  /** Right seat's melds at the near end — see `LayoutOptions.sideMeldsNear`. */
  sideMeldsNear?: boolean | undefined;
  /** Side seats' meld scale — see `LayoutOptions.sideMeldScale`. */
  sideMeldScale?: number | undefined;
  /** Far seat's melds stood on the rail — see `LayoutOptions.farMeldsOnRail`. */
  farMeldsOnRail?: boolean | undefined;
  /** Landscape river zoom: drop the side seats' rows — see `LayoutOptions.hideSideSeats`. */
  hideSideSeats?: boolean | undefined;
  /** The user's melds stand in the hand row — see `LayoutOptions.ownMeldsStanding`. */
  ownMeldsStanding?: boolean | undefined;
  /**
   * Lay every seat's concealed hand face-up, as the resolved hand does
   * — the replay's "all seats" point of view (`src/three/replay`).
   */
  revealAll?: boolean | undefined;
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

/** The discard hint as rendered: the hinted tile's projected face and
 *  the frame's projected stroke (null while the frame is faded out). */
export interface TableDebugHint {
  tileId: number;
  faceRect: ScreenRect | null;
  markerRect: ScreenRect | null;
}

export interface TableDebugSnapshot {
  now: number;
  tiles: TableDebugTile[];
  flights: number;
  hint: TableDebugHint | null;
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
 * Back gradient range on the table (`materials.setTileBackGradient`):
 * 0.55 keeps a wall stack's light end a readable blue instead of washing
 * to near-white against the ivory bevel under the key + env, so the live
 * and dead-wall segments read as one set at two shades (round-4 #5).
 * Note the "step" the critic saw at the desktop near wall's right end is
 * the pinwheel corner, not a jog: the near wall's overhanging end runs
 * `WALL_STAGGER` past the right wall's inner face (`layout.WALL_END`)
 * and, yawed `WALL_YAW`, swings 0.36 toward the near rail, so the right
 * wall's near-end stack stands behind and inboard of it (every stack at
 * y 0.31 / 0.93) and its ivory side shows above the near wall's top face.
 */
export const TABLE_BACK_GRADIENT = 0.55;
/**
 * Dealer chip: a red lacquer disc parked in the dealer's near-left
 * corner pocket — the patch the pinwheel rivers never reach (see
 * `layout.dealerChipLocal`). At the wide presets' river scale it sits at
 * z ≈ 5.1, which keeps its near edge above the near wall's inner top
 * edge from the low phone-landscape camera, so the glyph is never
 * half-occluded; on portrait it moves into the pocket between the left
 * wall and the near wall's retreated end.
 */
export const CHIP_RADIUS = 0.56;
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
/** Cue halo: draw-disc diameter (world units). */
const CUE_HALO_DRAW = 3.2;
/**
 * Cue halo, hand-row band: depth, extra width and forward shift (world
 * units). A contact glow under the standing row rather than a bar on the
 * felt behind it (round-FB4: "the golden glow behind your hand does not
 * fit in — change the effect or move it below the tiles"). The row's
 * tiles pivot about their centre by `HAND_TILT`, so their feet run from
 * z + 0.05 (back edge, on the felt) to z + 0.6 (front lip, floating
 * 0.23 above it); the band is centred 0.45 toward the camera from the
 * slot line and 0.9 deep, so it reaches from under the tiles' back edge
 * to the rail's foot (`FELT_HALF`, whose geometry hides it beyond) and
 * never onto the felt the wide cameras see *behind* the row (the
 * 0.2-unit strip past the tiles' tops). What shows is the light under
 * the feet: the sliver between the lip and the rail, the gaps between
 * tiles, and a pool at each end of the row (`CUE_HALO_HAND_PAD` past
 * the end tiles, feathered — `buildCueBandTexture`).
 */
const CUE_HALO_HAND_DEPTH = 0.9;
const CUE_HALO_HAND_PAD = 2.0;
const CUE_HALO_HAND_FRONT = 0.45;
/** Cue halo opacity at rest (pulses a little above and below it): the draw disc … */
const CUE_HALO_OPACITY = 0.78;
/**
 * Felt scale while the portrait zoom hides the walls and rail. The
 * held hand's front row stands ~19 world units out from the plan
 * camera's centre on the tall phone (its bottom at CSS y 743 of 915),
 * so the felt's near edge — 12.2 at rest — must reach past 20 for both
 * rows to sit on cloth on every phone; 1.3× (15.9) still cut the front
 * row on the 412×915 / 360×640 phones (round-4 final critic).
 */
const ZOOM_FELT_SCALE = 2.0;
/** How far the rail sinks for the zoom: its whole height plus a margin under the felt plane. */
const RAIL_SINK = RAIL_H + 0.1;
/**
 * Discard-hint frame (see `hintFrame`), world units: glow margin past
 * the face on each side, stroke bleed past the face edge as a fraction
 * of the face size, the hinted tile's steady lift along its up axis,
 * the frame's gap in front of the printed face, and how long the frame
 * breathes after the hint lands before holding steady (so a still
 * table idles, as the cue halo does).
 */
const HINT_PAD = 0.18;
const HINT_BLEED = 0.025;
const HINT_LIFT = 0.08;
const HINT_GAP = 0.012;
const HINT_OPACITY = 0.95;
const HINT_BREATHE_MS = 6000;
/** Outer size of the frame's stroke — what `TableDebugHint.markerRect` projects. */
const HINT_FRAME_W = TILE_W * (1 + 2 * HINT_BLEED);
const HINT_FRAME_H = TILE_H * (1 + 2 * HINT_BLEED);
const HINT_QUAD_W = TILE_W + 2 * HINT_PAD;
const HINT_QUAD_H = TILE_H + 2 * HINT_PAD;
/** … and the hand band, dimmer — an underlight, not a highlight. */
const CUE_HALO_BAND_OPACITY = 0.55;
const _m = new Matrix4();
const _obj = new Object3D();
const _q = new Quaternion();
const _lift = new Vector3();
const _dragDir = new Vector3();
const _dragNormal = new Vector3();
const _dragV = new Vector3();
const _dragQ = new Quaternion();
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
  private plateInfo: { wind: Wind | null; count: number | null; dead: number } = {
    wind: null,
    count: -1,
    dead: -1,
  };
  private marker: Mesh;
  private markerRel: Rel | null = null;
  private markerScale = 1;
  private dice: InstancedMesh;
  private diceValues: [number, number] | null = null;
  /**
   * Gold cue glow on the felt (one quad, radial canvas gradient): under
   * the drawable stack while the user has to draw, and stretched along
   * the user's hand row while a discard is due — the two "your move"
   * states, readable at a glance from every preset (the tinted next
   * tile alone was easy to miss at desktop).
   */
  private cueHalo: Mesh;
  private cueHaloMat: MeshBasicMaterial;
  private cueHaloTarget = { x: 0, z: 0, sx: 0, sz: 0, on: false, band: false };
  /** Disc (draw cue) and band (hand row) alphas — one material, the map swaps. */
  private cueHaloTex: Texture;
  private cueBandTex: Texture;
  /**
   * Discard hint: a gold rounded-rect frame quad a hair in front of the
   * hinted tile's printed face, placed from the tile's pool pose every
   * `writePoses` (same quaternion, +Z offset, scaled with the tile) so
   * it is aligned by construction from every camera and rides the tile
   * through drags, re-sorts and the draw / discard springs. Replaces
   * the DOM ring the HUD used to re-project a frame late.
   */
  private hintFrame: Mesh;
  private hintMat: MeshBasicMaterial;
  private hintPhase = 0;
  /** Breathe until this timestamp, then hold steady (see `HINT_BREATHE_MS`). */
  private hintUntil = 0;
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
  /** Camera matrix at the last frame — a moving camera re-renders the shadow pass too. */
  private readonly frameCam = new Matrix4();
  private lift = new Float32Array(136);
  /**
   * Drag-to-reorder (`hud/HitTargets`): the tile the pointer is carrying,
   * the world point under the pointer on a view-parallel plane through
   * the tile's settled slot, and the eased lift (0 → `DRAG_LIFT`).
   */
  private dragId: number | null = null;
  private readonly dragPos = new Vector3();
  private dragLift = 0;
  private pulseT = 0;
  /** Pulses run for a few seconds after each cue, then hold steady so a still table idles. */
  private pulseUntil = 0;
  /** Last `update()` timestamp — springs use wall-clock time, not the loop's clamped dt. */
  private lastNow = 0;
  /** River-zoom blend (0 table, 1 zoom) the felt scale and rail sink follow — see `applyZoomBlend`. */
  private zoomBlend = 0;
  private zoomTarget = 0;
  private nearWallDim = 1;
  private lastLayout: Layout | null = null;
  private lastWaiting = false;
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

    // Rail — one mitred ring (`rail.ts`): four swept profiles whose ends
    // meet on the 45° diagonals, so the corners have no overlapping
    // slabs to z-fight or rounded ends showing through the neighbour.
    const wood = buildWoodMap();
    wood.repeat.set(4, 1);
    this.textures.push(wood);
    const railMat = new MeshPhysicalMaterial({
      map: wood,
      roughness: 0.45,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.35,
    });
    const railGeo = buildRailGeometry();
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

    // Cue glow (see `cueHalo`).
    this.cueHaloTex = buildCueHaloTexture();
    this.cueBandTex = buildCueBandTexture();
    this.textures.push(this.cueHaloTex, this.cueBandTex);
    this.cueHaloMat = new MeshBasicMaterial({
      map: this.cueHaloTex,
      color: 0xf3b74a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const haloGeo = new PlaneGeometry(1, 1);
    this.geometries.push(haloGeo);
    this.cueHalo = new Mesh(haloGeo, this.cueHaloMat);
    this.cueHalo.rotation.x = -Math.PI / 2;
    this.cueHalo.visible = false;
    this.cueHalo.renderOrder = 1;
    this.cueHalo.name = 'cue-halo';
    scene.add(this.cueHalo);

    // Discard-hint frame (see `hintFrame`). Same material class + map
    // slot as the cue halo, so it shares that compiled program; the
    // polygon offset plus the +Z gap keep it clear of the face's depth.
    const hintTex = buildHintFrameTexture(TILE_W, TILE_H, HINT_PAD, HINT_BLEED, TILE_RADIUS);
    hintTex.anisotropy = Math.max(1, Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
    this.textures.push(hintTex);
    this.hintMat = new MeshBasicMaterial({
      map: hintTex,
      color: 0xe9ac3c,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.hintFrame = new Mesh(haloGeo, this.hintMat);
    this.hintFrame.visible = false;
    this.hintFrame.renderOrder = 2;
    this.hintFrame.name = 'hint-frame';
    scene.add(this.hintFrame);

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
    setTileBackGradient(this.pool.material, TABLE_BACK_GRADIENT);
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
    this.dragId = null;
    this.dragLift = 0;
    this.pulseT = 0;
    this.pulseUntil = 0;
    this.lastNow = 0;
    this.nearWallDim = 1;
    this.plateInfo = { wind: null, count: -1, dead: -1 };
    this.marker.visible = false;
    this.markerRel = null;
    this.markerScale = 1;
    this.cueHalo.visible = false;
    this.cueHaloMat.opacity = 0;
    this.cueHaloTarget = { x: 0, z: 0, sx: 0, sz: 0, on: false, band: false };
    this.hintFrame.visible = false;
    this.hintMat.opacity = 0;
    this.hintPhase = 0;
    this.hintUntil = 0;
    this.lastWaiting = false;
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
    this.requestFullFrame();
  }

  setHover(id: number | null): void {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.requestFullFrame();
  }

  /**
   * Drag-to-reorder feedback (additive). While `id` is set the instance
   * follows the pointer instead of its slot: `screenX` / `screenY` are
   * canvas CSS px, unprojected onto the view-parallel plane through the
   * tile's settled slot so the tile stays at hand depth on every preset
   * (table-standing rows and the camera-facing held hand alike), then
   * raised by `DRAG_LIFT` along its own up axis with a slight extra lean.
   * The other tiles keep re-flowing through the choreographer's springs
   * as the store order changes. `null` ends the drag: the carried tile's
   * motion state is seeded from where it was let go so it springs into
   * its slot (snaps under reduced motion).
   */
  setDraggedTile(id: number | null, screenX = 0, screenY = 0): void {
    const prev = this.dragId;
    if (id === null) {
      if (prev === null) return;
      const t = this.choreo.tiles[prev];
      // Only a tile with a spring target can carry on from the drop pose;
      // anything else (mid-flight, reduced motion) snaps to its own motion.
      if (t?.target && !this.choreo.reducedMotion && t.slot?.zone === 'hand' && !t.flight) {
        this.dragPose(t, this.dragPos, _m);
        _m.decompose(t.pos, t.quat, _lift);
      }
      this.dragId = null;
      this.dragLift = 0;
      this.requestFullFrame();
      return;
    }
    const t = this.choreo.tiles[id];
    if (!t?.visible) return;
    if (prev !== id) {
      this.dragId = id;
      this.dragLift = this.choreo.reducedMotion ? DRAG_LIFT : 0;
    }
    const cam = this.ctx.rig.camera;
    cam.updateMatrixWorld();
    const anchor = t.target?.pos ?? t.pos;
    _dragDir.set(
      (screenX / Math.max(1, this.ctx.size.width)) * 2 - 1,
      -(screenY / Math.max(1, this.ctx.size.height)) * 2 + 1,
      0.5,
    );
    _dragDir.unproject(cam).sub(cam.position).normalize();
    cam.getWorldDirection(_dragNormal);
    const denom = _dragDir.dot(_dragNormal);
    if (Math.abs(denom) < 1e-6) return;
    const dist = _lift.copy(anchor).sub(cam.position).dot(_dragNormal) / denom;
    this.dragPos.copy(cam.position).addScaledVector(_dragDir, Math.max(0, dist));
    this.requestFullFrame();
  }

  /** Whether `id` is the tile a drag is carrying. */
  get draggedTileId(): number | null {
    return this.dragId;
  }

  /** Pose of the carried tile: `at` lifted along its up axis, leaning back a shade. */
  private dragPose(t: TileMotionState, at: Vector3, out: Matrix4): Matrix4 {
    const quat = t.target?.quat ?? t.quat;
    _dragQ.setFromAxisAngle(X_AXIS, -DRAG_TILT).premultiply(quat);
    _lift.set(0, 1, 0).applyQuaternion(quat).multiplyScalar(this.dragLift);
    _dragV.copy(at).add(_lift);
    _settleScale.setScalar(t.slot?.scale ?? 1);
    return out.compose(_dragV, _dragQ, _settleScale);
  }

  /**
   * Every frame the table renders is a *full* frame — shadow pass
   * included — so the perf sampler's numbers describe one consistent
   * frame (round-4 #7: a hover-only or camera-only re-render skipped the
   * shadow pass and reported 8 calls / 42k triangles against the 12 /
   * 83k of every other still). The pass costs a fraction of a
   * millisecond on the reference phone and only runs when something
   * re-renders anyway.
   */
  private requestFullFrame(): void {
    this.ctx.renderer.shadowMap.needsUpdate = true;
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
      reveal: state.phase === 'resolved' || input.revealAll === true,
      heldHand: input.heldHand ?? null,
      riverScale: input.riverScale ?? 1,
      hideWalls: input.hideWalls,
      concealOwn: input.concealOwn,
      sideSeatOut: input.sideSeatOut,
      farSeatOut: input.farSeatOut,
      sideMeldsNear: input.sideMeldsNear,
      sideMeldScale: input.sideMeldScale,
      farMeldsOnRail: input.farMeldsOnRail,
      hideSideSeats: input.hideSideSeats,
      waitingWalls: input.waiting,
      ownMeldsStanding: input.ownMeldsStanding,
    });
    const prevLayout = this.lastLayout;
    this.lastLayout = layout;
    const waiting = input.waiting === true;
    this.lastWaiting = waiting;
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
    if (input.hintTileId !== this.hintTileId) {
      this.hintTileId = input.hintTileId;
      this.hintUntil = now + HINT_BREATHE_MS;
    }
    this.needsDraw = input.needsDraw;
    this.nearWallDim = input.nearWallDim ?? 1;
    const next = state.wall[state.wall.length - 1];
    this.nextDrawId = next
      ? (layout.findIndex((s) => s?.zone === 'wall' && s.index === 0) ?? null)
      : null;
    if (this.nextDrawId === -1) this.nextDrawId = null;
    this.syncCueHalo(layout, input.canDiscard === true);

    // Face cells: concealed opponents show the back on the printed side.
    for (let id = 0; id < 136; id++) {
      const slot = layout[id];
      if (!slot) continue;
      if (slot.back && slot.zone !== 'wall' && slot.zone !== 'deadWall') this.pool.showBack(id);
      else this.pool.showFace(id);
    }

    // Centre plate + marker + dice. No dealer exists before the opening
    // roll, so the waiting table shows neither chip nor dice.
    this.updatePlate(
      state.prevailingWind,
      waiting ? null : state.wall.length,
      state.deadWall.length,
    );
    const rel = relOf(state.dealer, me);
    const riverScale = input.riverScale ?? 1;
    if (waiting) {
      this.marker.visible = false;
      this.markerRel = null;
    } else if (rel !== this.markerRel || riverScale !== this.markerScale) {
      this.markerRel = rel;
      this.markerScale = riverScale;
      // Parked in the dealer's near-left corner, glyph facing the dealer
      // (`dealerChipLocal`: beside the arm's end on the wide presets, in
      // the walls' corner pocket on portrait).
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
    // Portrait river zoom lays out no wall (`hideWalls`); the rail goes
    // with it. From the 84° plan view the near rail projected between
    // the held hand's two rows, so the back row read as lying on the
    // felt and the front row as off the table (round-4 critic). The
    // felt grows past its edge so both held rows sit on cloth: from the
    // plan view its edge otherwise crossed between the rows the way the
    // rail did. Both blend in `update` (`applyZoomBlend`) on the beat the
    // walls take to sink through the felt, rather than switching.
    this.zoomTarget = input.hideWalls === true ? 1 : 0;
    if (this.choreo.reducedMotion) this.applyZoomBlend(this.zoomTarget);
    this.ctx.renderer.shadowMap.needsUpdate = true;
    this.ctx.loop.requestRender();
  }

  /**
   * Felt scale 1 → `ZOOM_FELT_SCALE` and the rail sunk under the felt
   * plane (its top ends `RAIL_SINK − RAIL_H` below it) at blend 1; the
   * rail is only culled once fully under.
   */
  private applyZoomBlend(blend: number): void {
    this.zoomBlend = blend;
    this.feltMesh.scale.setScalar(1 + (ZOOM_FELT_SCALE - 1) * blend);
    this.railMesh.position.y = -RAIL_SINK * blend;
    this.railMesh.visible = blend < 1;
  }

  /**
   * Aim the cue glow: a disc under the drawable stack while the user
   * has to draw, else a band along the user's hand row (its felt-
   * standing slots — the held portrait hand has no felt under it and
   * the tray's turn chip carries that state) while a discard is due;
   * otherwise fade out. Position + size are set here, opacity eases in
   * `update()`.
   */
  private syncCueHalo(layout: Layout, canDiscard: boolean): void {
    const t = this.cueHaloTarget;
    const draw = this.needsDraw && this.nextDrawId !== null ? layout[this.nextDrawId] : null;
    if (draw) {
      t.x = draw.x;
      t.z = draw.z;
      t.sx = CUE_HALO_DRAW;
      t.sz = CUE_HALO_DRAW;
      t.on = true;
      t.band = false;
      return;
    }
    if (canDiscard) {
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let z = 0;
      let n = 0;
      for (const slot of layout) {
        if (!slot || slot.zone !== 'hand' || slot.quat !== undefined) continue;
        minX = Math.min(minX, slot.x);
        maxX = Math.max(maxX, slot.x);
        z += slot.z;
        n++;
      }
      if (n > 0) {
        t.x = (minX + maxX) / 2;
        // Centred under the tiles' feet, toward the camera (see the
        // constants): light from under the row, not a bar behind it.
        t.z = z / n + CUE_HALO_HAND_FRONT;
        t.sx = maxX - minX + TILE_W + CUE_HALO_HAND_PAD;
        t.sz = CUE_HALO_HAND_DEPTH;
        t.on = true;
        t.band = true;
        return;
      }
    }
    t.on = false;
  }

  private updatePlate(wind: Wind, count: number | null, dead: number): void {
    const p = this.plateInfo;
    if (p.wind === wind && p.count === count && p.dead === dead) return;
    this.plateInfo = { wind, count, dead };
    drawPlate(this.plateTex.ctx, this.plateTex.size, {
      prevailingWind: wind,
      wallCount: count,
      deadCount: dead,
    });
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
    // Zoom blend: the rail sinks under the spreading felt while the
    // walls sink through it (`choreography` `vanish`, ~0.36 s).
    if (this.zoomBlend !== this.zoomTarget) {
      const k = this.choreo.reducedMotion ? 1 : Math.min(1, dt * 8);
      let next = this.zoomBlend + (this.zoomTarget - this.zoomBlend) * k;
      if (Math.abs(next - this.zoomTarget) < 0.004) next = this.zoomTarget;
      this.applyZoomBlend(next);
      live = true;
    }
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
    // Drag lift eases in (the release springs through the choreographer).
    if (this.dragId !== null && this.dragLift < DRAG_LIFT) {
      this.dragLift = Math.min(
        DRAG_LIFT,
        this.dragLift + (DRAG_LIFT - this.dragLift) * Math.min(1, dt * 18),
      );
      if (DRAG_LIFT - this.dragLift < 0.002) this.dragLift = DRAG_LIFT;
      live = true;
    }
    // Hover lift eases in/out; the hinted tile holds a small steady lift.
    for (let id = 0; id < 136; id++) {
      const target = (id === this.hoverId ? 0.14 : 0) + (id === this.hintTileId ? HINT_LIFT : 0);
      const cur = this.lift[id]!;
      if (Math.abs(cur - target) > 0.001) {
        this.lift[id] = cur + (target - cur) * Math.min(1, dt * 14);
        live = true;
      } else if (cur !== target) {
        this.lift[id] = target;
      }
    }
    // Cue halo: ease opacity toward its target, breathe while pulsing.
    {
      const t = this.cueHaloTarget;
      const pulse = this.pulseT === 0 ? 0.6 : 0.5 + 0.5 * Math.sin(this.pulseT * 4.2);
      const rest = t.band ? CUE_HALO_BAND_OPACITY : CUE_HALO_OPACITY;
      const want = t.on ? rest * (0.82 + 0.3 * pulse) : 0;
      const cur = this.cueHaloMat.opacity;
      if (Math.abs(cur - want) > 0.004) {
        const k = this.choreo.reducedMotion ? 1 : Math.min(1, dt * 9);
        this.cueHaloMat.opacity = cur + (want - cur) * k;
        live = true;
      } else if (cur !== want) this.cueHaloMat.opacity = want;
      if (t.on) {
        this.cueHalo.position.set(t.x, 0.015, t.z);
        this.cueHalo.scale.set(t.sx, t.sz, 1);
        const map = t.band ? this.cueBandTex : this.cueHaloTex;
        if (this.cueHaloMat.map !== map) this.cueHaloMat.map = map;
      }
      this.cueHalo.visible = this.cueHaloMat.opacity > 0.004;
    }
    // Discard-hint frame: ease opacity toward its target; breathe for a
    // while after the hint lands, then hold (static under reduced motion).
    {
      const on = this.hintActive();
      const breathing = on && !this.choreo.reducedMotion && now < this.hintUntil;
      if (breathing) {
        this.hintPhase += dt;
        live = true;
      } else if (this.hintPhase !== 0) {
        this.hintPhase = 0;
        live = true;
      }
      const breathe = this.hintPhase === 0 ? 0.5 : 0.5 + 0.5 * Math.sin(this.hintPhase * 2.8);
      const want = on ? HINT_OPACITY * (0.8 + 0.2 * breathe) : 0;
      const cur = this.hintMat.opacity;
      if (Math.abs(cur - want) > 0.004) {
        const k = this.choreo.reducedMotion ? 1 : Math.min(1, dt * 10);
        this.hintMat.opacity = cur + (want - cur) * k;
        live = true;
      } else if (cur !== want) this.hintMat.opacity = want;
      this.hintFrame.visible = this.hintMat.opacity > 0.004;
    }
    // Tutorial spotlight: the active lesson step publishes the tiles it
    // is about (`three/tutorial/Tutorial3D` → `core/spotlight`); they
    // breathe gold while the set is non-empty, and a change of set
    // renders one frame even when it just cleared.
    const spotIds = getSpotlightTiles();
    if (spotlightVersion() !== this.spotSeq || (spotIds.length > 0 && !this.choreo.reducedMotion))
      live = true;
    this.writePoses(now);
    // A camera move (rig ease, parallax) re-renders without any tile
    // moving; render it as a full frame too (see `requestFullFrame`).
    const cam = this.ctx.rig.camera;
    cam.updateMatrixWorld();
    const camMoved = !cam.matrixWorld.equals(this.frameCam);
    if (camMoved) this.frameCam.copy(cam.matrixWorld);
    if (live || camMoved) this.ctx.renderer.shadowMap.needsUpdate = true;
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
    const stackTop = TILE_D * 2;
    let left = Number.NEGATIVE_INFINITY;
    let right = Number.POSITIVE_INFINITY;
    let top = Number.NEGATIVE_INFINITY;
    let bottom = Number.POSITIVE_INFINITY;
    // Each wall's inner face is a yawed line (`wallInnerFaceAt`, owner's
    // frame): world t along the left / near walls is the owner's x, along
    // the right / far walls it is −x (`toLocal`).
    for (const t of [-9.5, 0, 9.5]) {
      left = Math.max(left, this.projectPoint(-wallInnerFaceAt(t), 0, t).x);
      right = Math.min(right, this.projectPoint(wallInnerFaceAt(-t), 0, t).x);
      top = Math.max(top, this.projectPoint(t, 0, -wallInnerFaceAt(-t)).y);
      bottom = Math.min(bottom, this.projectPoint(t, stackTop, wallInnerFaceAt(t)).y);
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
      const dragged = id === this.dragId && t.slot?.zone === 'hand';
      if (dragged) {
        // Carried tile: under the pointer, lifted, leaning back a shade.
        this.dragPose(t, this.dragPos, _m).decompose(p.position, p.quaternion, _dragV);
      }
      if (this.needsDraw && id === this.nextDrawId) {
        // Primary cue: strong gold pulse plus a small lift off the stack.
        hl = 0.85 + 0.15 * pulse;
        p.position.y += 0.16 + 0.08 * pulse;
      } else if (id === cueId) hl = 0.5 + 0.45 * pulse;
      else if (id === this.drawnTileId) hl = 0.22;
      else if (id === this.hintTileId) hl = 0.12;
      if (spotLevel > 0 && this.spotMask[id] === 1) hl = Math.max(hl, spotLevel);
      if (dragged) hl = Math.max(hl, 0.25);
      p.highlight = hl;
      if (id === this.hintTileId) this.placeHintFrame(p);
      p.tint.setScalar(1);
      const zone = t.slot?.zone;
      // Dead wall reads as a shaded segment of the same set: its backs
      // take the skin's darker shade (`uDeadBack*`, derived from the skin
      // in `materials.deadBackColors`) and nothing else — no inlay band
      // (round-4: it read as stray yellow stripes on the stacks) and no
      // positional step (see `wallSlotPosition`).
      p.backVariant = zone === 'deadWall' ? 1 : 0;
      if ((zone === 'wall' || zone === 'deadWall') && t.slot?.rel === 0 && this.nearWallDim !== 1)
        p.tint.setScalar(this.nearWallDim);
    }
    this.pool.markDirty();
    this.pool.commit();
  }

  /** The hint has a tile to frame: in the user's hand, landed, visible. */
  private hintActive(): boolean {
    if (this.hintTileId === null) return false;
    const t = this.choreo.tiles[this.hintTileId];
    return t?.visible === true && t.slot?.zone === 'hand' && !t.flight;
  }

  /** Park the hint frame a hair in front of `p`'s printed (+Z) face. */
  private placeHintFrame(p: TilePose): void {
    const f = this.hintFrame;
    _lift
      .set(0, 0, 1)
      .applyQuaternion(p.quaternion)
      .multiplyScalar((TILE_D / 2 + HINT_GAP) * p.scale);
    f.position.copy(p.position).add(_lift);
    f.quaternion.copy(p.quaternion);
    f.scale.set(HINT_QUAD_W * p.scale, HINT_QUAD_H * p.scale, 1);
  }

  /** Screen rect (CSS px) of the hint frame's stroke, or null while it is faded out. */
  hintMarkerRect(out?: ScreenRect): ScreenRect | null {
    if (!this.hintFrame.visible) return null;
    this.hintFrame.updateMatrixWorld();
    // The quad is a unit plane scaled to the padded size, so the stroke's
    // extents are its fraction of the quad.
    return projectPlaneRect(
      HINT_FRAME_W / HINT_QUAD_W,
      HINT_FRAME_H / HINT_QUAD_H,
      this.hintFrame.matrixWorld,
      this.ctx.rig.camera,
      this.ctx.size.width,
      this.ctx.size.height,
      out,
    );
  }

  /** Screen rect (CSS px) of a tile instance, or null when hidden. */
  tileRect(id: number, out?: ScreenRect): ScreenRect | null {
    const t = this.choreo.tiles[id];
    if (!t || !t.visible) return null;
    this.pool.mesh.updateMatrixWorld();
    const m = this.pool.matrixAt(id, _m);
    return projectTileRect(m, this.ctx.rig.camera, this.ctx.size.width, this.ctx.size.height, out);
  }

  /** Screen rect (CSS px) of a tile's printed face only — what the
   *  player sees as "the tile"; overlays that hug it use this instead of
   *  the box bounds. Null when hidden. */
  tileFaceRect(id: number, out?: ScreenRect): ScreenRect | null {
    const t = this.choreo.tiles[id];
    if (!t || !t.visible) return null;
    this.pool.mesh.updateMatrixWorld();
    const m = this.pool.matrixAt(id, _m);
    return projectTileFaceRect(
      m,
      this.ctx.rig.camera,
      this.ctx.size.width,
      this.ctx.size.height,
      out,
    );
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
    const hint =
      this.hintTileId === null
        ? null
        : {
            tileId: this.hintTileId,
            faceRect: this.tileFaceRect(this.hintTileId),
            markerRect: this.hintMarkerRect(),
          };
    return { now, tiles, flights: tiles.filter((t) => t.flight !== null).length, hint };
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
      this.cueHalo,
      this.hintFrame,
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
    this.cueHaloMat.dispose();
    this.hintMat.dispose();
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
