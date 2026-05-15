import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, View } from 'react-native';
import { useGame } from '../../state/game';
import { Tile } from '../Tile';

/** Y-anchor for both the at-rest `MobileDrawCue` and the post-tap
 *  popup. 0.6 puts the tile inside the bottom-third "thumb zone" on a
 *  standard one-handed grip, above the user's hand row. Exported so
 *  the cue and overlay stay in lockstep — desynchronising them would
 *  reintroduce the cue→popup position jump. */
export const DRAW_ANCHOR_Y_RATIO = 0.6;

const HOLD_MS = 220;
const FLIP_MS = 420;
const FLY_MS = 360;

const TOTAL_MS = HOLD_MS + FLIP_MS + FLY_MS;
// Normalised progress points (0..1) for the three phases — used by the
// interpolators below and to gate the face-up swap during the flip's
// scaleX-zero midpoint. The legacy pop-in phase is gone: the overlay
// now mounts at the same screen rect where `MobileDrawCue` was
// rendering the face-down tile a frame earlier, so there's nothing to
// pop in from. Starting at scale 1 + opacity 1 makes the handoff
// invisible.
const HOLD_END = HOLD_MS / TOTAL_MS;
const FLIP_MID = (HOLD_MS + FLIP_MS / 2) / TOTAL_MS;
const FLIP_END = (HOLD_MS + FLIP_MS) / TOTAL_MS;

const POPUP_TILE_WIDTH = 64;
const POPUP_TILE_HEIGHT = 88;

/**
 * Centre-of-felt popup that plays when the local user draws a tile.
 *
 * Phases (driven by a single `Animated.timing` over `progress`):
 *   1. Hold face-down for HOLD_MS so the player registers the tap (and,
 *      on online matches, covers the latency between sending `draw` and
 *      the server's `drew` event arriving).
 *   2. Flip: scaleX 1 → 0 → 1 over FLIP_MS, with a `faceDown` swap at
 *      the scaleX-zero midpoint. We use a scaleX squish instead of
 *      RN-Web's `rotateY` + `backfaceVisibility` because that combo
 *      doesn't render reliably without a 3D perspective ancestor —
 *      the squash reads as a flip and avoids the styling rabbit-hole.
 *   3. Fly: translate + scale to the exact destination slot rect that
 *      the matching `HandTile` wrote into `drawAnimation.slotRect` via
 *      `measureInWindow`. The slot is rendered with `opacity: 0`
 *      while this overlay is alive, so the fly phase visually "is"
 *      the tile arriving — when the overlay clears, the slot fades
 *      back to opacity 1 in the same screen position.
 *
 * The overlay's resting position + size match `MobileDrawCue` exactly
 * (`POPUP_TILE_WIDTH` × `POPUP_TILE_HEIGHT` anchored at
 * `viewportW/2, viewportH * DRAW_ANCHOR_Y_RATIO`). The cue unmounts the
 * same frame the overlay mounts (both selectors flip on `drawAnimation`
 * going non-null), so the user perceives one continuous tile that
 * holds → flips → flies into their hand. Rendering gates on
 * `tile !== null` rather than a local `visible` state so the cue → popup
 * handoff lands in a single commit — gating on a separate `useState`
 * forced the overlay to wait for its effect to fire before painting,
 * which left a 1-frame gap where neither the cue nor the popup was on
 * screen.
 *
 * Slice-level subscriptions on purpose (`tile`, `slotRect`, `seq`
 * separately rather than the whole `drawAnimation` object): a slot-rect
 * update from `HandTile.measureInWindow` produces a fresh
 * `drawAnimation` object reference but doesn't change `tile` or `seq`.
 * If the effect depended on the whole object it would re-run on every
 * slot-rect update — its cleanup would tear down the in-flight progress
 * listener, the body would see the same `seq` and early-return, and the
 * flip would never fire (the user would see the back of the tile for
 * the whole pop → hold → flip → fly cycle).
 *
 * The seq counter the store hands us is strictly monotonic across the
 * overlay's mount-lifetime (see `flashDrawAnimation` for why we hold a
 * separate counter rather than `(prev.drawAnimation?.seq ?? 0) + 1`).
 */
export function DrawTileOverlay() {
  const tile = useGame((s) => s.drawAnimation?.tile ?? null);
  const slotRect = useGame((s) => s.drawAnimation?.slotRect ?? null);
  const seq = useGame((s) => s.drawAnimation?.seq ?? 0);
  const clear = useGame((s) => s.clearDrawAnimation);
  const setPhase = useGame((s) => s.setDrawAnimationPhase);
  const animsEnabled = useGame((s) => s.settings.animations);
  const lastSeq = useRef(0);
  const [faceUp, setFaceUp] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (tile === null || seq === 0) return;
    if (seq === lastSeq.current) return;
    lastSeq.current = seq;
    if (!animsEnabled) {
      clear();
      return;
    }
    setFaceUp(false);
    progress.setValue(0);

    // The single progress listener drives two state transitions tied to
    // visual milestones in the running animation:
    //   - At `FLIP_MID` (scaleX-zero point of the squish), swap the
    //     tile face from down to up. JS-thread setTimeout would drift
    //     relative to the native-driven scaleX, exposing the back face
    //     past the midpoint when the JS thread is busy.
    //   - At `FLIP_END` (start of the fly), promote phase 'hold' →
    //     'fly'. `Hand.tsx` reads this and stops filtering the newly-
    //     drawn tile out of its rendered row, so siblings begin sliding
    //     aside the same frame the popup begins descending — the gap
    //     opens *while* the tile is moving in, not at t=0.
    let didFlip = false;
    let didStartFly = false;
    const listenerId = progress.addListener(({ value }) => {
      if (!didFlip && value >= FLIP_MID) {
        didFlip = true;
        setFaceUp(true);
      }
      if (!didStartFly && value >= FLIP_END) {
        didStartFly = true;
        setPhase('fly');
      }
    });
    Animated.timing(progress, {
      toValue: 1,
      duration: TOTAL_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => {
      progress.removeListener(listenerId);
      if (!finished) return;
      clear();
    });
    return () => progress.removeListener(listenerId);
  }, [tile, seq, animsEnabled, clear, progress, setPhase]);

  if (tile === null || !animsEnabled) return null;

  // Viewport dimensions for the popup's initial centre-of-screen
  // anchor. `Dimensions.get('window')` on RN-Web reads the live inner
  // viewport, so resizing across the animation window is fine — we
  // only read it once on render.
  const { width: viewportW, height: viewportH } = Dimensions.get('window');
  const popupCenterX = viewportW / 2;
  // Anchor inside the thumb-zone (~60% from top) so the cue that
  // mounts at the same coordinates is reachable in a one-handed grip.
  // The cue and overlay share `DRAW_ANCHOR_Y_RATIO`; changing one
  // without the other would reintroduce a position jump on tap.
  const popupCenterY = viewportH * DRAW_ANCHOR_Y_RATIO;

  // Fly target = the slot's centre in viewport coords. If the slot
  // hasn't measured yet (race with the first render after the draw
  // event), fall back to a fixed offset downward.
  const targetCenterX = slotRect ? slotRect.x + slotRect.width / 2 : popupCenterX;
  const targetCenterY = slotRect ? slotRect.y + slotRect.height / 2 : popupCenterY + 200;
  const targetScale = slotRect ? slotRect.width / POPUP_TILE_WIDTH : 0.45;

  // Hold at scale 1 (the cue's size) through hold + flip → shrink into
  // the slot's scale during the fly.
  const scale = progress.interpolate({
    inputRange: [0, FLIP_END, 1],
    outputRange: [1, 1, targetScale],
  });
  // Opaque from the first frame (cue→popup handoff) until the very last
  // bit of the fly, where it fades so the hand-side opacity reveal
  // cross-fades cleanly with the landing.
  const overlayOpacity = progress.interpolate({
    inputRange: [0, FLIP_END, 0.94, 1],
    outputRange: [1, 1, 1, 0],
  });
  // Land at the slot — translate from felt centre to slot centre over
  // the fly phase. Outside the fly the popup sits at the felt centre.
  const dx = targetCenterX - popupCenterX;
  const dy = targetCenterY - popupCenterY;
  const translateX = progress.interpolate({
    inputRange: [0, FLIP_END, 1],
    outputRange: [0, 0, dx],
  });
  const translateY = progress.interpolate({
    inputRange: [0, FLIP_END, 1],
    outputRange: [0, 0, dy],
  });
  // scaleX squish during the flip — 1 → 0 across the first half, then
  // 0 → 1 across the second half. Outside the flip phase scaleX is 1.
  const scaleX = progress.interpolate({
    inputRange: [0, HOLD_END, FLIP_MID, FLIP_END, 1],
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
          // Drop shadow gives the popup felt-elevation while it's
          // floating; the gold glow is the visual handoff to the
          // landing slot. The second shadow matches `Tile`'s `raised`
          // state byte-for-byte (`0px 0px 8px rgba(220,159,79,0.7)`),
          // so the freshly-drawn `HandTile` — which lights up under
          // exactly that glow once `drawnTileId` matches it — receives
          // a tile that's already wearing the same halo. Without this,
          // the cue's pulsing gold ring vanished hard the instant the
          // popup mounted, then re-appeared at the landing as the
          // hand-side halo; the gap in the middle read as "the gold
          // came back from nowhere".
          boxShadow: '0px 10px 24px rgba(0,0,0,0.35), 0px 0px 8px rgba(220,159,79,0.7)',
        }}
      >
        <Tile tile={tile} faceDown={!faceUp} width={POPUP_TILE_WIDTH} height={POPUP_TILE_HEIGHT} />
      </Animated.View>
    </View>
  );
}
