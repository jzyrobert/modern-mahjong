import { useEffect } from 'react';
import { useGame } from '../../state/game';
import { useActiveTutorialStep } from '../../state/tutorial';
import { resolveRenderer } from '../renderer';
import { clearSpotlightTiles, setSpotlightTiles, tilesForTarget } from './targets';

/**
 * World-space tutorial accent for the 3D table. Mount it anywhere
 * inside the 3D shell's React tree (it renders nothing): while a lesson
 * step is active it publishes the tile ids that step is about through
 * `targets.ts`, and a scene that owns a `Spotlight` (see `Spotlight.ts`)
 * raises `pose.highlight` on them in its update loop.
 *
 * The DOM coach-marks (`ui/tutorial/TutorialOverlay`) keep working
 * without this component — it is purely the "glow the actual tiles"
 * layer. `TutorialOverlay` mounts it (through `three/entry`) while a
 * step is active; it publishes nothing under the classic renderer,
 * where there is no scene to glow.
 */
export function Tutorial3D() {
  const active = useActiveTutorialStep();
  const targetId = active?.step.targetId;
  const state = useGame((s) => s.state);
  const you = useGame((s) => s.you);
  const is3d = resolveRenderer(useGame((s) => s.settings.renderer)) === '3d';
  // Lessons always seat the user at 0; spectators / pre-join fall back
  // to the same seat so the mapping still resolves.
  const seat = typeof you === 'number' ? you : 0;

  useEffect(() => {
    setSpotlightTiles(is3d ? tilesForTarget(targetId, state, seat) : []);
  }, [targetId, state, seat, is3d]);

  useEffect(() => () => clearSpotlightTiles(), []);

  return null;
}
