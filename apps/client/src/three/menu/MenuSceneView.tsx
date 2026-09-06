import { useCallback, useMemo, useState } from 'react';
import { useGame } from '../../state/game';
import { getHeroBand } from '../../ui/menu/heroBand';
import { type SceneContext, type SceneHandle, SceneHost } from '../core/SceneHost';
import { buildDriftScene } from './DriftScene';
import { buildHeroScene, heroFrame, heroView } from './HeroScene';
import { menuLayout } from './layout';

/**
 * The menu's two canvases, each mounted through `SceneHost` and loaded
 * lazily (`Menu3DBackdrop` / `Menu3DHero`) so the lobby's first paint
 * is DOM text; each canvas fades in over 400 ms once its first frame
 * has rendered.
 *
 * - `MenuSceneView` — the drift field, in the fixed full-viewport
 *   backdrop behind the page (`LobbyBackdrop`).
 * - `HeroSceneView` — the rack + dice, inside the lobby's hero band
 *   (`HeroBandSlot`), i.e. ScrollView content: it scrolls with the
 *   title natively, on the compositor, with no scroll listener.
 */
const fadeStyle = (ready: boolean) => ({
  opacity: ready ? 1 : 0,
  transition: 'opacity 400ms ease-out',
  pointerEvents: 'none' as const,
});

export function MenuSceneView() {
  const tileBack = useGame((s) => s.settings.tileBack);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const initialCamera = useMemo(() => {
    const f = heroFrame();
    // Fit to the band the lobby has already measured (the scene loads
    // after first paint) so the intro starts on the final framing.
    return menuLayout(f.width / f.height, { width: f.width, height: f.height, band: getHeroBand() })
      .camera;
  }, []);

  const build = useCallback(
    (ctx: SceneContext): SceneHandle => buildDriftScene(ctx, { tileBack }),
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
      style={fadeStyle(ready)}
    />
  );
}

export function HeroSceneView() {
  const tileBack = useGame((s) => s.settings.tileBack);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const initialCamera = useMemo(() => {
    const f = heroFrame();
    const band = getHeroBand();
    return menuLayout(f.width / f.height, heroView(f, band?.w ?? 0, band?.h ?? 0)).camera;
  }, []);

  const build = useCallback(
    (ctx: SceneContext): SceneHandle => buildHeroScene(ctx, { tileBack }),
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
      testID="menu-3d-hero"
      style={fadeStyle(ready)}
    />
  );
}
