import { type GameState, buildWall, emptyState } from '@mahjong/game-logic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../../../state/game';
import { type SceneContext, type SceneHandle, SceneHost } from '../../core/SceneHost';
import type { CameraPreset } from '../../core/camera';
import {
  TABLE_POOL_KEY,
  type TableScene,
  acquireTableScene,
  releaseTableScene,
} from '../TableScene';
import { portraitCameraAnchored, projectPreset } from '../cameraPresets';
import { FELT_HALF, RAIL_H, RAIL_WIDTH } from '../layout';

/**
 * The waiting room's scene: the match table itself, walls built and
 * waiting for the opening roll, seen from a low cinematic angle behind
 * the glass lobby. It is the same `TableScene` the match mounts (felt,
 * rail, plate, dealer chip, one `TilePool`), fed a synthetic `waiting`
 * state whose 136 tiles all sit in the four walls — so the step from
 * lobby to table is a camera move onto the same object, never a blank
 * screen. Nothing animates once the tiles have landed, so the loop idles
 * (0 renders/s) and the HUD's clicks stay snappy even on software GL.
 */
export interface LobbyTableBackdropProps {
  /**
   * Wide viewports with a left content column: pan the table into the
   * right half of the frame so the glass never straddles the plate.
   */
  side?: boolean | undefined;
}

/**
 * The table between hands: all 136 tiles in four full 17-stack walls and
 * nothing else — the real pre-deal state. Round-4 #4: dealing a rack per
 * filled seat left every wall a 10–11-stack run fronted by a 13-tile
 * rack (each rack overhung its wall by a tile) and showed dealt hands
 * before the opening roll. Pure + deterministic.
 */
export function waitingTableState(): GameState {
  return { ...emptyState(), wall: buildWall() };
}

/** Portrait lobby camera elevation: whole stacks, not slabs (round-4 #4). */
export const LOBBY_PORTRAIT_ELEV_DEG = 58;
/** Portrait lobby: margin the near rail's corners keep from the viewport sides, CSS px. */
const LOBBY_PORTRAIT_SIDE_PX = 8;
/** Wide lobby with a side column: the rail's outermost corner stays this far inside the right edge (the 24 px desktop safe area + a rounding margin). */
export const LOBBY_SIDE_SAFE_PX = 28;

/**
 * Portrait lobby camera: the whole table, rails included, fitted to the
 * width (the near rail's corners — the widest projected points from a
 * 58° camera — sit `LOBBY_PORTRAIT_SIDE_PX` inside the viewport) and
 * panned so the near rail's outer edge lands 10 px above the bottom. The
 * near wall then shows as a row of whole stacks (~15 CSS px a back) with
 * felt above it in the band under the Start / Leave row, instead of the
 * 45° view's 50 px slabs cropped by the rail (round-4 #4).
 */
export function lobbyPortraitCameraFor(width: number, height: number): CameraPreset {
  const corner: [number, number, number] = [FELT_HALF + RAIL_WIDTH, RAIL_H, FELT_HALF + RAIL_WIDTH];
  const anchor: [number, number, number] = [0, 0, FELT_HALF + RAIL_WIDTH];
  const anchorY = height - 10;
  const make = (xHalf: number) =>
    portraitCameraAnchored(width, height, xHalf, anchor, anchorY, LOBBY_PORTRAIT_ELEV_DEG);
  // A wider frame (larger xHalf) pulls the corner inward — monotonic.
  let lo = 11;
  let hi = 24;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (projectPreset(make(mid), width, height, corner).x > width - LOBBY_PORTRAIT_SIDE_PX)
      lo = mid;
    else hi = mid;
  }
  return make(hi);
}

/**
 * Low three-quarter view. Portrait: `lobbyPortraitCameraFor` — the whole
 * table fitted to the width, near rail at the bottom edge, so the band
 * under the Start / Leave row shows whole wall stacks and felt (round-2
 * #8 left a flat void there; round-4 #4 found 50 px slabs). Wide: the
 * whole table in frame; with a
 * side column (`side`) the table is panned right until its near-right
 * rail corner — the widest point of the low perspective — sits 24 px
 * inside the viewport, so the right and near rails frame it while the
 * left third tucks behind the glass column (round-3: the table used to
 * slide off the right edge while 110 px of void sat left of the
 * column). The dealer chip and dice are hidden in the waiting state
 * (`waiting` on `SyncInput`), so nothing crisp straddles the glass edge
 * on phones.
 */
export function lobbyCameraFor(width: number, height: number, side: boolean): CameraPreset {
  const aspect = width / Math.max(1, height);
  if (aspect < 0.9) return lobbyPortraitCameraFor(width, height);
  const fov = 40;
  if (!side) {
    return { position: [0, 14.5, 27], target: [0, 0, 1.5], fov };
  }
  // 30° elevation from 37.5 units — far enough that the near rail (the
  // widest projected edge) spans ~1180 px at 1440×900 and fits right of
  // the column — panned along x: camera and target move together so
  // the perspective is unchanged.
  const dist = 37.5;
  const elev = Math.PI / 6;
  const make = (shift: number): CameraPreset => ({
    position: [-shift, dist * Math.sin(elev), 1.5 + dist * Math.cos(elev)],
    target: [-shift, 0, 1.5],
    fov,
  });
  // The rail's near-right corner, bottom edge included: the 30° camera
  // looks down on it, so its base (y ≈ 0) projects a few px further out
  // than its top, and a top-only limit left the base ~15 px from the
  // edge against the 24 px desktop safe area (round-4 #7).
  const corner: [number, number, number] = [FELT_HALF + RAIL_WIDTH, 0, FELT_HALF + RAIL_WIDTH];
  const limit = width - LOBBY_SIDE_SAFE_PX;
  // Larger shift → table further right on screen (monotonic): bisect
  // for the largest shift that keeps the near-right corner inside.
  let lo = 0;
  let hi = 14;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (projectPreset(make(mid), width, height, corner).x <= limit) lo = mid;
    else hi = mid;
  }
  return make(lo);
}

export function LobbyTableBackdrop({ side = false }: LobbyTableBackdropProps) {
  const felt = useGame((s) => s.settings.felt);
  const tileBack = useGame((s) => s.settings.tileBack);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Mount the canvas after the glass lobby has painted and the main
  // thread is idle: the scene build (atlas, felt / wood canvases,
  // shader compiles, first frame) is a few hundred ms on a phone and
  // seconds on software GL, and it must never sit between the user and
  // the Start match button.
  const [mount, setMount] = useState(false);
  useEffect(() => {
    let idle: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const raf = requestAnimationFrame(() => {
      const ric = (
        globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
      ).requestIdleCallback;
      if (ric) idle = ric(() => setMount(true), { timeout: 600 });
      else timer = setTimeout(() => setMount(true), 120);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (idle !== null)
        (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idle);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  const state = useMemo(() => waitingTableState(), []);
  const stateRef = useRef(state);
  stateRef.current = state;
  const sceneRef = useRef<TableScene | null>(null);
  const initialCamera = useMemo(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const h = typeof window !== 'undefined' ? window.innerHeight : 900;
    return lobbyCameraFor(w, h, side);
  }, [side]);

  // Project the waiting state. `snap` lays the tiles out without motion
  // (the first frame of a fresh or rebuilt scene).
  const project = useCallback((scene: TableScene, snap: boolean, st = stateRef.current) => {
    scene.sync(
      {
        state: st,
        me: 0,
        sortMode: 'suit',
        manualOrder: [],
        drawnTileId: null,
        latestDiscardId: null,
        hintTileId: null,
        needsDraw: false,
        shuffling: false,
        heldHand: null,
        waiting: true,
        snap,
      },
      performance.now(),
    );
  }, []);

  const build = useCallback(
    (ctx: SceneContext): SceneHandle => {
      const scene = acquireTableScene(ctx, {
        felt: useGame.getState().settings.felt,
        tileBack: useGame.getState().settings.tileBack,
        reducedMotion: ctx.reducedMotion,
      });
      sceneRef.current = scene;
      ctx.rig.snap(lobbyCameraFor(ctx.size.width, ctx.size.height, side));
      ctx.rig.halfLife = ctx.reducedMotion ? 0.04 : 0.22;
      ctx.rig.parallaxStrength = 0.25;
      project(scene, true);
      return {
        update: (dt, now) => scene.update(dt, now),
        resize: (w, h) => ctx.rig.setPreset(lobbyCameraFor(w, h, side)),
        setQuality: (q) => scene.setQuality(q),
        dispose: () => {
          if (sceneRef.current === scene) sceneRef.current = null;
          releaseTableScene(ctx, scene);
        },
      };
    },
    [side, project],
  );
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) project(scene, false, state);
  }, [state, project]);

  if (failed || !mount) return null;
  return (
    <SceneHost
      build={build}
      initialCamera={initialCamera}
      transparent
      rebuildKey={`${felt}:${tileBack}:${side}`}
      poolKey={TABLE_POOL_KEY}
      onReady={() => setReady(true)}
      onFatal={() => setFailed(true)}
      testID="lobby-table-3d"
      style={{
        opacity: ready ? 1 : 0,
        transition: 'opacity 400ms ease-out',
        pointerEvents: 'none',
      }}
    />
  );
}
