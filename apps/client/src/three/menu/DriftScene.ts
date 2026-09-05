import { Euler, FogExp2, Vector3 } from 'three';
import type { TileBackSkin } from '../../state/game';
import { type HeroBand, getHeroBand, subscribeHeroBand } from '../../ui/menu/heroBand';
import {
  OCCLUDER_BAND_PX,
  type OccluderRect,
  getOccluders,
  occluderFactor,
  occluderVersion,
  rectSignedDistance,
} from '../../ui/menu/menuOccluders';
import type { SceneContext, SceneHandle } from '../core/SceneHost';
import { buildLights } from '../core/lights';
import { clamp01, easeOutCubic, lerp } from '../core/tween';
import { TilePool } from '../tiles/TilePool';
import { BACK_CELL } from '../tiles/faceAtlas';
import { TILE_H } from '../tiles/geometry';
import {
  DRIFT_COUNT,
  type DriftTile,
  type MenuLayout,
  type MenuView,
  type ScreenRect,
  driftCandidates,
  driftField,
  frameWidthAt,
  inKeepOut,
  menuLayout,
  placeOutsideKeepOut,
  seededRandom,
  wrapDriftY,
  wrapUnit,
} from './layout';
import { publishDriftDebug } from './menuDebug';

/**
 * Menu drift field: a sparse field of tiles drifting very slowly in
 * the fog behind the lobby, in the fixed full-viewport canvas under the
 * page (`LobbyBackdrop`). The hero rack + dice are the other canvas
 * (`HeroScene`), mounted inside the hero band so they scroll with the
 * title; this one never follows scroll — a fixed field behind a
 * scrolling page reads as depth, a field that chases scroll events
 * reads as jitter. The canvas is transparent; the void gradient is DOM.
 *
 * The field is laid out in the same world as the hero — `menuLayout`
 * fitted to the hero band's *size* — so its scale and fog agree with
 * the rack; the band's position only enters as the initial title
 * keep-out and the rack keep-out (the rack's footprint, tracked through
 * the live band rect so the fade keeps clearing it while the page
 * scrolls).
 *
 * Motion budget (ARCHITECTURE.md §2): an intro settle of ~1.2 s, then
 * the field drifts at a throttled ~11 fps cadence (render-on-demand —
 * the loop skips `renderer.render` between drift steps) and springs to
 * full rate only while the pointer moves. Reduced motion: no intro,
 * no drift, no parallax → the loop idles completely.
 */
export interface DriftSceneOptions {
  tileBack: TileBackSkin;
}

const INTRO_DRIFT_MS = 700;
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
 *  entrance slide, the 800 ms settle re-measure): under reduced motion
 *  the one frozen frame is all anyone sees, so re-seed on every rect
 *  change inside this window after build. */
const OCCLUDER_SETTLE_MS = 3000;
/** Below this best-case visibility a re-seeded tile is parked (hidden)
 *  rather than shown as a speck in an edge band. */
const PARK_BELOW = 0.75;
/** Minimum centre distance between re-seeded tiles, in summed radii. */
const SPREAD = 1.6;
/** Fade / keep-out disc radius in world units. */
const TILE_R = TILE_H * 0.72;
/** The field's tiles are ≤ ~45 CSS px across and fogged: half-size
 *  atlas cells (128 × 176) are still oversampled, at a quarter of the
 *  texture memory the hero canvas's full atlas costs. */
const DRIFT_ATLAS_SCALE = 0.5;

interface Tween {
  start: number;
  duration: number;
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

const _euler = new Euler();
const _vWorld = new Vector3();
const _vCam = new Vector3();
const _vNdc = new Vector3();

function tweenProgress(t: Tween, now: number): number {
  if (t.duration <= 0) return 1;
  return easeOutCubic(clamp01((now - t.start) / t.duration));
}

/** A band with `next`'s size; `null` ↔ non-null or a ≥ 1 px size change counts. */
function bandSizeChanged(a: HeroBand | null, b: HeroBand | null): boolean {
  if ((a === null) !== (b === null)) return true;
  if (!a || !b) return false;
  return Math.abs(a.w - b.w) >= 1 || Math.abs(a.h - b.h) >= 1;
}

export function buildDriftScene(ctx: SceneContext, opts: DriftSceneOptions): SceneHandle {
  const { scene, renderer, rig, quality, loop, reducedMotion } = ctx;
  const snap = reducedMotion;
  // No shadow pass in the field: the far tiles cast onto nothing.
  renderer.shadowMap.enabled = false;

  /**
   * The band the layout is fitted to. Its *size* tracks the live band
   * (a re-fit dollies the camera, so the field's scale and fog stay
   * the hero's); its *position* is frozen at the last size change — a
   * scroll moves the band, and must never re-aim this camera.
   */
  let fitBand: HeroBand | null = getHeroBand();
  const driftView = (width: number, height: number): MenuView => ({
    width,
    height,
    band: fitBand,
  });
  let layout: MenuLayout = menuLayout(
    ctx.size.width / Math.max(1, ctx.size.height),
    driftView(ctx.size.width, ctx.size.height),
  );
  rig.snap(layout.camera);
  rig.halfLife = 0.28;

  // ── Lights ─────────────────────────────────────────────────────────
  const lights = buildLights(
    scene,
    renderer,
    { ...quality, shadowMapSize: 0 },
    { keyColor: 0xffe4bd, skyColor: 0xc9d6e6, groundColor: 0x1e2a23 },
  );
  lights.key.position.set(-5, 8.5, 6.5);
  lights.key.intensity = 2.5;
  lights.hemi.intensity = 0.75;
  lights.ambient.intensity = 0.1;
  if (scene.environment) scene.environmentIntensity = 0.45;

  scene.fog = new FogExp2(FOG_COLOR, layout.fogDensity);

  // ── Tiles ──────────────────────────────────────────────────────────
  const pool = new TilePool(opts.tileBack, { atlasScale: DRIFT_ATLAS_SCALE });
  pool.mesh.count = DRIFT_COUNT;
  pool.mesh.castShadow = false;
  pool.mesh.receiveShadow = false;
  scene.add(pool.mesh);

  const introStart = performance.now();
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
    const p = pool.pose(j);
    p.visible = true;
    p.faceCell = d.cell < 0 ? BACK_CELL : d.cell;
    // Far tiles sink toward the void: dimmer body + the fog does the rest.
    const shade = lerp(0.92, 0.5, d.depth);
    p.tint.setScalar(shade);
  });

  // ── DOM occluders (cards, footer, title) + the rack ────────────────
  // Lobby surfaces register their window rects (`useMenuOccluder`); a
  // drift tile shrinks to nothing while it straddles a glass edge or
  // crosses solid copy (`occluderFactor`). Rects change on scroll /
  // resize; the fade re-runs on any change.
  /** Rects the lobby DOM registered — the gate for re-seeding. */
  let domOccluders: OccluderRect[] = getOccluders();
  /** DOM rects + the scene's own keep-outs (`sceneOccluders`). */
  let occluders: OccluderRect[] = domOccluders;
  let occluderSeen = occluderVersion();
  let reseeded = false;
  /** The live band moved (a scroll): the rack keep-out must follow. */
  let bandMoved = false;

  /**
   * The settled rack's footprint (tiles + dice) relative to the band
   * it was fitted in — translation-invariant, so the live rack is this
   * offset by the live band's corner however far the page has scrolled.
   */
  let rackLocal: ScreenRect | null = null;
  const refreshRackLocal = () => {
    const fp = layout.footprint;
    const b = layout.band;
    rackLocal = fp && b ? { x: fp.all.x - b.x, y: fp.all.y - b.y, w: fp.all.w, h: fp.all.h } : null;
  };
  refreshRackLocal();
  const rackRect = (): OccluderRect | null => {
    const band = getHeroBand();
    if (!band || !rackLocal) return null;
    return {
      x: band.x + rackLocal.x,
      y: band.y + rackLocal.y,
      w: rackLocal.w,
      h: rackLocal.h,
      kind: 'solid',
      band: RACK_BAND_PX,
    };
  };

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
   *  offset included). The canvas is the viewport, so canvas px are
   *  window px. */
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
      const rack = rackRect();
      if (rack) out.push(rack);
    }
    return out;
  };
  const refreshOccluders = () => {
    occluderSeen = occluderVersion();
    bandMoved = false;
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
      (layout.cls === 'wide' && rack !== null && rectSignedDistance(x, y, rack) < -r * 0.3) ||
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

  // ── Per-frame pose writer ──────────────────────────────────────────
  let driftAccum = 0;
  let driftLive = true;
  let firstFrame = true;

  const _proj = { x: 0, y: 0, r: 0 };
  const debugFades: number[] = [];
  const debugTiles: { x: number; y: number; r: number; fade: number; parked: boolean }[] = [];
  const writeDrift = (now: number, dt: number): boolean => {
    let live = false;
    // Projection needs the camera's matrices for this frame.
    rig.camera.updateMatrixWorld();
    if (!reseeded || occluderVersion() !== occluderSeen || bandMoved) {
      const changed = occluderVersion() !== occluderSeen;
      refreshOccluders();
      // The frozen reduced-motion field's one frame is all anyone sees:
      // redo the seeding while the lobby's rects are still settling.
      if (changed && snap && now - introStart < OCCLUDER_SETTLE_MS) reseeded = false;
      reseedForOccluders();
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
      const p = pool.pose(j);
      p.visible = j < layout.driftVisible && !d.parked;
      driftWorldPos(d, d.ux, d.uy, pointerSmooth.x * par, pointerSmooth.y * par * 0.5, p.position);
      p.quaternion.setFromEuler(_euler.set(d.ax, d.ay, d.rz, 'XYZ'));
      // Shrink to nothing while straddling a glass edge / crossing copy
      // (or the rack), and to a faint depth cue while fully behind glass.
      projectPoint(p.position, TILE_R, _proj);
      let fade =
        domOccluders.length > 0
          ? occluderFactor(_proj.x, _proj.y, _proj.r, occluders, OCCLUDER_BAND_PX, GLASS_INTERIOR)
          : 1;
      if (d.parked) fade = 0;
      p.scale = 0.001 + 0.999 * e * fade;
      debugFades[j] = fade;
      debugTiles[j] = { x: _proj.x, y: _proj.y, r: _proj.r * fade, fade, parked: d.parked };
    }
    let parked = 0;
    for (let j = 0; j < layout.driftVisible; j++) if (drift[j]?.parked) parked++;
    publishDriftDebug({
      occluders: occluders.length,
      occluderRects: occluders.map((r) => ({ ...r })),
      reseeded,
      visible: layout.driftVisible,
      parked,
      fades: debugFades.slice(0, layout.driftVisible),
      tiles: debugTiles.slice(0, layout.driftVisible),
    });
    return live;
  };

  /** Off-axis frustum so the field's centre lands at `layout.viewCenter`. */
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

  const applyLayout = (width: number, height: number) => {
    const aspect = width / Math.max(1, height);
    layout = menuLayout(aspect, driftView(width, height));
    refreshRackLocal();
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
    loop.requestRender();
  };

  // Initial view offset (SceneHost sizes the renderer right after build).
  applyViewOffset(ctx.size.width, ctx.size.height);

  /**
   * The lobby re-measures its hero band on scroll, on resize, when the
   * web fonts land and when the title reflows. A band that changed
   * *size* re-fits the field the way a resize does (eased camera) so it
   * stays in the hero's world; a band that only *moved* (a scroll) just
   * moves the rack keep-out — this camera never follows scroll.
   */
  const unsubscribeBand = subscribeHeroBand(() => {
    const band = getHeroBand();
    if (bandSizeChanged(fitBand, band)) {
      fitBand = band;
      applyLayout(ctx.size.width, ctx.size.height);
      return;
    }
    bandMoved = true;
    loop.requestRender();
  });

  /** A card, the title or the band moved: the fade must re-run. */
  const rectsDirty = (now: number): boolean =>
    occluderVersion() !== occluderSeen ||
    bandMoved ||
    (!reseeded && now - introStart >= 0 && getOccluders().length > 0);

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

      // Full rate during intro / pointer motion, else a throttled
      // cadence so the loop idles between steps. In between, a moved
      // rect (a card scrolling over a tile, the rack keep-out following
      // the band) re-runs the fade without advancing the field, so the
      // fade tracks the DOM at frame rate instead of the drift cadence.
      if (driftLive || live || pointerHot || firstFrame) {
        driftLive = writeDrift(now, reducedMotion ? 0 : dt);
        driftAccum = 0;
        live = true;
      } else {
        if (!reducedMotion) driftAccum += dt;
        if (driftAccum * 1000 >= DRIFT_STEP_MS) {
          writeDrift(now, driftAccum);
          driftAccum = 0;
          live = true;
        } else if (rectsDirty(now)) {
          writeDrift(now, 0);
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
      applyLayout(width, height);
    },
    dispose() {
      publishDriftDebug(null);
      unsubscribeBand();
      if (parallaxOn) window.removeEventListener('pointermove', onPointer);
      lights.dispose();
      pool.dispose();
      scene.remove(pool.mesh);
      scene.fog = null;
    },
  };
}

/** Test seam: the drift cadence in words. */
export const DRIFT_MOTION = { INTRO_DRIFT_MS, DRIFT_STEP_MS };
