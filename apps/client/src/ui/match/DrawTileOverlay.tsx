import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, View } from 'react-native';
import { useGame } from '../../state/game';
import { Tile } from '../Tile';

const POP_MS = 160;
const HOLD_MS = 220;
const FLIP_MS = 420;
const FLY_MS = 360;

const POPUP_TILE_WIDTH = 64;
const POPUP_TILE_HEIGHT = 88;

/**
 * Centre-of-felt popup that plays when the local user draws a tile.
 *
 * Phases (driven by a single `Animated.timing` over `progress`):
 *   1. Pop-in: scale 0.4 → 1 over POP_MS.
 *   2. Hold face-down for HOLD_MS so the player registers the popup.
 *   3. Flip: scaleX 1 → 0 → 1 over FLIP_MS, with a `faceDown` swap at
 *      the scaleX-zero midpoint. We use a scaleX squish instead of
 *      RN-Web's `rotateY` + `backfaceVisibility` because that combo
 *      doesn't render reliably without a 3D perspective ancestor —
 *      the squash reads as a flip and avoids the styling rabbit-hole.
 *   4. Fly: translate + scale to the exact destination slot rect that
 *      the matching `HandTile` wrote into `drawAnimationSlotRect` via
 *      `measureInWindow`. The slot is rendered with `opacity: 0`
 *      while this overlay is alive, so the fly phase visually "is"
 *      the tile arriving — when the overlay clears, the slot fades
 *      back to opacity 1 in the same screen position.
 *
 * Each fresh `flashDrawAnimation` bumps the store's `seq`, so a back-
 * to-back draw (e.g. a self-draw immediately after a chi window
 * closes) restarts the sequence cleanly.
 */
export function DrawTileOverlay() {
  const animation = useGame((s) => s.drawAnimation);
  const slotRect = useGame((s) => s.drawAnimationSlotRect);
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

  // Viewport dimensions for the popup's initial centre-of-screen
  // anchor. `Dimensions.get('window')` on RN-Web reads the live inner
  // viewport, so resizing across the animation window is fine — we
  // only read it once on render.
  const { width: viewportW, height: viewportH } = Dimensions.get('window');
  const popupCenterX = viewportW / 2;
  // Popup floats roughly above the middle of the felt. Slightly
  // above-centre reads better than dead-centre because the hand sits
  // at the bottom — keeps the fly distance balanced.
  const popupCenterY = viewportH * 0.4;

  // Fly target = the slot's centre in viewport coords. If the slot
  // hasn't measured yet (race with the first render after the draw
  // event), fall back to a fixed offset downward.
  const targetCenterX = slotRect ? slotRect.x + slotRect.width / 2 : popupCenterX;
  const targetCenterY = slotRect ? slotRect.y + slotRect.height / 2 : popupCenterY + 200;
  const targetScale = slotRect ? slotRect.width / POPUP_TILE_WIDTH : 0.45;

  const total = POP_MS + HOLD_MS + FLIP_MS + FLY_MS;
  const popEnd = POP_MS / total;
  const holdEnd = (POP_MS + HOLD_MS) / total;
  const flipMid = (POP_MS + HOLD_MS + FLIP_MS / 2) / total;
  const flipEnd = (POP_MS + HOLD_MS + FLIP_MS) / total;

  // Pop-in scale (felt-centre) into 1 → fly into the slot's scale.
  const scale = progress.interpolate({
    inputRange: [0, popEnd, flipEnd, 1],
    outputRange: [0.4, 1, 1, targetScale],
  });
  // Stay opaque until the very last bit of the fly so the hand-side
  // opacity reveal cross-fades cleanly with the landing.
  const overlayOpacity = progress.interpolate({
    inputRange: [0, popEnd, flipEnd, 0.94, 1],
    outputRange: [0, 1, 1, 1, 0],
  });
  // Land at the slot — translate from felt centre to slot centre over
  // the fly phase. Outside the fly the popup sits at the felt centre.
  const dx = targetCenterX - popupCenterX;
  const dy = targetCenterY - popupCenterY;
  const translateX = progress.interpolate({
    inputRange: [0, flipEnd, 1],
    outputRange: [0, 0, dx],
  });
  const translateY = progress.interpolate({
    inputRange: [0, flipEnd, 1],
    outputRange: [0, 0, dy],
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
        // Fixed pin to the felt centre so transforms can carry the
        // popup to the measured slot in viewport coords without any
        // parent-relative math.
        position: 'absolute',
        top: popupCenterY - POPUP_TILE_HEIGHT / 2,
        left: popupCenterX - POPUP_TILE_WIDTH / 2,
        width: POPUP_TILE_WIDTH,
        height: POPUP_TILE_HEIGHT,
        zIndex: 55,
      }}
    >
      <Animated.View
        style={{
          width: POPUP_TILE_WIDTH,
          height: POPUP_TILE_HEIGHT,
          opacity: overlayOpacity,
          transform: [{ translateX }, { translateY }, { scale }, { scaleX }],
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
