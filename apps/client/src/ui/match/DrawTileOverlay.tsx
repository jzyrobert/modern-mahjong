import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useGame } from '../../state/game';
import { Tile } from '../Tile';

const POP_MS = 160;
const HOLD_MS = 220;
const FLIP_MS = 420;
const FLY_MS = 320;

const POPUP_TILE_WIDTH = 64;
const POPUP_TILE_HEIGHT = 88;

/**
 * Centre-of-felt popup that plays when the local user draws a tile.
 *
 * Phases (driven by a single `Animated.sequence`):
 *   1. Pop-in: scale 0 → 1 over POP_MS.
 *   2. Hold face-down for HOLD_MS so the player registers the popup.
 *   3. Flip: scaleX 1 → 0 → 1 over FLIP_MS, with a `faceDown` swap at
 *      the scaleX-zero midpoint. We use a scaleX squish instead of
 *      RN-Web's `rotateY` + `backfaceVisibility` because that combo
 *      doesn't render reliably without a 3D perspective ancestor —
 *      the squash reads as a flip and avoids the styling rabbit-hole.
 *   4. Fly: translateY downward toward the hand row + fade to 0 over
 *      FLY_MS. The hand has already painted the drawn tile in its
 *      sort position (engine state arrived in the same `delta`),
 *      typically with `HandTile`'s gold-glow highlight on the new
 *      tile, so the fade lands visually "on" the tile in the hand.
 *
 * When the sequence finishes we clear `useGame.drawAnimation`. Each
 * fresh `flashDrawAnimation` bumps the store's `seq`, so a back-to-
 * back draw (e.g. a self-draw immediately after a chi window closes)
 * restarts the sequence cleanly.
 */
export function DrawTileOverlay() {
  const animation = useGame((s) => s.drawAnimation);
  const clear = useGame((s) => s.clearDrawAnimation);
  const animsEnabled = useGame((s) => s.settings.animations);
  const lastSeq = useRef(0);
  const [visible, setVisible] = useState(false);
  const [faceUp, setFaceUp] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animation) return;
    if (animation.seq === lastSeq.current) return;
    lastSeq.current = animation.seq;
    if (!animsEnabled) {
      clear();
      return;
    }
    setVisible(true);
    setFaceUp(false);
    progress.setValue(0);
    // Swap face-down → face-up at the scaleX-zero midpoint, where the
    // tile is edge-on and the swap is invisible.
    const flipMidMs = POP_MS + HOLD_MS + FLIP_MS / 2;
    const flipTimer = setTimeout(() => setFaceUp(true), flipMidMs);
    Animated.timing(progress, {
      toValue: 1,
      duration: POP_MS + HOLD_MS + FLIP_MS + FLY_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => {
      clearTimeout(flipTimer);
      if (!finished) return;
      setVisible(false);
      clear();
    });
    return () => clearTimeout(flipTimer);
  }, [animation, animsEnabled, clear, progress]);

  if (!visible || !animation) return null;

  const total = POP_MS + HOLD_MS + FLIP_MS + FLY_MS;
  const popEnd = POP_MS / total;
  const holdEnd = (POP_MS + HOLD_MS) / total;
  const flipMid = (POP_MS + HOLD_MS + FLIP_MS / 2) / total;
  const flipEnd = (POP_MS + HOLD_MS + FLIP_MS) / total;

  const scale = progress.interpolate({
    inputRange: [0, popEnd, flipEnd, 1],
    outputRange: [0.4, 1, 1, 0.7],
  });
  const overlayOpacity = progress.interpolate({
    inputRange: [0, popEnd, flipEnd, 1],
    outputRange: [0, 1, 1, 0],
  });
  const translateY = progress.interpolate({
    inputRange: [0, flipEnd, 1],
    outputRange: [0, 0, 80],
  });
  // scaleX squish during the flip — 1 → 0 across the first half, then
  // 0 → 1 across the second half. Outside the flip phase scaleX is 1.
  const scaleX = progress.interpolate({
    inputRange: [0, holdEnd, flipMid, flipEnd, 1],
    outputRange: [1, 1, 0, 1, 1],
  });

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: '32%',
        alignItems: 'center',
        zIndex: 55,
      }}
    >
      <Animated.View
        style={{
          width: POPUP_TILE_WIDTH,
          height: POPUP_TILE_HEIGHT,
          opacity: overlayOpacity,
          transform: [{ translateY }, { scale }, { scaleX }],
          boxShadow: '0px 10px 24px rgba(0,0,0,0.35)',
        }}
      >
        <Tile
          tile={animation.tile}
          faceDown={!faceUp}
          width={POPUP_TILE_WIDTH}
          height={POPUP_TILE_HEIGHT}
        />
      </Animated.View>
    </View>
  );
}
