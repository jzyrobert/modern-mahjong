import type { GameState } from '@mahjong/game-logic';
import { useEffect, useRef, useState } from 'react';
import { Animated, Text } from 'react-native';
import type { LobbyState } from '../../state/game';
import { PULSE_TEMPO, usePulse } from '../animations';
import { COLORS } from '../colors';
import { OppHandStrip } from './OppHandStrip';
import type { SeatPlacement } from './seatPlacement';

interface SeatRowProps {
  placement: SeatPlacement;
  state: GameState;
  lobby: LobbyState | null;
  aboutToDraw: boolean;
  drawCountdown: number | null;
  turnCountdown: number | null;
  compact?: boolean;
}

/** Thin adapter for `OppHandStrip` — derives `isActive` from the
 *  engine state. Used by `PortraitShell` (three vertical rows above the
 *  shared discard pool) and `LandscapeShell` via `LandscapeOppColumn`
 *  (three columns side-by-side), so it lives in this shared module. */
export function SeatRow({
  placement,
  state,
  lobby,
  aboutToDraw,
  drawCountdown,
  turnCountdown,
  compact,
}: SeatRowProps) {
  const isActive = state.turn === placement.seat && state.phase === 'turn';
  return (
    <OppHandStrip
      seat={placement.seat}
      seatWind={placement.seatWind}
      position={placement.position}
      lobby={lobby}
      melds={state.melds[placement.seat]}
      isActive={isActive}
      aboutToDraw={aboutToDraw}
      drawCountdown={drawCountdown}
      turnCountdown={isActive ? turnCountdown : null}
      compact={compact ?? false}
    />
  );
}

/**
 * Breathing gold halo painted over the user's hand row when it's their
 * turn. Direct port of OppHandStrip's `ActiveHalo` — same tempo
 * (`PULSE_TEMPO.state`), same GROWTH_PX-driven dual-axis scale so the
 * halo grows uniformly on long + short edges. The opponents already
 * surface the same active-turn cue; mirroring it on the user's own
 * hand closes the gap that left the player relying on a 8-px red dot
 * in the status pill to know they were on the clock.
 *
 * Used by both `PortraitShell` and `LandscapeShell` so it lives in
 * this shared module rather than in either orientation file.
 */
export function YourHandActiveHalo() {
  const t = usePulse({ durationMs: PULSE_TEMPO.state });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const GROWTH_PX = 4;
  const sx = size && size.w > 0 ? 1 + (GROWTH_PX * 2) / size.w : 1;
  const sy = size && size.h > 0 ? 1 + (GROWTH_PX * 2) / size.h : 1;
  const scaleX = t.interpolate({ inputRange: [0, 1], outputRange: [1, sx] });
  const scaleY = t.interpolate({ inputRange: [0, 1], outputRange: [1, sy] });
  const breathingOpacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.85] });
  // Fade in over the draw popup's full duration (`DrawTileOverlay`'s
  // rise + flip + hold + fly = ~1240 ms) so the halo ramps up
  // alongside the tile's journey from wall to hand instead of
  // popping in the instant `state.hasDrawn` flips. Multiplied with
  // the breathing opacity via `Animated.multiply` so the pulse keeps
  // ticking once the fade completes — both inputs run on the native
  // driver. Runs once per mount; the next turn rotates `myTurn`
  // false → true, which unmounts and re-mounts the halo and
  // re-triggers this fade. Kept as a local constant rather than
  // imported from `DrawTileOverlay` so this surface doesn't reach
  // into the overlay's internals — within ~50 ms of TOTAL_MS is
  // close enough; the halo's breathing pulse masks any tail mismatch.
  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 1200, useNativeDriver: true }).start();
  }, [fadeIn]);
  const opacity = Animated.multiply(fadeIn, breathingOpacity);
  return (
    <Animated.View
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) =>
          prev && prev.w === width && prev.h === height ? prev : { w: width, h: height },
        );
      }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: COLORS.gold,
        opacity,
        transform: [{ scaleX }, { scaleY }],
      }}
    />
  );
}

/**
 * Solid gold-on-ink pill rendered next to ReadyHandBadge when it's
 * the user's turn — the declarative "YOUR TURN" label that the
 * 8-px red dot in the status pill currently has to carry alone. Copy
 * adapts to whether the user still needs to draw ("DRAW") vs. already
 * drew and now needs to discard ("DISCARD") so the player gets a
 * direct hint at what action is expected. Pulses on opacity to match
 * the hand-halo cadence so the badge and halo read as one cue.
 *
 * Used by both `PortraitShell` and `LandscapeShell` so it lives in
 * this shared module rather than in either orientation file.
 */
/** Fixed pill widths so the DRAW (16 chars) vs DISCARD (19 chars)
 *  variants render at the same size. Without this, swapping copy
 *  the instant the user draws their tile widened the badge by ~17
 *  px and re-centred the surrounding badge row.
 *
 *  Desktop default — wide enough for `YOUR TURN · DISCARD` at the
 *  10-px bold weight with 0.6 letter-spacing plus 8-px horiz padding
 *  + 1-px border each side. */
export const YOUR_TURN_BADGE_WIDTH = 160;
/** Compact width used on portrait phones where the badge has to
 *  share a row with the SortPicker. Wide enough that
 *  `YOUR TURN · DISCARD` fits on one line at fontSize 9; a 128-px
 *  variant wrapped to two rows once DISCARD landed. */
export const YOUR_TURN_BADGE_WIDTH_COMPACT = 152;
/** Heights match the SortPicker pill's outer height in each
 *  variant (default vs slim) so the YOUR TURN pill and the sort
 *  pill line up visually on the same row. Exported so callers that
 *  reserve a fixed-height slot for the badge (e.g. `LandscapeShell`'s
 *  bottom-band YOUR-TURN reservation) match it instead of duplicating
 *  the magic 30. */
export const YOUR_TURN_BADGE_HEIGHT = 30;
const YOUR_TURN_BADGE_HEIGHT_COMPACT = 26;

interface YourTurnBadgeProps {
  needsDraw: boolean;
  /** Shrinks the pill (smaller width + smaller font + shorter
   *  height) so it fits alongside the slim SortPicker on a 393-px
   *  portrait viewport without wrapping. Default false (desktop +
   *  landscape mobile use the full size). */
  compact?: boolean;
}

export function YourTurnBadge({ needsDraw, compact = false }: YourTurnBadgeProps) {
  const t = usePulse({ durationMs: PULSE_TEMPO.state });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] });
  const width = compact ? YOUR_TURN_BADGE_WIDTH_COMPACT : YOUR_TURN_BADGE_WIDTH;
  const height = compact ? YOUR_TURN_BADGE_HEIGHT_COMPACT : YOUR_TURN_BADGE_HEIGHT;
  const fontSize = compact ? 9 : 10;
  return (
    <Animated.View
      style={{
        width,
        height,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: compact ? 6 : 8,
        borderRadius: 10,
        backgroundColor: COLORS.gold,
        borderColor: '#a87f24',
        borderWidth: 1,
        opacity,
        boxShadow: '0px 2px 6px rgba(196,159,52,0.35)',
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontSize,
          fontWeight: '900',
          color: '#3a2c0d',
          letterSpacing: 0.6,
        }}
      >
        YOUR TURN {needsDraw ? '· DRAW' : '· DISCARD'}
      </Text>
    </Animated.View>
  );
}
