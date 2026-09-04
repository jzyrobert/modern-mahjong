import { Platform, View } from 'react-native';
import { useGame } from '../../state/game';
import { Menu3DBackdrop } from '../../three/entry';
import { resolveRenderer } from '../../three/renderer';
import { ScatteredTiles } from './ScatteredTiles';
import { MENU, webStyle } from './theme';

interface LobbyBackdropProps {
  /** Mount the Three.js hero when the renderer resolves to `'3d'`.
   *  The replay library passes `false` — same void, no scene. */
  scene?: boolean;
  /** Classic tile-backs in the void (default on). The empty replay
   *  library turns them off — its shelf illustration is the focal
   *  object there. */
  backs?: boolean;
  /** Centre of the warm radial glow, as viewport fractions. Defaults
   *  to the hero band; the replay library aims it at its centred card. */
  glow?: { x: number; y: number } | undefined;
}

/**
 * Full-bleed backdrop behind the lobby / replay content: the parlour
 * void (vertical gradient + a soft warm radial glow behind the focal
 * object), then either the lazily-loaded 3D hero or the classic
 * scattered tile-backs. Pointer-transparent so every DOM hit target
 * stays clickable.
 */
export function LobbyBackdrop({
  scene = true,
  backs = true,
  glow = { x: 0.5, y: 0.3 },
}: LobbyBackdropProps) {
  const rendererSetting = useGame((s) => s.settings.renderer);
  const use3d = scene && Menu3DBackdrop !== null && resolveRenderer(rendererSetting) === '3d';
  const gx = `${Math.round(glow.x * 100)}%`;
  const gy = `${Math.round(glow.y * 100)}%`;
  return (
    <View
      pointerEvents="none"
      testID={use3d ? 'lobby-backdrop-3d' : 'lobby-backdrop-classic'}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
    >
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: MENU.voidMid,
          ...webStyle({
            backgroundImage: `linear-gradient(180deg, ${MENU.void0} 0%, ${MENU.void1} 100%)`,
          }),
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          ...webStyle({
            backgroundImage: `radial-gradient(ellipse 62% 34% at ${gx} ${gy}, rgba(58,74,58,0.55) 0%, rgba(58,74,58,0.18) 45%, rgba(58,74,58,0) 100%), radial-gradient(ellipse 40% 22% at ${gx} ${gy}, rgba(216,168,90,0.07) 0%, rgba(216,168,90,0) 100%)`,
          }),
        }}
      />
      {Platform.OS !== 'web' ? (
        <View
          style={{
            position: 'absolute',
            left: '15%',
            right: '15%',
            top: `${Math.round(glow.y * 100) - 16}%`,
            height: 260,
            borderRadius: 999,
            backgroundColor: 'rgba(58,74,58,0.25)',
          }}
        />
      ) : null}
      {use3d && Menu3DBackdrop ? (
        <Menu3DBackdrop />
      ) : backs || scene ? (
        <ScatteredTiles fan={scene} />
      ) : null}
    </View>
  );
}
