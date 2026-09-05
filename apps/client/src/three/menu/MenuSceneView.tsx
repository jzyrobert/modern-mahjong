import { useCallback, useMemo, useState } from 'react';
import { useGame } from '../../state/game';
import { getHeroBand } from '../../ui/menu/heroBand';
import { type SceneContext, type SceneHandle, SceneHost } from '../core/SceneHost';
import { buildMenuScene } from './MenuScene';
import { menuLayout } from './layout';

/**
 * Mounts the menu backdrop scene through `SceneHost`. Loaded lazily by
 * `Menu3DBackdrop` so the lobby's first paint is DOM text; the canvas
 * fades in over 400 ms once the first frame has rendered.
 */
export function MenuSceneView() {
  const tileBack = useGame((s) => s.settings.tileBack);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const initialCamera = useMemo(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const h = typeof window !== 'undefined' ? window.innerHeight : 900;
    // Fit to the band the lobby has already measured (the scene loads
    // after first paint) so the intro starts on the final framing.
    return menuLayout(w / Math.max(1, h), { width: w, height: h, band: getHeroBand() }).camera;
  }, []);

  const build = useCallback(
    (ctx: SceneContext): SceneHandle => buildMenuScene(ctx, { tileBack }),
    [tileBack],
  );

  if (failed) return null;
  return (
    <SceneHost
      build={build}
      initialCamera={initialCamera}
      transparent
      rebuildKey={tileBack}
      onReady={() => setReady(true)}
      onFatal={() => setFailed(true)}
      testID="menu-3d"
      style={{
        opacity: ready ? 1 : 0,
        transition: 'opacity 400ms ease-out',
        pointerEvents: 'none',
      }}
    />
  );
}
