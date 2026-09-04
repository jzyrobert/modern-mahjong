import { type GameState, type Seat, buildWall, emptyState } from '@mahjong/game-logic';
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
import { projectPreset } from '../cameraPresets';
import { DEAD_TILES, FELT_HALF, RAIL_H, RAIL_WIDTH } from '../layout';

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
  /**
   * Seats that have a player or a bot in them. Each filled seat gets a
   * concealed 13-tile rack in front of it (dealt from the wall, backs
   * out), so the waiting table fills up as the room does and the empty
   * seats read as empty.
   */
  filled?: readonly boolean[] | undefined;
}

/** Tiles per rack on the waiting table (a dealt hand, before the dealer's 14th). */
const WAITING_RACK = 13;

/**
 * The table between hands: full walls, plus a concealed rack for every
 * filled seat, dealt from the wall the way the real deal will be (so
 * the walls show the matching gaps). Pure + deterministic.
 */
export function waitingTableState(filled: readonly boolean[] = []): GameState {
  const tiles = buildWall();
  const state = emptyState();
  const wall = tiles.slice(DEAD_TILES);
  const hands = { ...state.hands };
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    if (!filled[seat]) continue;
    // Pop from the end, as the engine deals.
    hands[seat] = wall.splice(wall.length - WAITING_RACK, WAITING_RACK);
  }
  return { ...state, deadWall: tiles.slice(0, DEAD_TILES), wall, hands };
}

/**
 * Low three-quarter view. Portrait: the table fills the width and is
 * panned so its *near* rail and near wall fill the band under the
 * Start / Leave row (round-2 #8: a flat void sat there while the far
 * half hid behind the panels). Wide: the whole table in frame; with a
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
  if (aspect < 0.9) {
    return { position: [0, 21, 21], target: [0, 0, -1], fov: 46 };
  }
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
  const corner: [number, number, number] = [FELT_HALF + RAIL_WIDTH, RAIL_H, FELT_HALF + RAIL_WIDTH];
  const limit = width - 24;
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

export function LobbyTableBackdrop({ side = false, filled }: LobbyTableBackdropProps) {
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
  const filledKey = (filled ?? []).map((f) => (f ? '1' : '0')).join('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: filledKey is the stable projection of `filled`
  const state = useMemo(
    () => waitingTableState(filledKey.split('').map((c) => c === '1')),
    [filledKey],
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const sceneRef = useRef<TableScene | null>(null);
  const initialCamera = useMemo(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const h = typeof window !== 'undefined' ? window.innerHeight : 900;
    return lobbyCameraFor(w, h, side);
  }, [side]);

  // Project the waiting state. `snap` lays the tiles out without motion
  // (the first frame of a fresh or rebuilt scene); a later seat change
  // flies the rack's tiles between the wall and the seat, so the room
  // visibly fills up.
  const project = useCallback((scene: TableScene, snap: boolean) => {
    scene.sync(
      {
        state: stateRef.current,
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
        concealOwn: true,
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
    if (scene) project(scene, false);
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
