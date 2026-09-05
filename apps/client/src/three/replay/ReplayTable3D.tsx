import type { GameState, Seat } from '@mahjong/game-logic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGame } from '../../state/game';
import { type SceneContext, type SceneHandle, SceneHost } from '../core/SceneHost';
import {
  TABLE_POOL_KEY,
  type TableDebugSnapshot,
  type TableScene,
  acquireTableScene,
  releaseTableScene,
} from '../table/TableScene';
import { classifyViewport } from '../table/cameraPresets';
import type { HeldHandFrame } from '../table/layout';
import { replayCameraFor, replayHeldFrameFor, replaySyncTuning } from './layout';

/**
 * Read-only 3D table for the replay player: the match's `TableScene`
 * (felt, rail, walls, plate, one `TilePool`) fed a recorded `GameState`
 * — `frames[cursor].state` — with the point-of-view seat as the camera
 * seat. No hit targets, no store subscription: the parent passes the
 * frame and the scene diffs it against the previous one, so a cursor
 * step springs each moved tile (a draw slides from the wall, a discard
 * drops into the river, a claim folds a meld) exactly as the live table
 * does, and a chapter jump re-deals. Under reduced motion every frame
 * snaps. Same camera preset per viewport class as the match, same held
 * portrait hand, same side-seat tuning (`./layout`).
 *
 * Web-only (`src/three/entry.tsx` exports `null` on native).
 */
export interface ReplayTable3DProps {
  state: GameState;
  /** Seat the camera sits behind — its hand faces the viewer. */
  me: Seat;
  /** Lay every hand face-up (the "all seats" point of view). */
  revealAll: boolean;
  /** Tile the POV seat has just drawn this frame, if any (gap + glow). */
  drawnTileId: number | null;
  /** Newest discard on the table (the gold cue). */
  latestDiscardId: number | null;
  /** Device safe-area inset at the top (portrait chrome offset). */
  topInset: number;
  onReady?: (() => void) | undefined;
  onFatal?: ((reason: string) => void) | undefined;
}

/** Portrait phones ≤ this width render at DPR 2 on every tier (crisp river glyphs). */
const PORTRAIT_SHARP_MAX_WIDTH = 420;

/**
 * Debug seam payload: the table's live poses plus what the most recent
 * `sync` did — whether it snapped (reduced motion / first layout) and how
 * many tiles it put in flight — so a spec can assert "a step springs"
 * or "a step snaps" without racing the tweens.
 */
export interface ReplayDebugSnapshot extends TableDebugSnapshot {
  lastSync: { snapped: boolean; flights: number } | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_REPLAY_3D_DEBUG__: (() => ReplayDebugSnapshot | null) | undefined;
}

export function ReplayTable3D(props: ReplayTable3DProps) {
  const felt = useGame((s) => s.settings.felt);
  const tileBack = useGame((s) => s.settings.tileBack);
  const inputRef = useRef(props);
  inputRef.current = props;
  const sceneRef = useRef<TableScene | null>(null);
  const ctxRef = useRef<SceneContext | null>(null);
  const heldRef = useRef<HeldHandFrame | null>(null);
  const lastSyncRef = useRef<ReplayDebugSnapshot['lastSync']>(null);

  // Project the current frame. `snap` lays the tiles out without motion
  // (first layout of a fresh or re-attached scene, and every layout
  // under reduced motion — the tweens the choreographer keeps at 120 ms
  // there would still read as movement on a scrub).
  const sync = useCallback((snap: boolean) => {
    const scene = sceneRef.current;
    const ctx = ctxRef.current;
    if (!scene || !ctx) return;
    const p = inputRef.current;
    const cls = classifyViewport(ctx.size.width, ctx.size.height);
    const snapped = snap || ctx.reducedMotion;
    const now = performance.now();
    scene.sync(
      {
        state: p.state,
        me: p.me,
        sortMode: 'suit',
        manualOrder: [],
        drawnTileId: p.drawnTileId,
        latestDiscardId: p.latestDiscardId,
        hintTileId: null,
        needsDraw: false,
        shuffling: false,
        heldHand: heldRef.current,
        snap: snapped,
        revealAll: p.revealAll,
        ...replaySyncTuning(cls, heldRef.current !== null),
      },
      now,
    );
    lastSyncRef.current = { snapped, flights: scene.debugSnapshot(now).flights };
  }, []);

  const build = useCallback(
    (ctx: SceneContext): SceneHandle => {
      ctxRef.current = ctx;
      const scene = acquireTableScene(ctx, {
        felt: useGame.getState().settings.felt,
        tileBack: useGame.getState().settings.tileBack,
        reducedMotion: ctx.reducedMotion,
      });
      sceneRef.current = scene;
      const inset = inputRef.current.topInset;
      ctx.rig.snap(replayCameraFor(ctx.size.width, ctx.size.height, inset));
      ctx.rig.halfLife = ctx.reducedMotion ? 0.04 : 0.24;
      ctx.rig.parallaxStrength = 0.45;
      heldRef.current = replayHeldFrameFor(ctx.size.width, ctx.size.height, inset);
      sync(true);
      return {
        update: (dt, now) => scene.update(dt, now),
        resize: (w, h) => {
          const ti = inputRef.current.topInset;
          ctx.rig.setPreset(replayCameraFor(w, h, ti));
          heldRef.current = replayHeldFrameFor(w, h, ti);
          sync(false);
        },
        setQuality: (q) => scene.setQuality(q),
        dispose: () => {
          releaseTableScene(ctx, scene);
          if (sceneRef.current === scene) sceneRef.current = null;
          if (ctxRef.current === ctx) ctxRef.current = null;
        },
      };
    },
    [sync],
  );

  // Frame / point-of-view changes: re-project (the deps are what `sync`
  // reads through `inputRef`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: inputs are read via inputRef
  useEffect(() => {
    sync(false);
  }, [sync, props.state, props.me, props.revealAll, props.drawnTileId, props.latestDiscardId]);

  useEffect(() => {
    sceneRef.current?.setSkins(felt, tileBack);
  }, [felt, tileBack]);

  // Test / verifier seam: live tile poses + in-flight count (the specs
  // wait for `flights === 0` before reading the table).
  useEffect(() => {
    globalThis.__MAHJONG_REPLAY_3D_DEBUG__ = () => {
      const snap = sceneRef.current?.debugSnapshot(performance.now());
      return snap ? { ...snap, lastSync: lastSyncRef.current } : null;
    };
    return () => {
      globalThis.__MAHJONG_REPLAY_3D_DEBUG__ = undefined;
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ctx = ctxRef.current;
    if (!ctx || e.pointerType === 'touch') return;
    const nx = (e.clientX / Math.max(1, ctx.size.width)) * 2 - 1;
    const ny = (e.clientY / Math.max(1, ctx.size.height)) * 2 - 1;
    ctx.rig.setPointer(nx, -ny);
  }, []);
  const onPointerLeave = useCallback(() => ctxRef.current?.rig.setPointer(0, 0), []);

  // First-mount preset only; `resize` re-derives it from the real size.
  const [initialCamera] = useState(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const h = typeof window !== 'undefined' ? window.innerHeight : 900;
    return replayCameraFor(w, h, inputRef.current.topInset);
  });
  const portraitSharp =
    typeof window !== 'undefined' &&
    classifyViewport(window.innerWidth, window.innerHeight) === 'phone-portrait' &&
    window.innerWidth <= PORTRAIT_SHARP_MAX_WIDTH;

  return (
    <div
      data-testid="replay-table-3d"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      <SceneHost
        build={build}
        initialCamera={initialCamera}
        transparent
        rebuildKey={`${felt}:${tileBack}`}
        // Same pool as the match / waiting table: a replay opened after
        // a match re-attaches the compiled renderer + parked scene.
        poolKey={TABLE_POOL_KEY}
        testID="replay-table-3d-scene"
        {...(props.onReady ? { onReady: props.onReady } : {})}
        {...(props.onFatal ? { onFatal: props.onFatal } : {})}
        {...(portraitSharp ? { maxDpr: 2 } : {})}
      />
    </div>
  );
}
