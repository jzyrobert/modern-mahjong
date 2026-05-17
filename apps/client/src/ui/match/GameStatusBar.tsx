import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { COLORS, PANEL_ON_FELT } from '../colors';

interface GameStatusBarProps {
  /** Wind glyph (東/南/西/北) to render in the leading circle. The
   *  caller picks which wind to surface — active-player shells pass
   *  the user's own seat wind so the pill mirrors the user's identity;
   *  the spectator view passes the prevailing round wind. */
  windGlyph: string;
  /** Background colour of the wind circle — the user's seat colour for
   *  active players (coral, since the user is always bottom-position),
   *  or a neutral cream for spectators. */
  windBg: string;
  /** Glyph text colour. White-on-coral for the user identity; brand red
   *  on cream for the spectator/dealer fallback. */
  windFg: string;
  /** Name shown next to the wind circle — the user's display name when
   *  surfacing identity, the dealer name for spectator views. */
  name: string;
  wallCount: number;
  isMyTurn: boolean;
  /** Whole seconds remaining until `state.turnDeadlineMs` for the
   *  user. Rendered alongside the "Your turn" dot as "Ns left" when
   *  set; null when the rule is off, in solo with timer disabled, or
   *  outside `phase: 'turn'`. The mobile shell has no PlayerBadge for
   *  the user's own seat (the felt's bottom is just `Hand` + sort
   *  picker), so this pill is the only place a self-turn countdown
   *  can surface on phone widths. */
  turnCountdown?: number | null;
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
  /** Optional inline-scores slot — when given, renders a hairline
   *  divider followed by the supplied node (typically per-seat chips
   *  like 東:+12 南:-4). Lets PortraitShell collapse the standalone
   *  `Scoreboard` card into the status pill, recovering ~40 px of
   *  vertical space without a separate row. */
  inlineScores?: ReactNode;
}

/** Wall depth at or below which the wall-count chip turns red — surfaced as
 *  an exported constant so `MobileShell.tsx`'s landscape `RailStatusCard`
 *  uses the same threshold instead of inlining its own. */
export const WALL_LOW_THRESHOLD = 14;

/**
 * Top-of-table status pill — wind glyph in a seat-coloured circle, the
 * player's name, live wall depletion bar, and a "YOUR TURN" indicator
 * when on the move. Active-match shells fill the identity slot with the
 * user's own seat wind + colour + display name so the pill mirrors the
 * "you" identity; the spectator view repurposes the same slot for the
 * prevailing round wind + dealer name.
 */
export function GameStatusBar({
  windGlyph,
  windBg,
  windFg,
  name,
  wallCount,
  isMyTurn,
  turnCountdown = null,
  onPress,
  trailing,
  inlineScores,
}: GameStatusBarProps) {
  const low = wallCount <= WALL_LOW_THRESHOLD;
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
          backgroundColor: windBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 12,
            fontWeight: '700',
            color: windFg,
          }}
        >
          {windGlyph}
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
        {name}
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
      {isMyTurn ? (
        <Text
          style={{
            fontSize: 10,
            fontWeight: '800',
            color: COLORS.red,
            letterSpacing: 0.4,
          }}
          accessibilityLabel={
            turnCountdown !== null ? `${turnCountdown} seconds left in your turn` : 'No turn timer'
          }
        >
          {turnCountdown !== null ? `${turnCountdown}s left` : '∞'}
        </Text>
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
        ...PANEL_ON_FELT,
      }}
    >
      {status}
      {inlineScores ? (
        <>
          <Text style={{ opacity: 0.3, color: COLORS.ink, fontSize: 10 }}>│</Text>
          {inlineScores}
        </>
      ) : null}
      {trailing ? (
        <>
          <Text style={{ opacity: 0.3, color: COLORS.ink, fontSize: 10 }}>│</Text>
          {trailing}
        </>
      ) : null}
    </View>
  );
}
