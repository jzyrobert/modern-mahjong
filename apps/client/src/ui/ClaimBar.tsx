import type { Action, Claim, Seat } from '@mahjong/game-logic';
import { isWinning, legalClaimsFor } from '@mahjong/game-logic';
import { Pressable, Text, View } from 'react-native';
import { useGame } from '../state/game';

interface ClaimBarProps {
  onAction: (a: Action) => void;
  seat: Seat;
}

type CallKind = 'chi' | 'peng' | 'gong' | 'hu' | 'pass';
type Tone = 'jade' | 'blue' | 'plum' | 'gold' | 'cream';

const LABELS: Record<CallKind, { en: string; zh: string; tone: Tone }> = {
  chi: { en: 'Chow', zh: '吃', tone: 'jade' },
  peng: { en: 'Pung', zh: '碰', tone: 'blue' },
  gong: { en: 'Kong', zh: '槓', tone: 'plum' },
  hu: { en: 'Win', zh: '糊', tone: 'gold' },
  pass: { en: 'Pass', zh: '過', tone: 'cream' },
};

// Per-action colours — closer to the legacy CallButton's per-kind
// gradient-by-hue palette. RN can't render the original 135° linear
// gradients without an extra package, so we approximate with a flat
// hex + a darker pressed state + an inner shadow on press.
const TONE: Record<Tone, { bg: string; pressed: string; fg: string }> = {
  jade: { bg: '#58c280', pressed: '#4ba668', fg: 'white' },
  blue: { bg: '#5b9ad9', pressed: '#467fbf', fg: 'white' },
  plum: { bg: '#9d6dc7', pressed: '#7e54a8', fg: 'white' },
  gold: { bg: '#dc9f4f', pressed: '#c98a37', fg: '#3a3328' },
  cream: { bg: '#ece4d3', pressed: '#d8cdb4', fg: '#3a3328' },
};

const ORDER: readonly CallKind[] = ['chi', 'peng', 'gong', 'hu', 'pass'];

/**
 * Claim flow buttons.
 *
 * Renders one button per legal claim kind for this seat against the
 * current discard. `pass` is always offered (legalClaimsFor already
 * includes it during awaitingClaims). `hu` is offered only when the
 * seat actually has a winning hand against the discarded tile —
 * `legalClaimsFor` deliberately omits `hu` because it depends on
 * shanten + scoring, so we run `isWinning` here against the
 * `hand + discard` projection. `chi` is suppressed until the meld
 * picker UI lands (submitting a chi needs the user to pick the two
 * completing tiles).
 */
export function ClaimBar({ onAction, seat }: ClaimBarProps) {
  const state = useGame((s) => s.state);
  const legal = new Set<CallKind>(state ? legalClaimsFor(state, seat) : []);
  if (state?.lastDiscard && state.lastDiscard.from !== seat) {
    const allowSpecial = state.rules.allowSevenPairs || state.rules.allowThirteenOrphans;
    const winnable = isWinning({
      hand: [...state.hands[seat], state.lastDiscard.tile],
      exposedMelds: state.melds[seat].length,
      allowSpecial,
    });
    if (winnable) legal.add('hu');
  }
  const visible = ORDER.filter((k) => legal.has(k)).filter((k) => k !== 'chi');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: 12,
        backgroundColor: '#fbf8f0',
        borderColor: '#cdc1ad',
        borderWidth: 1,
        borderRadius: 12,
        boxShadow: '0px 4px 12px rgba(0,0,0,0.08)',
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '800', color: '#918275', letterSpacing: 0.5 }}>
        CLAIM?
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {visible.map((kind) => (
          <CallButton
            key={kind}
            kind={kind}
            onPress={() => onAction({ t: 'declareClaim', seat, claim: claimFor(kind) })}
          />
        ))}
      </View>
    </View>
  );
}

function CallButton({ kind, onPress }: { kind: CallKind; onPress: () => void }) {
  const meta = LABELS[kind];
  const tone = TONE[meta.tone];
  const isCream = meta.tone === 'cream';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? tone.pressed : tone.bg,
        paddingVertical: 10,
        paddingHorizontal: 18,
        borderRadius: 14,
        borderWidth: isCream ? 1.5 : 0,
        borderColor: isCream ? '#cdc1ad' : 'transparent',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        boxShadow: isCream ? 'none' : '0px 4px 6px rgba(0,0,0,0.18)',
      })}
    >
      <Text
        style={{ fontFamily: 'Noto Serif TC', fontSize: 18, fontWeight: '700', color: tone.fg }}
      >
        {meta.zh}
      </Text>
      <Text
        style={{
          fontSize: 12,
          fontWeight: '900',
          color: tone.fg,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
        }}
      >
        {meta.en}
      </Text>
    </Pressable>
  );
}

function claimFor(kind: Exclude<CallKind, 'chi'>): Claim {
  // chi requires the two completing tiles — UI-side picker not built
  // yet. Other kinds are bare tags.
  return { kind } as Claim;
}
