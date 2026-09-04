import { type GameState, buildWall, emptyState } from '@mahjong/game-logic';
import { useCallback, useMemo, useState } from 'react';
import { useGame } from '../../../state/game';
import { type SceneContext, type SceneHandle, SceneHost } from '../../core/SceneHost';
import type { CameraPreset } from '../../core/camera';
import { TableScene } from '../TableScene';
import { DEAD_TILES } from '../layout';

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

/** Full walls, no hands: the table between hands. Pure + deterministic. */
export function waitingTableState(): GameState {
  const tiles = buildWall();
  const state = emptyState();
  return { ...state, deadWall: tiles.slice(0, DEAD_TILES), wall: tiles.slice(DEAD_TILES) };
}

/**
 * Low three-quarter view. `shiftX` pans the table toward +x on screen
 * (both camera and target move by −shiftX so perspective is unchanged).
 */
export function lobbyCameraFor(width: number, height: number, side: boolean): CameraPreset {
  const aspect = width / Math.max(1, height);
  const shift = side ? -7.5 : 0;
  if (aspect < 0.9) {
    // Portrait: the table fills the width, its far half under the header.
    return { position: [0, 21, 24], target: [0, 0, 2], fov: 46 };
  }
  return { position: [shift, 14.5, 27], target: [shift, 0, 1.5], fov: 40 };
}

export function LobbyTableBackdrop({ side = false }: LobbyTableBackdropProps) {
  const felt = useGame((s) => s.settings.felt);
  const tileBack = useGame((s) => s.settings.tileBack);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const state = useMemo(() => waitingTableState(), []);
  const initialCamera = useMemo(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const h = typeof window !== 'undefined' ? window.innerHeight : 900;
    return lobbyCameraFor(w, h, side);
  }, [side]);

  const build = useCallback(
    (ctx: SceneContext): SceneHandle => {
      const scene = new TableScene(ctx, {
        felt: useGame.getState().settings.felt,
        tileBack: useGame.getState().settings.tileBack,
        reducedMotion: ctx.reducedMotion,
      });
      ctx.rig.snap(lobbyCameraFor(ctx.size.width, ctx.size.height, side));
      ctx.rig.parallaxStrength = 0.25;
      const sync = () =>
        scene.sync(
          {
            state,
            me: 0,
            sortMode: 'suit',
            manualOrder: [],
            drawnTileId: null,
            latestDiscardId: null,
            hintTileId: null,
            needsDraw: false,
            shuffling: false,
            heldHand: null,
          },
          performance.now(),
        );
      sync();
      return {
        update: (dt, now) => scene.update(dt, now),
        resize: (w, h) => ctx.rig.setPreset(lobbyCameraFor(w, h, side)),
        setQuality: (q) => scene.setQuality(q),
        dispose: () => scene.dispose(),
      };
    },
    [state, side],
  );

  if (failed) return null;
  return (
    <SceneHost
      build={build}
      initialCamera={initialCamera}
      transparent
      rebuildKey={`${felt}:${tileBack}:${side}`}
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
