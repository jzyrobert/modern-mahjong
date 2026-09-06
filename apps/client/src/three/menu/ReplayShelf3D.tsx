import { useCallback, useMemo } from 'react';
import { useGame } from '../../state/game';
import { type SceneContext, type SceneHandle, SceneHost } from '../core/SceneHost';
import { SHELF_CANVAS_ASPECT, buildShelfScene, shelfCamera } from './ShelfScene';

export interface ReplayShelf3DProps {
  /** Reference tile width in CSS px — sizes the canvas (~8.6 tiles wide). */
  tileWidth: number;
}

/**
 * 3D "empty shelf" for the replay library's empty state (`ShelfScene`).
 * A transparent canvas over the glass card, sized from `tileWidth` so
 * the seven tiles land at roughly that width on screen and the canvas
 * is tall enough (3.2 tile widths) for the leaning tiles plus their
 * contact shadow with air above and below. Web-only via
 * `src/three/entry`; the library keeps its flat art on classic / native.
 */
/**
 * Drawing-buffer scale for the shelf canvas. Two device px per CSS px
 * is crisp on phones (their own dpr is ≥ 2); a dpr-1 desktop display
 * gets 3× — the canvas is ~500 × 190 CSS px, so the buffer stays under
 * a megapixel while the leaning tiles' edges and the 東 南 西 strokes
 * stop stair-stepping (`antialias: true` is not honoured everywhere).
 */
export function shelfPixelRatio(deviceDpr = globalThis.devicePixelRatio ?? 1): number {
  return deviceDpr < 1.5 ? 3 : 2;
}

export function ReplayShelf3D({ tileWidth }: ReplayShelf3DProps) {
  const tileBack = useGame((s) => s.settings.tileBack);
  const build = useCallback(
    (ctx: SceneContext): SceneHandle => buildShelfScene(ctx, { tileBack }),
    [tileBack],
  );
  const width = Math.round(tileWidth * 8.6);
  const height = Math.round(width / SHELF_CANVAS_ASPECT);
  const dpr = useMemo(() => shelfPixelRatio(), []);
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
        maxDpr={dpr}
        minDpr={dpr}
        testID="replay-shelf-scene"
        style={{ pointerEvents: 'none' }}
      />
    </div>
  );
}
