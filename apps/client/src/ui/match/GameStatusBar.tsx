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

const WIND_GLYPH: Record<Wind, string> = { E: '東', S: '南', W: '西', N: '北' };

const LOW_THRESHOLD = 14;

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  red: '#b14d3a',
  redHot: '#db5d4a',
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
        gap: 8,
        rowGap: 4,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: '#ecd9b8',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 12,
            fontWeight: '700',
            color: COLORS.red,
          }}
        >
          {WIND_GLYPH[prevailing]}
        </Text>
      </View>
      <Text
        style={{
          fontSize: 11,
          fontWeight: '800',
          color: COLORS.ink,
          letterSpacing: 0.3,
          flexShrink: 1,
          maxWidth: 110,
        }}
        numberOfLines={1}
      >
        {dealerName}
      </Text>
      <Text style={{ opacity: 0.3, color: COLORS.ink, fontSize: 10 }}>│</Text>
      <Text
        accessibilityLabel={`${wallCount} tiles remaining in wall`}
        style={{
          fontSize: 10,
          letterSpacing: 0.4,
          color: low ? '#b2503b' : COLORS.ink,
          fontWeight: '700',
        }}
      >
        {wallCount} tiles
      </Text>
      {isMyTurn ? (
        <View
          accessibilityLabel="Your turn"
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: COLORS.redHot,
            boxShadow: `0px 0px 4px ${COLORS.redHot}99`,
          }}
        />
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
        gap: 8,
        rowGap: 4,
        paddingVertical: 5,
        paddingLeft: 8,
        paddingRight: 10,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.88)',
        boxShadow: '0px 4px 16px rgba(0,0,0,0.1)',
      }}
    >
      {status}
      {trailing ? (
        <>
          <Text style={{ opacity: 0.3, color: COLORS.ink, fontSize: 10 }}>│</Text>
          {trailing}
        </>
      ) : null}
    </View>
  );
}
