import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, View } from 'react-native';
import { useGame } from '../../state/game';
import { TILE_CORNER_RADIUS_RATIO, Tile } from '../Tile';

/** Y-anchor for the at-rest `MobileDrawCue` and the post-tap popup
 *  on mobile (and as the fallback anchor on any layout where no wall
 *  is rendered to publish `wallSourceContext`). 0.6 sits inside the
 *  bottom-third thumb zone. Exported so the cue and overlay stay in
 *  lockstep — desyncing them reintroduces the cue→popup position
 *  jump. */
export const DRAW_ANCHOR_Y_RATIO = 0.6;

const RISE_MS = 200;
const FLIP_MS = 440;
const HOLD_MS = 220;
const FLY_MS = 380;
const TOTAL_MS = RISE_MS + FLIP_MS + HOLD_MS + FLY_MS;
// Normalised progress points (0..1).
const RISE_END = RISE_MS / TOTAL_MS;
const FLIP_MID = (RISE_MS + FLIP_MS / 2) / TOTAL_MS;
const FLIP_END = (RISE_MS + FLIP_MS) / TOTAL_MS;
const HOLD_END = (RISE_MS + FLIP_MS + HOLD_MS) / TOTAL_MS;

const POPUP_TILE_WIDTH = 64;
const POPUP_TILE_HEIGHT = 88;
/** Vertical lift applied during the rise phase — the tile separates
 *  from the wall slot a touch so the flip reads as "in mid-air"
 *  rather than spinning flat on the felt. */
const RISE_LIFT_PX = 18;

/**
 * Draw popup. Rises from the wall slot the engine drew from on
 * desktop (or from the thumb-zone cue position on mobile), performs
 * a card flip in mid-air, holds face-up for a beat, then flies into
 * the destination `HandTile` slot.
 *
 * Composition (two layered `<Tile>`s with opacity cross-fade, NOT
 * the older scaleX-squish-and-swap pattern — `backfaceVisibility` +
 * `perspective` don't compose reliably through RN-Web's flat
 * transform context, so we fake the flip in 2D):
 *   - Face-down `<Tile>` (the back) at full opacity until
 *     `FLIP_MID`, then cross-fades to 0 in a one-progress-point
 *     step. The parent's `rotateY` is at 90° at that moment so
 *     the tile is visually edge-on; the opacity swap reads as
 *     the tile turning through and showing the other side.
 *   - Face-up `<Tile>` at opacity 0 until `FLIP_MID`, then 1. Carries
 *     a permanent `scaleX: -1` so when the parent's `rotateY` hits
 *     180° (which is a 2D horizontal mirror in RN-Web) the two
 *     mirrors cancel and the glyph reads forward.
 *   - Both `<Tile>`s pick up `settings.tileBack` and the face
 *     gradients via the regular `Tile` rendering pipeline — the
 *     popup's back face matches whatever skin the user has chosen.
 *
 * Phases (one `Animated.timing` over normalized `progress`):
 *   1. Rise (`RISE_MS`): pops at `sourceRect` scaled to the wall
 *      tile's own width, lifts `RISE_LIFT_PX`, grows to popup size,
 *      reorients (rotateZ 90° → 0° when source is landscape).
 *   2. Flip (`FLIP_MS`): parent rotateY 0° → 180°. Back and face
 *      cross-fade at `FLIP_MID` while the tile is edge-on.
 *   3. Hold (`HOLD_MS`): face-up, no movement.
 *   4. Fly (`FLY_MS`): translate to `slotRect`, scale down to slot
 *      width.
 *
 * Slice-level subscriptions (`tile`, `slotRect`, `sourceRect`,
 * `sourceLandscape`, `seq` separately) so a slot-rect update from
 * `HandTile.measureInWindow` doesn't churn the effect — it would
 * tear down the in-flight animation, early-return on the same
 * `seq`, and never fire the flip.
 *
 * Calls `setDrawAnimationPhase('fly')` at `HOLD_END` so `Hand.tsx`
 * opens the gap for the drawn tile just as the popup begins
 * descending — the row stays tight while the popup is held at the
 * source position.
 *
 * Falls back gracefully when state is missing: no `sourceRect` →
 * pops at the thumb-zone cue anchor (mobile case where no wall is
 * rendered); no `slotRect` → lands a little below the source.
 */
export function DrawTileOverlay() {
  const tile = useGame((s) => s.drawAnimation?.tile ?? null);
  const slotRect = useGame((s) => s.drawAnimation?.slotRect ?? null);
  const sourceRect = useGame((s) => s.drawAnimation?.sourceRect ?? null);
  const sourceLandscape = useGame((s) => s.drawAnimation?.sourceLandscape ?? false);
  const seq = useGame((s) => s.drawAnimation?.seq ?? 0);
  const clear = useGame((s) => s.clearDrawAnimation);
  const setPhase = useGame((s) => s.setDrawAnimationPhase);
  const animsEnabled = useGame((s) => s.settings.animations);
  const lastSeq = useRef(0);
  const progress = useRef(new Animated.Value(0)).current;
  // JS-side mirror of `progress`. The listener keeps it in sync each
  // native frame so a slotRect-driven re-run can resume from the live
  // value without an async `stopAnimation(callback)` round-trip.
  const progressJs = useRef(0);

  // `slotRect` is in the effect's deps so the popup re-targets when
  // `HandTile.measureInWindow` writes the landing slot mid-flight
  // (which usually happens just after `setPhase('fly')` mounts the
  // `HandTile` for the drawn tile). On those re-runs we DON'T reset
  // `progress` to 0 — the cleanup `stopAnimation()` left the native
  // value where the user could see it, so we resume from there with
  // the new render's freshly-baked interpolators (which now close
  // over the live `slotRect`). Without this re-target the fly phase
  // would land at the `slotRect:null` fallback geometry every time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: slotRect isn't read inside the effect body, but its identity drives the re-run that re-bakes the fly-phase interpolators on the native side. Dropping it would re-introduce the stale-target bug.
  useEffect(() => {
    if (tile === null || seq === 0) return;
    const isNewDraw = seq !== lastSeq.current;

    if (!animsEnabled) {
      if (isNewDraw) {
        lastSeq.current = seq;
        clear();
      }
      return;
    }

    if (isNewDraw) {
      lastSeq.current = seq;
      progressJs.current = 0;
      progress.setValue(0);
    }

    // Native-driver listener promotes phase 'hold' → 'fly' at the
    // start of the fly phase so `Hand.tsx` opens the gap as the popup
    // begins descending. The face-up swap is handled by interpolating
    // opacity below (no listener-vs-setTimeout race to manage). Also
    // mirrors the value into `progressJs` so a future re-run can read
    // it synchronously.
    let didStartFly = false;
    const listenerId = progress.addListener(({ value }) => {
      progressJs.current = value;
      if (!didStartFly && value >= HOLD_END) {
        didStartFly = true;
        setPhase('fly');
      }
    });
    const remainingMs = Math.max(0, (1 - progressJs.current) * TOTAL_MS);
    Animated.timing(progress, {
      toValue: 1,
      duration: remainingMs,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      clear();
    });
    return () => {
      // Explicit cancellation: stop the timing before tearing the listener.
      // The native side freezes `progress` at its current value (mirrored
      // into `progressJs` by the listener on the prior frame) so the next
      // effect run — typically a slotRect-driven re-target — can pick up
      // from there rather than snapping back to 0.
      progress.stopAnimation();
      progress.removeListener(listenerId);
    };
  }, [tile, seq, slotRect, animsEnabled, clear, progress, setPhase]);

  if (tile === null || !animsEnabled) return null;

  const { width: viewportW, height: viewportH } = Dimensions.get('window');
  // Fallback when no wall is rendered (mobile) — match
  // `MobileDrawCue`'s anchor so the cue → popup handoff is silent.
  const fallbackCenterX = viewportW / 2;
  const fallbackCenterY = viewportH * DRAW_ANCHOR_Y_RATIO;

  const sourceCenterX = sourceRect ? sourceRect.x + sourceRect.width / 2 : fallbackCenterX;
  const sourceCenterY = sourceRect ? sourceRect.y + sourceRect.height / 2 : fallbackCenterY;
  const targetCenterX = slotRect ? slotRect.x + slotRect.width / 2 : sourceCenterX;
  const targetCenterY = slotRect ? slotRect.y + slotRect.height / 2 : sourceCenterY + 220;
  const targetScale = slotRect ? slotRect.width / POPUP_TILE_WIDTH : 0.5;
  // Start at the wall tile's short edge so the popup's silhouette
  // overlaps the slot at progress=0. Fallback (no source rect) =
  // 1.0 so the cue→popup handoff is silent on mobile.
  const sourceShortEdge = sourceRect ? Math.min(sourceRect.width, sourceRect.height) : 0;
  const sourceScale = sourceShortEdge > 0 ? sourceShortEdge / POPUP_TILE_WIDTH : 1;

  // Outer wrapping View is at viewport (0, 0) (absolute, top:0/left:0).
  // translateX/Y walks the inner Animated.View from source → hold →
  // target in viewport coords. Note: the wrapper MUST be a sibling of
  // the ScrollView (not inside it) on desktop, otherwise it inherits
  // the scroll content's centered positioning context and the popup
  // ends up offset by ((vw - 1320) / 2) px.
  const sourceTopLeftX = sourceCenterX - POPUP_TILE_WIDTH / 2;
  const sourceTopLeftY = sourceCenterY - POPUP_TILE_HEIGHT / 2;
  const holdTopLeftY = sourceTopLeftY - RISE_LIFT_PX;
  const targetTopLeftX = targetCenterX - POPUP_TILE_WIDTH / 2;
  const targetTopLeftY = targetCenterY - POPUP_TILE_HEIGHT / 2;

  const translateX = progress.interpolate({
    inputRange: [0, HOLD_END, 1],
    outputRange: [sourceTopLeftX, sourceTopLeftX, targetTopLeftX],
  });
  const translateY = progress.interpolate({
    inputRange: [0, RISE_END, HOLD_END, 1],
    outputRange: [sourceTopLeftY, holdTopLeftY, holdTopLeftY, targetTopLeftY],
  });
  const scale = progress.interpolate({
    inputRange: [0, RISE_END, HOLD_END, 1],
    outputRange: [sourceScale, 1, 1, targetScale],
  });
  // 2D horizontal flip — RN-Web flattens rotateY into a horizontal
  // squish in the absence of preserve-3d, which is exactly what we
  // want for the card-flip read.
  const flipRotation = progress.interpolate({
    inputRange: [0, RISE_END, FLIP_END, 1],
    outputRange: ['0deg', '0deg', '180deg', '180deg'],
  });
  // Reorient runs DURING rise so the flip starts already in portrait.
  const reorientZ = progress.interpolate({
    inputRange: [0, RISE_END, 1],
    outputRange: sourceLandscape ? ['90deg', '0deg', '0deg'] : ['0deg', '0deg', '0deg'],
  });
  // Back / face cross-fade at FLIP_MID. The parent is at rotateY=90°
  // (scaleX≈0) at that moment, so both children are visually invisible
  // and the swap is hidden.
  const backOpacity = progress.interpolate({
    inputRange: [0, FLIP_MID, FLIP_MID, 1],
    outputRange: [1, 1, 0, 0],
  });
  const faceOpacity = progress.interpolate({
    inputRange: [0, FLIP_MID, FLIP_MID, 1],
    outputRange: [0, 0, 1, 1],
  });
  // Overlay-wide opacity: a one-frame fade-in at the start (the
  // wall-draw cue has just unmounted, so a hard pop reads as a
  // visual snap) and a tail fade-out so the destination slot's
  // opacity-1 reveal lands flush.
  const overlayOpacity = progress.interpolate({
    inputRange: [0, 0.04, 0.94, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
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
          transform: [
            { translateX },
            { translateY },
            { rotateZ: reorientZ },
            { rotateY: flipRotation },
            { scale },
          ],
          // Trace the tile silhouette so both the gold halo and the
          // dark drop shadow round off cleanly at the corners.
          borderRadius: POPUP_TILE_WIDTH * TILE_CORNER_RADIUS_RATIO,
          // Drop shadow gives the popup felt-elevation; the second
          // gold-glow shadow matches `Tile.tsx`'s `raised` state
          // byte-for-byte so the cue's pulsing halo hands off to the
          // popup's persistent halo to the landed tile's `raised`
          // glow without a visible gap in between.
          boxShadow: '0px 10px 24px rgba(0,0,0,0.35), 0px 0px 8px rgba(220,159,79,0.7)',
        }}
      >
        {/* Face-down (back of tile). Uses the user's `tileBack` skin
            via `Tile`'s `useGame` subscription. */}
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: POPUP_TILE_WIDTH,
            height: POPUP_TILE_HEIGHT,
            opacity: backOpacity,
          }}
        >
          <Tile tile={tile} faceDown width={POPUP_TILE_WIDTH} height={POPUP_TILE_HEIGHT} />
        </Animated.View>
        {/* Face-up. Pre-mirrored with scaleX = -1 so the parent's
            180° rotateY (which behaves as a 2D mirror in RN-Web's
            flat transform context) cancels out and the glyph reads
            correctly when revealed. */}
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: POPUP_TILE_WIDTH,
            height: POPUP_TILE_HEIGHT,
            opacity: faceOpacity,
            transform: [{ scaleX: -1 }],
          }}
        >
          <Tile tile={tile} faceDown={false} width={POPUP_TILE_WIDTH} height={POPUP_TILE_HEIGHT} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}
