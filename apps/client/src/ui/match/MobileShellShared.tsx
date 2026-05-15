import type { GameState } from '@mahjong/game-logic';
import { useState } from 'react';
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
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.85] });
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
export function YourTurnBadge({ needsDraw }: { needsDraw: boolean }) {
  const t = usePulse({ durationMs: PULSE_TEMPO.state });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] });
  return (
    <Animated.View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        backgroundColor: COLORS.gold,
        borderColor: '#a87f24',
        borderWidth: 1,
        opacity,
        boxShadow: '0px 2px 6px rgba(196,159,52,0.35)',
      }}
    >
      <Text
        style={{
          fontSize: 10,
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
