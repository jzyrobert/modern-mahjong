import type { Tile as MTile } from '@mahjong/game-logic';
import { Animated, Dimensions, Pressable, View } from 'react-native';
import { useGame } from '../../state/game';
import { Tile } from '../Tile';
import { PULSE_TEMPO, usePulse } from '../animations';

const TILE_W = 64;
const TILE_H = 88;

interface MobileDrawCueProps {
  /** Next tile off the wall, rendered face-down inside the cue. When
   *  `null` the cue doesn't render — caller signals "not the user's
   *  draw turn" or "wall exhausted" by passing `null`. */
  tile: MTile | null;
  /** Fires `{ t: 'draw', seat }` on the engine. */
  onPress: () => void;
}

/**
 * Centre-of-felt draw cue for mobile shells. Renders a full-size face-
 * down tile with a pulsing gold halo at the same screen rect the
 * `DrawTileOverlay` popup uses — so when the user taps, the post-tap
 * flip + fly animation visually picks up where the cue was, without a
 * pop-in or position jump.
 *
 * Hides itself when `drawAnimation` is non-null. That's the handoff
 * trigger: the matching `flashDrawAnimation` from the wire router
 * unmounts the cue and mounts the overlay at the same coordinates,
 * sized identically (`TILE_W` here == `POPUP_TILE_WIDTH` over there).
 *
 * Desktop has its own wall-edge `WallEdge` pulse + click target; this
 * cue is mounted by `MobileShell` only, so it never reaches the
 * desktop layout.
 */
export function MobileDrawCue({ tile, onPress }: MobileDrawCueProps) {
  // Hide while `DrawTileOverlay` is in flight — the popup paints the
  // tile at the same screen position and takes over the visual cue.
  const animating = useGame((s) => s.drawAnimation !== null);
  // `usePulse` must run on every render to keep the hook order stable;
  // the halo it drives is cheap and `useNativeDriver: true` keeps the
  // JS thread free even when the cue isn't visible. The early-return
  // happens after the hook calls, never before them.
  const pulse = usePulse({ durationMs: PULSE_TEMPO.urgent });

  if (tile === null || animating) return null;

  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1.05, 1.35] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 0.35] });
  const radius = TILE_W * 0.18;

  // Same anchor the overlay uses — viewport centre on X, slightly
  // above-centre on Y so the fly-to-hand path is balanced once the
  // user taps. `Dimensions.get('window')` is fine to read at render
  // time on RN-Web (live viewport).
  const { width: viewportW, height: viewportH } = Dimensions.get('window');
  const cx = viewportW / 2;
  const cy = viewportH * 0.4;

  return (
    <View
      style={{
        position: 'absolute',
        top: cy - TILE_H / 2,
        left: cx - TILE_W / 2,
        width: TILE_W,
        height: TILE_H,
        // Sits above the felt + discard pool but below claim toasts /
        // modals. The draw popup uses `zIndex: 55`; the cue stays
        // below so when the popup mounts there's no momentary z-flip
        // — the overlay's stacking context takes over cleanly.
        zIndex: 50,
      }}
    >
      <Pressable
        onPress={onPress}
        testID="wall-draw-next"
        accessibilityLabel="Draw next tile"
        accessibilityRole="button"
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: TILE_W,
            height: TILE_H,
            borderRadius: radius,
            backgroundColor: '#dc9f4f',
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
            pointerEvents: 'none',
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: TILE_W,
            height: TILE_H,
            borderRadius: radius,
            borderWidth: 3,
            borderColor: '#f3c54a',
            pointerEvents: 'none',
            boxShadow: '0px 0px 8px rgba(243,197,74,0.85)',
          }}
        />
        <Tile tile={tile} faceDown width={TILE_W} height={TILE_H} />
      </Pressable>
    </View>
  );
}
