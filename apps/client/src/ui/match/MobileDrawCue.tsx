import type { Tile as MTile } from '@mahjong/game-logic';
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Pressable, View } from 'react-native';
import { useGame } from '../../state/game';
import { TILE_CORNER_RADIUS_RATIO, Tile } from '../Tile';
import { PULSE_TEMPO, usePulse } from '../animations';
import { DRAW_ANCHOR_Y_RATIO } from './DrawTileOverlay';

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
  const visible = tile !== null && !animating;
  // Gate the halo on visibility. Without the `enabled` toggle the
  // underlying `Animated.loop` kept its native node attached across
  // the cue's mount/unmount cycles, but react-native-web doesn't re-
  // subscribe a freshly-mounted `Animated.View` to an already-running
  // loop — the new view read the value's frozen-at-detach number
  // forever, so the halo only pulsed on the *first* draw of the
  // session and held still on every subsequent one. Toggling
  // `enabled` makes `usePulse`'s effect tear down the loop on hide
  // and start a fresh one on show.
  const pulse = usePulse({ enabled: visible, durationMs: PULSE_TEMPO.urgent });

  // Latch the tap so a fast double-tap during the engine round-trip
  // (between the user's first tap and the `drawAnimation` becoming
  // non-null) doesn't submit a second `draw` action — solo's engine
  // would reject it with a PHASE error and other transports vary.
  // The cue is unmounted (`!visible`) once the round-trip lands, so
  // the local ref is reset by the effect below whenever the cue
  // becomes visible again for the next user turn.
  const tapInFlight = useRef(false);
  useEffect(() => {
    if (visible) tapInFlight.current = false;
  }, [visible]);

  if (!visible) return null;

  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1.05, 1.35] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 0.35] });
  const radius = TILE_W * TILE_CORNER_RADIUS_RATIO;

  // Same anchor the overlay uses — viewport centre on X, in the
  // bottom-third thumb zone on Y (`DRAW_ANCHOR_Y_RATIO`). Both
  // components reference the same constant so a tap doesn't snap
  // between two cy values. `Dimensions.get('window')` is fine to read
  // at render time on RN-Web (live viewport).
  const { width: viewportW, height: viewportH } = Dimensions.get('window');
  const cx = viewportW / 2;
  const cy = viewportH * DRAW_ANCHOR_Y_RATIO;

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
        onPress={() => {
          if (tapInFlight.current) return;
          tapInFlight.current = true;
          onPress();
        }}
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
