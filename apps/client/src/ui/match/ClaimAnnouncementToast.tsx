import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { type ClaimMeldKind, nameForSeat, useGame } from '../../state/game';
import { COLORS } from '../colors';

const TOAST_DURATION_MS = 2_200;
/** Glass theme holds a beat longer — the card is the only cue that a claim happened. */
const GLASS_TOAST_DURATION_MS = 2_800;

const KIND_LABEL: Record<ClaimMeldKind, { en: string; zh: string }> = {
  chi: { en: 'CHI', zh: '吃' },
  peng: { en: 'PENG', zh: '碰' },
  gang: { en: 'GANG', zh: '槓' },
};

/**
 * Center-top toast that flashes when an opponent (or the user) lands
 * a chi / peng / gang on the live discard. Today the only on-screen
 * cue was a meld silently appearing in the seat's exposed row and a
 * GameLog entry the user has to open the menu to see — easy to miss
 * on mobile where the meld strips are compressed.
 *
 * Sourced off `useGame.claimAnnouncement`: the seq counter dedupes
 * back-to-back announcements (rare but possible during a fast bot
 * round), the seat + kind tell us who claimed what. The seat name
 * is read from `useGame.lobby` so the toast reads "Lin called Peng"
 * rather than "Seat 2 called Peng".
 *
 * Auto-dismisses after `TOAST_DURATION_MS`. Pinned to the top of the
 * felt with absolute positioning so it floats over the table without
 * re-flowing the layout (any open `ClaimBar` / `ClaimMissedToast` is
 * still in flight when this fires).
 */
export type ClaimToastTheme = 'paper' | 'glass';

interface ClaimAnnouncementToastProps {
  /** `glass` is the dark translucent card the Three.js HUD uses. */
  theme?: ClaimToastTheme;
  /** Distance from the shell's top edge, px (default 56). */
  top?: number;
}

const THEMES = {
  paper: {
    bg: COLORS.paperHi,
    border: COLORS.gold,
    borderWidth: 2,
    glyph: COLORS.red,
    label: COLORS.ink3,
    text: COLORS.ink,
    shadow: '0px 6px 16px rgba(0,0,0,0.28)',
  },
  glass: {
    // Near-opaque: on phone portrait the toast rides the seat-strip row
    // over the far seat's badge, whose text must not bleed through.
    bg: 'rgba(14,20,17,0.97)',
    border: 'rgba(216,168,90,0.7)',
    borderWidth: 1,
    glyph: '#d8a85a',
    label: 'rgba(255,255,255,0.7)',
    text: 'rgba(255,255,255,0.96)',
    shadow:
      '0px 0px 0px 3px rgba(216,168,90,0.16), 0px 0px 32px rgba(216,168,90,0.28), 0px 12px 40px rgba(0,0,0,0.45)',
  },
} as const;

export function ClaimAnnouncementToast({ theme = 'paper', top = 56 }: ClaimAnnouncementToastProps) {
  const pal = THEMES[theme];
  const announcement = useGame((s) => s.claimAnnouncement);
  const lobby = useGame((s) => s.lobby);
  const youSeat = useGame((s) => s.you);
  const [visible, setVisible] = useState(false);
  const [pinned, setPinned] = useState<typeof announcement>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissHandle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Seed from the current announcement seq so a remount after a claim
  // has already fired doesn't re-flash the same toast on the next
  // store notification. With a hard-coded `0` seed, any non-null
  // `claimAnnouncement` (i.e. a peng that already happened earlier in
  // the hand) would re-fire the moment React mounted this component
  // again — the symptom users saw was the PENG toast popping back up
  // on every subsequent move once one claim had landed. Mirrors the
  // `ClaimMissedToast.lastSeq` pattern in the sibling file.
  const lastSeq = useRef(announcement?.seq ?? 0);

  useEffect(() => {
    if (!announcement) return;
    if (announcement.seq === lastSeq.current) return;
    lastSeq.current = announcement.seq;
    // Pin the current announcement so the toast keeps the right text
    // even after the store updates (re-pinning on every flash is what
    // makes consecutive claims overwrite cleanly).
    setPinned(announcement);
    setVisible(true);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
      easing: Easing.out(Easing.ease),
    }).start();
    if (dismissHandle.current !== null) clearTimeout(dismissHandle.current);
    dismissHandle.current = setTimeout(
      () => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
          easing: Easing.in(Easing.ease),
        }).start(() => setVisible(false));
      },
      theme === 'glass' ? GLASS_TOAST_DURATION_MS : TOAST_DURATION_MS,
    );
    return () => {
      if (dismissHandle.current !== null) clearTimeout(dismissHandle.current);
    };
  }, [announcement, opacity, theme]);

  if (!visible || !pinned) return null;
  const seatName = youSeat === pinned.seat ? 'You' : nameForSeat(lobby, pinned.seat);
  const label = KIND_LABEL[pinned.kind];
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 60,
      }}
    >
      <Animated.View
        style={{
          opacity,
          backgroundColor: pal.bg,
          borderColor: pal.border,
          borderWidth: pal.borderWidth,
          borderRadius: theme === 'glass' ? 18 : 14,
          // Glass: 7 + 32 + 7 (+ border) ≈ 48 px — the chrome row's height,
          // so the landscape toast slot never runs onto the far wall.
          paddingVertical: theme === 'glass' ? 7 : 10,
          paddingHorizontal: theme === 'glass' ? 20 : 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme === 'glass' ? 14 : 10,
          boxShadow: pal.shadow,
        }}
      >
        <Text
          testID="claim-toast-glyph"
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: theme === 'glass' ? 30 : 22,
            fontWeight: '800',
            color: pal.glyph,
            lineHeight: theme === 'glass' ? 32 : 26,
          }}
        >
          {label.zh}
        </Text>
        <View style={{ flexDirection: 'column' }}>
          <Text
            style={{
              fontSize: theme === 'glass' ? 12 : 11,
              fontWeight: '900',
              color: theme === 'glass' ? pal.glyph : pal.label,
              letterSpacing: theme === 'glass' ? 2.2 : 0.6,
            }}
          >
            {label.en}
          </Text>
          <Text
            style={{
              fontSize: theme === 'glass' ? 15 : 13,
              fontWeight: '800',
              color: pal.text,
            }}
          >
            {seatName} called
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}
