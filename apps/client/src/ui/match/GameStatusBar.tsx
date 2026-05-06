import type { Wind } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

interface GameStatusBarProps {
  prevailing: Wind;
  dealerName: string;
  wallCount: number;
  isMyTurn: boolean;
  /** Optional — when provided, the whole pill becomes a Pressable
   *  that opens the players bottom-sheet on tap. Wired from
   *  `Match.tsx`; surfaces a roster + scores without consuming
   *  another TopBar slot. */
  onPress?: () => void;
  /** Optional content rendered at the right edge of the pill, separated
   *  from the status content by a hairline. `MobileShell` uses this to
   *  absorb the standalone `TopBar`'s LIVE indicator + ☰ menu button so
   *  the chrome stays a single row on phone-class viewports — at 320 px
   *  the two pills couldn't fit side-by-side and the outer flex wrapped
   *  the menu button onto its own line, eating ~50 px of vertical space.
   *  Desktop leaves this unset and continues to render `TopBar`
   *  separately (the perimeter felt has horizontal room to spare). */
  trailing?: ReactNode;
}

const WIND_NAME: Record<Wind, string> = {
  E: 'EAST',
  S: 'SOUTH',
  W: 'WEST',
  N: 'NORTH',
};

const WIND_GLYPH: Record<Wind, string> = { E: '東', S: '南', W: '西', N: '北' };

const WALL_FULL = 70;
const LOW_THRESHOLD = 14;

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  red: '#b14d3a',
  redHot: '#db5d4a',
  green: '#58c280',
  hairline: '#cdc1ad',
};

/**
 * Top-of-table status pill — prevailing wind glyph, round/dealer
 * label, live wall depletion bar, and a "YOUR TURN" indicator when
 * on the move. The legacy backdrop-filter blur becomes a plain
 * semi-opaque background; expo-blur can replace it later.
 */
export function GameStatusBar({
  prevailing,
  dealerName,
  wallCount,
  isMyTurn,
  onPress,
  trailing,
}: GameStatusBarProps) {
  const pct = Math.max(0, Math.min(100, (wallCount / WALL_FULL) * 100));
  const low = wallCount <= LOW_THRESHOLD;
  const Container = onPress ? Pressable : View;
  // Press surface is the status content itself, NOT the outer pill —
  // when `trailing` contains nested Pressables (the mobile chrome's ☰
  // button), nesting them inside an outer Pressable would fire both
  // handlers on tap (react-native-web doesn't stop click propagation
  // automatically), so the players sheet would open behind the menu
  // sheet. Splitting the press surface from the trailing slot keeps
  // each tap target isolated.
  const status = (
    <Container
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? 'Open players panel' : undefined}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        flexShrink: 1,
        gap: 10,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: '#ecd9b8',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 14,
            fontWeight: '700',
            color: COLORS.red,
          }}
        >
          {WIND_GLYPH[prevailing]}
        </Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.ink, letterSpacing: 0.5 }}>
          {WIND_NAME[prevailing]} ROUND
        </Text>
        <Text style={{ fontSize: 9, fontWeight: '700', color: COLORS.ink3, letterSpacing: 0.4 }}>
          {dealerName} dealing
        </Text>
      </View>
      <Text style={{ opacity: 0.3, color: COLORS.ink }}>│</Text>
      <View style={{ gap: 3, alignItems: 'flex-start' }}>
        <Text
          style={{
            fontSize: 10,
            letterSpacing: 0.4,
            color: low ? '#b2503b' : COLORS.ink,
            fontWeight: '700',
          }}
        >
          {wallCount} tiles in wall
        </Text>
        <View
          style={{
            width: 90,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#e9e0d2',
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${pct}%`,
              height: '100%',
              backgroundColor: low ? '#e07555' : COLORS.green,
            }}
          />
        </View>
      </View>
      {isMyTurn ? (
        <>
          <Text style={{ opacity: 0.3, color: COLORS.ink }}>│</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: COLORS.redHot,
                boxShadow: `0px 0px 4px ${COLORS.redHot}99`,
              }}
            />
            <Text
              style={{ color: COLORS.red, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}
            >
              YOUR TURN
            </Text>
          </View>
        </>
      ) : null}
    </Container>
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        flexShrink: 1,
        gap: 10,
        paddingVertical: 7,
        paddingLeft: 10,
        paddingRight: 14,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.88)',
        boxShadow: '0px 4px 16px rgba(0,0,0,0.1)',
      }}
    >
      {status}
      {trailing ? (
        <>
          <Text style={{ opacity: 0.3, color: COLORS.ink }}>│</Text>
          {trailing}
        </>
      ) : null}
    </View>
  );
}
