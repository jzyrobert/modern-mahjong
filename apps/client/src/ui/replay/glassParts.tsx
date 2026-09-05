import type { Event as EngineEvent, Seat, Wind } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { HOVER_TRANSITION, MENU, TYPE, glass } from '../menu/theme';
import { WIND_GLYPH, WIND_NAME } from '../winds';
import { type EventKindBucket, describeEventNamed, eventKind } from './events';

/**
 * Glass HUD parts for the 3D replay player. RN primitives styled with
 * the parlour tokens (`menu/theme`) so the chrome shares its glass with
 * the library and the in-match sheets; nothing here reads game state —
 * `GlassReplayPlayer` derives every value and passes it down.
 */

/** 11 px uppercase micro-label. */
export const MICRO = {
  ...TYPE.label,
  fontSize: 11,
  lineHeight: 13,
  letterSpacing: 1,
} as const;

/** Colour of the event dot per event class (the paper rail's border hues, lifted for glass). */
const EVENT_DOT: Record<EventKindBucket, string> = {
  gang: '#c78be6',
  claim: MENU.goldHi,
  draw: '#7fd6a3',
  discard: MENU.text3,
  other: MENU.text3,
};

// ─── Status pill ────────────────────────────────────────────────────

export function ReplayStatusPill({
  prevailingWind,
  handNumber,
  cursor,
  totalFrames,
  wallCount,
  compact,
  dense = false,
  showCounter = true,
}: {
  prevailingWind: Wind;
  handNumber: number;
  cursor: number;
  totalFrames: number;
  wallCount: number;
  compact: boolean;
  /** Landscape: 38 px row. */
  dense?: boolean;
  /** Portrait drops the frame counter here — the dock carries it. */
  showCounter?: boolean;
}) {
  const h = dense ? 38 : 44;
  return (
    <View
      accessibilityLabel={`Hand ${handNumber}, ${WIND_NAME[prevailingWind]} round, frame ${cursor + 1} of ${totalFrames}`}
      testID="replay-status-pill"
      style={{
        ...glass({ radius: 999 }),
        minHeight: h,
        flexDirection: 'row',
        alignItems: 'center',
        gap: compact ? 8 : 10,
        paddingLeft: dense ? 4 : 6,
        paddingRight: compact ? 12 : 16,
        flexShrink: 1,
        minWidth: 0,
      }}
    >
      <View
        style={{
          width: h - 12,
          height: h - 12,
          borderRadius: 999,
          backgroundColor: MENU.goldTint,
          borderColor: MENU.goldEdge,
          borderWidth: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={[TYPE.serif, { fontSize: dense ? 13 : 15, color: MENU.goldHi, lineHeight: 18 }]}
        >
          {WIND_GLYPH[prevailingWind]}
        </Text>
      </View>
      <Text style={[MICRO, { color: MENU.text }]} numberOfLines={1}>
        Hand {handNumber}
      </Text>
      {compact ? null : (
        <>
          <Divider />
          <Text style={MICRO} numberOfLines={1}>
            {WIND_NAME[prevailingWind]} round
          </Text>
          <Divider />
          <Text style={MICRO} numberOfLines={1}>
            {wallCount} left
          </Text>
        </>
      )}
      {showCounter ? (
        <>
          <Divider />
          <Text style={[MICRO, { color: MENU.text2 }]} numberOfLines={1}>
            {cursor + 1} / {totalFrames}
          </Text>
        </>
      ) : null}
    </View>
  );
}

function Divider() {
  return <View style={{ width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.14)' }} />;
}

// ─── Seat badge ─────────────────────────────────────────────────────

export interface ReplaySeatBadgeProps {
  name: string;
  seatColor: string;
  seatWind: Wind;
  score: number;
  isDealer: boolean;
  isActive: boolean;
  isYou: boolean;
  isBot: boolean;
  /** Three badges sharing a phone row: tighter name clamp. */
  dense?: boolean;
  /** Fill the flex width the parent grants (footer leading slot). */
  fluid?: boolean;
  style?: ViewStyle | undefined;
  testID?: string | undefined;
}

/** Glass seat badge height, CSS px (matches `three/replay/layout.REPLAY_BADGE_H`). */
export const SEAT_BADGE_H = 34;

export function ReplaySeatBadge({
  name,
  seatColor,
  seatWind,
  score,
  isDealer,
  isActive,
  isYou,
  isBot,
  dense = false,
  fluid = false,
  style,
  testID,
}: ReplaySeatBadgeProps) {
  const sign = score > 0 ? '+' : '';
  return (
    <View
      testID={testID}
      accessibilityLabel={`${name}${isYou ? ' (you)' : ''}, ${WIND_NAME[seatWind]} seat, ${score} points${isDealer ? ', dealer' : ''}${isActive ? ', active turn' : ''}`}
      style={{
        ...glass({ radius: 999, quiet: !isActive }),
        borderColor: isActive ? 'rgba(216,168,90,0.9)' : MENU.hairline,
        ...(isActive
          ? { boxShadow: '0px 0px 0px 3px rgba(216,168,90,0.22), 0px 12px 32px rgba(0,0,0,0.35)' }
          : {}),
        height: SEAT_BADGE_H,
        paddingLeft: 10,
        paddingRight: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: dense ? 6 : 8,
        minWidth: 0,
        maxWidth: fluid ? '100%' : dense ? 132 : 220,
        flexShrink: 1,
        ...HOVER_TRANSITION,
        ...style,
      }}
    >
      <View
        accessibilityElementsHidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: seatColor,
          boxShadow: `0px 0px 6px ${seatColor}`,
        }}
      />
      <Text
        style={{
          fontSize: dense ? 11 : 12,
          fontWeight: '800',
          color: MENU.text,
          flexShrink: 1,
          minWidth: 0,
        }}
        numberOfLines={1}
      >
        {name}
      </Text>
      <Text style={[TYPE.serif, { fontSize: dense ? 11 : 13, color: MENU.goldHi, lineHeight: 15 }]}>
        {WIND_GLYPH[seatWind]}
      </Text>
      {isDealer ? (
        <View
          accessibilityLabel="Dealer"
          style={{
            paddingHorizontal: 4,
            paddingVertical: 1,
            borderRadius: 5,
            backgroundColor: MENU.red,
            boxShadow: '0px 1px 4px rgba(177,77,58,0.45)',
          }}
        >
          <Text style={[TYPE.serif, { fontSize: 9, color: 'white', lineHeight: 11 }]}>莊</Text>
        </View>
      ) : null}
      {isBot && !dense ? (
        <Text style={[MICRO, { fontSize: 9, letterSpacing: 0.6 }]}>Bot</Text>
      ) : null}
      <Text
        style={[
          MICRO,
          {
            fontSize: 10,
            letterSpacing: 0.6,
            color: score > 0 ? '#7fd6a3' : score < 0 ? '#e59a8b' : MENU.text2,
          },
        ]}
      >
        {sign}
        {score}
      </Text>
    </View>
  );
}

// ─── Event ticker / rail ────────────────────────────────────────────

/** One-line readout of the frame's newest event (portrait dock). */
export function EventTicker({
  event,
  nameFor,
  style,
}: {
  event: EngineEvent | null;
  nameFor: (seat: Seat) => string;
  style?: ViewStyle;
}) {
  if (!event) return <View style={[{ height: 18 }, style]} />;
  return (
    <View
      testID="replay-ticker"
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 8, height: 18, minWidth: 0 },
        style,
      ]}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: EVENT_DOT[eventKind(event)],
        }}
      />
      <Text
        style={{ fontSize: 11, fontWeight: '700', color: MENU.text2, flexShrink: 1 }}
        numberOfLines={1}
      >
        {describeEventNamed(event, nameFor)}
      </Text>
    </View>
  );
}

/** Desktop: the frame's events as glass rows, newest last and lit. */
export function EventsRail({
  events,
  handNumber,
  nameFor,
  style,
}: {
  events: readonly EngineEvent[];
  handNumber: number;
  nameFor: (seat: Seat) => string;
  style?: ViewStyle;
}) {
  return (
    <View testID="replay-events" style={[glass({ radius: 16 }), { padding: 12, gap: 8 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={MICRO}>Events</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: MENU.hairlineSoft }} />
        <Text style={[MICRO, { color: MENU.goldMuted }]}>Hand {handNumber}</Text>
      </View>
      <ScrollView
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 2 }}
        showsVerticalScrollIndicator={false}
      >
        {events.length === 0 ? (
          <Text style={[TYPE.small, { paddingVertical: 4 }]}>No events on this frame yet.</Text>
        ) : (
          events.map((e, i) => {
            const latest = i === events.length - 1;
            return (
              <View
                // biome-ignore lint/suspicious/noArrayIndexKey: events array is stable per frame
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 5,
                  borderRadius: 8,
                  backgroundColor: latest ? MENU.goldTint : 'transparent',
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: latest ? MENU.goldHi : EVENT_DOT[eventKind(e)],
                  }}
                />
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: 15,
                    fontWeight: latest ? '800' : '600',
                    color: latest ? MENU.text : MENU.text2,
                    flexShrink: 1,
                  }}
                  numberOfLines={1}
                >
                  {describeEventNamed(e, nameFor)}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ─── Chrome buttons ─────────────────────────────────────────────────

/** Square glass icon button for the chrome row (back / export / delete). */
export function ChromeIconButton({
  icon,
  label,
  onPress,
  size = 44,
  danger = false,
  testID,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  size?: number;
  danger?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => ({
        ...glass({ radius: 12 }),
        borderColor: danger ? MENU.redEdge : pressed ? MENU.goldEdge : MENU.hairline,
        backgroundColor: pressed ? (danger ? MENU.redTint : 'rgba(24,34,28,0.75)') : MENU.glassBg,
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        ...HOVER_TRANSITION,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {icon}
    </Pressable>
  );
}

/** Transient glass pill (the export confirmation). */
export function ChromeToast({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        ...glass({ radius: 999, quiet: true }),
        paddingHorizontal: 12,
        paddingVertical: 7,
        flexShrink: 1,
        minWidth: 0,
      }}
    >
      <Text style={[MICRO, { color: MENU.goldHi }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}
