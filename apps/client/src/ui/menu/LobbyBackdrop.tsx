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
}

/**
 * Full-bleed backdrop behind the lobby / replay content: the parlour
 * void (vertical gradient + a soft warm radial glow behind the focal
 * object), then either the lazily-loaded 3D hero or the classic
 * scattered tile-backs. Pointer-transparent so every DOM hit target
 * stays clickable.
 */
export function LobbyBackdrop({ scene = true }: LobbyBackdropProps) {
  const rendererSetting = useGame((s) => s.settings.renderer);
  const use3d = scene && Menu3DBackdrop !== null && resolveRenderer(rendererSetting) === '3d';
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
            backgroundImage:
              'radial-gradient(ellipse 62% 34% at 50% 30%, rgba(58,74,58,0.55) 0%, rgba(58,74,58,0.18) 45%, rgba(58,74,58,0) 100%), radial-gradient(ellipse 40% 22% at 50% 32%, rgba(216,168,90,0.07) 0%, rgba(216,168,90,0) 100%)',
          }),
        }}
      />
      {Platform.OS !== 'web' ? (
        <View
          style={{
            position: 'absolute',
            left: '15%',
            right: '15%',
            top: '14%',
            height: 260,
            borderRadius: 999,
            backgroundColor: 'rgba(58,74,58,0.25)',
          }}
        />
      ) : null}
      {use3d && Menu3DBackdrop ? <Menu3DBackdrop /> : <ScatteredTiles fan={scene} />}
    </View>
  );
}
