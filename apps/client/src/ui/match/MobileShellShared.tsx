import type { GameState } from '@mahjong/game-logic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import type { LobbyState } from '../../state/game';
import { PULSE_TEMPO, usePulse } from '../animations';
import { COLORS } from '../colors';
import { WIND_GLYPH } from '../winds';
import { MeldStrip } from './MeldStrip';
import { oppIdentity } from './oppIdentity';
import { type Position, SEAT_COLOR } from './seatColor';
import type { SeatPlacement } from './seatPlacement';

/**
 * Perimeter slots for the three opponent strips, ordered to match HK
 * mahjong playing order from the seat that plays immediately after
 * the user. The user always sits at `bottom`; play moves counter-
 * clockwise → right → top → left → back to user. Rendering the three
 * opponent rows in this order means the visual order matches the wind
 * sequence regardless of who the user is: e.g. North user sees
 * East / South / West top-to-bottom, South user sees West / North /
 * East. Shared with `PortraitShell` (vertical stack above the
 * shared discard pool) and `LandscapeShell` (equal-flex strips
 * alongside the ☰ menu) so both orientations stay in lockstep.
 */
export const OPP_PLAYING_ORDER: readonly Position[] = ['right', 'top', 'left'];

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
  // Memoise so the Animated multiply node isn't re-created on every
  // render — both inputs are stable Animated refs/interpolations, so
  // the memo just avoids rebuilding the composite node each pulse
  // frame.
  const opacity = useMemo(
    () => Animated.multiply(fadeIn, breathingOpacity),
    [fadeIn, breathingOpacity],
  );
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
 *  pill line up visually on the same row. Internal-only as of PR
 *  #409: LandscapeShell no longer reserves a slot keyed off this
 *  constant. Drop the `export` if no external reader returns; keep
 *  the const because `YourTurnBadge` below still reads it. */
const YOUR_TURN_BADGE_HEIGHT = 30;
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
  // Compact variant rides the same row as the slim SortPicker in
  // PortraitShell — match its borderRadius (8 vs the old 10), drop
  // the gold drop-shadow, and tighten letter-spacing so both chips
  // read as siblings on the bottom action row rather than as a
  // hand-rolled pill next to a segmented control. Desktop /
  // landscape variants keep their original chrome since they don't
  // share a baseline with the segmented picker there.
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
        borderRadius: compact ? 8 : 10,
        backgroundColor: COLORS.gold,
        borderColor: '#a87f24',
        borderWidth: 1,
        opacity,
        ...(compact ? null : { boxShadow: '0px 2px 6px rgba(196,159,52,0.35)' }),
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontSize,
          fontWeight: '900',
          color: '#3a2c0d',
          letterSpacing: compact ? 0.4 : 0.6,
        }}
      >
        YOUR TURN {needsDraw ? '· DRAW' : '· DISCARD'}
      </Text>
    </Animated.View>
  );
}

interface DenseOppRowProps {
  placement: SeatPlacement;
  state: GameState;
  lobby: LobbyState | null;
  aboutToDraw: boolean;
  drawCountdown: number | null;
  turnCountdown: number | null;
}

/**
 * Transparent, single-line opponent row used by both `PortraitShell`
 * (three vertical rows above the shared discard pool) and
 * `LandscapeShell`'s top chrome (three equal-flex strips alongside the
 * ☰ menu). Drops the cream `OppHandStrip` card to ~22 px tall so the
 * shared discard pool's `flex: 1` recovers ~60 px of vertical space
 * across the three opp rows.
 *
 * Active state: subtle red-tinted background + matching border + soft
 * glow. Border stays 1 px in both states so the row doesn't shift by
 * a pixel when the turn rotates. The 3-px seat-colour bar on the left
 * stays in the seat palette (jade / mauve / sky) in every state — the
 * red halo + tint carry the "this seat is on the move" cue; a red bar
 * duplicates that role and reads as "this seat is red".
 *
 * Bot label sits LEFT of the flex spacer next to the name (not
 * right-aligned), so countdowns stay anchored at the right edge
 * without competing with the player identity.
 */
export function DenseOppRow({
  placement,
  state,
  lobby,
  aboutToDraw,
  drawCountdown,
  turnCountdown,
}: DenseOppRowProps) {
  const { name, botLabel } = oppIdentity(lobby, placement.seat);
  const seatColor = SEAT_COLOR[placement.position];
  const isActive = state.turn === placement.seat && state.phase === 'turn';
  const meldsForSeat = state.melds[placement.seat];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 22,
        gap: 8,
        // Padding stays constant so the row doesn't grow when active —
        // toggling it would shift every neighbour by 12 × 4 px on each
        // turn rotation. The inactive row keeps the same inset; the
        // active visual is carried entirely by background + border colour
        // + box-shadow.
        paddingHorizontal: 6,
        paddingVertical: 2,
        backgroundColor: isActive ? 'rgba(219,93,74,0.16)' : 'transparent',
        borderWidth: 1,
        borderColor: isActive ? 'rgba(219,93,74,0.38)' : 'transparent',
        borderRadius: 8,
        boxShadow: isActive ? '0px 0px 10px rgba(219,93,74,0.28)' : 'none',
      }}
    >
      <View
        style={{
          width: 3,
          alignSelf: 'stretch',
          borderRadius: 2,
          backgroundColor: seatColor,
        }}
      />
      <Text
        style={{
          fontFamily: 'Noto Serif TC',
          fontSize: 11,
          fontWeight: '700',
          color: isActive ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.65)',
        }}
      >
        {WIND_GLYPH[placement.seatWind]}
      </Text>
      {/* Bot rows pin the name to a fixed-width slot so the
          (Easy)/(Passive) chip aligns vertically across the three
          rows — "Yu" and "Haru" would otherwise put the chip at
          different x-positions and read as a ragged column. Human
          rows skip the slot entirely so a long display name doesn't
          get cropped; humans don't carry a chip, so there's nothing
          to align against. Slot width is sized to the widest
          `BOT_NAME_POOL` entry — pool is capped at <= 4 chars by
          design, so "Haru" / "Vera" / "Niko" (~28-30 px at 12-px
          bold Inter) fit at 34 px with a small breathing margin.
          Bump this and the pool's length-cap comment together if a
          longer bot name joins. */}
      {botLabel ? (
        <View style={{ width: 34 }}>
          {/* Defensive truncation — the 34-px slot is sized to the
              4-char BOT_NAME_POOL cap, but a hibernated DO restoring
              an older lobby snapshot could emit a longer bot name
              (e.g. "Casey") that would overflow the slot's clip box
              under numberOfLines={1}. Slice + ellipsis at render
              keeps the row from breaking even when the pool drifts. */}
          <Text
            style={{
              fontSize: 12,
              fontWeight: '800',
              color: isActive ? 'white' : 'rgba(255,255,255,0.88)',
            }}
            numberOfLines={1}
          >
            {name.length > 4 ? `${name.slice(0, 4)}…` : name}
          </Text>
        </View>
      ) : (
        <Text
          style={{
            fontSize: 12,
            fontWeight: '800',
            color: isActive ? 'white' : 'rgba(255,255,255,0.88)',
            flexShrink: 1,
          }}
          numberOfLines={1}
        >
          {name}
        </Text>
      )}
      {botLabel ? (
        <Text
          style={{
            fontSize: 9,
            fontWeight: '700',
            color: isActive ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.36)',
          }}
        >
          {botLabel}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      {isActive && turnCountdown !== null ? (
        <Text style={{ fontSize: 9, fontWeight: '900', color: 'rgba(255,255,255,0.9)' }}>
          {turnCountdown}s left
        </Text>
      ) : null}
      {!isActive && aboutToDraw && drawCountdown !== null ? (
        <Text style={{ fontSize: 9, fontWeight: '800', color: COLORS.gold }}>
          drawing in {drawCountdown}s
        </Text>
      ) : null}
      {meldsForSeat.length > 0 ? (
        <MeldStrip melds={meldsForSeat} tileWidth={10} tileHeight={15} showKindLabel={false} />
      ) : null}
    </View>
  );
}
