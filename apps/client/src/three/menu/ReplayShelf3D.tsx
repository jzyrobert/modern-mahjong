import { useCallback } from 'react';
import { useGame } from '../../state/game';
import { type SceneContext, type SceneHandle, SceneHost } from '../core/SceneHost';
import { buildShelfScene, shelfCamera } from './ShelfScene';

export interface ReplayShelf3DProps {
  /** Reference tile width in CSS px — sizes the canvas (9 tiles wide). */
  tileWidth: number;
}

/**
 * 3D "empty shelf" for the replay library's empty state (`ShelfScene`).
 * A transparent canvas over the glass card, sized from `tileWidth` so
 * the seven tiles land at roughly that width on screen. Web-only via
 * `src/three/entry`; the library keeps its flat art on classic / native.
 */
export function ReplayShelf3D({ tileWidth }: ReplayShelf3DProps) {
  const tileBack = useGame((s) => s.settings.tileBack);
  const build = useCallback(
    (ctx: SceneContext): SceneHandle => buildShelfScene(ctx, { tileBack }),
    [tileBack],
  );
  const width = Math.round(tileWidth * 9.2);
  const height = Math.round(tileWidth * 2.1);
  return (
    <div
      data-testid="replay-shelf-3d"
      style={{ position: 'relative', width: '100%', maxWidth: width, height, marginBottom: 2 }}
    >
      <SceneHost
        build={build}
        initialCamera={shelfCamera(width / height)}
        transparent
        releaseContextOnUnmount
        rebuildKey={tileBack}
        maxDpr={2}
        minDpr={2}
        testID="replay-shelf-scene"
        style={{ pointerEvents: 'none' }}
      />
    </div>
  );
}
