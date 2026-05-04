import type { Action, Claim, Seat } from '@mahjong/game-logic';
import { legalClaimsFor } from '@mahjong/game-logic';
import { Pressable, Text, View } from 'react-native';
import { useGame } from '../state/game';

interface ClaimBarProps {
  onAction: (a: Action) => void;
  seat: Seat;
}

type CallKind = 'chi' | 'peng' | 'gong' | 'hu' | 'pass';

const LABELS: Record<CallKind, { en: string; zh: string; tone: 'red' | 'gold' | 'jade' | 'slate' }> = {
  chi: { en: 'Chow', zh: '吃', tone: 'jade' },
  peng: { en: 'Pung', zh: '碰', tone: 'gold' },
  gong: { en: 'Kong', zh: '槓', tone: 'red' },
  hu: { en: 'Win', zh: '糊', tone: 'red' },
  pass: { en: 'Pass', zh: '過', tone: 'slate' },
};

const TONE: Record<'red' | 'gold' | 'jade' | 'slate', { bg: string; pressed: string; fg: string }> = {
  red: { bg: 'oklch(0.55 0.18 25)', pressed: 'oklch(0.62 0.2 28)', fg: 'white' },
  gold: { bg: 'oklch(0.78 0.16 75)', pressed: 'oklch(0.72 0.18 70)', fg: 'oklch(0.25 0.04 60)' },
  jade: { bg: 'oklch(0.7 0.14 150)', pressed: 'oklch(0.65 0.16 145)', fg: 'white' },
  slate: { bg: 'oklch(0.65 0.02 240)', pressed: 'oklch(0.55 0.03 240)', fg: 'white' },
};

const ORDER: readonly CallKind[] = ['chi', 'peng', 'gong', 'hu', 'pass'];

/**
 * Claim flow buttons. Native port of `_legacy/src/ui/ClaimBar.tsx`.
 *
 * Renders one button per legal claim kind for this seat against the
 * current discard. `hu` and `pass` are always shown (server validates
 * winning hands; pass is always legal). `chi` is shown when chi is
 * legal — but submitting a chi requires picking the two completing
 * tiles in hand, which we don't have UI for yet, so we drop it from
 * the rendered set until Phase 4 polish wires up the picker. Until
 * then chi → just doesn't appear.
 */
export function ClaimBar({ onAction, seat }: ClaimBarProps) {
  const state = useGame((s) => s.state);
  const legal = new Set<CallKind>(state ? legalClaimsFor(state, seat) : []);
  legal.add('hu');
  legal.add('pass');
  const visible = ORDER.filter((k) => legal.has(k)).filter((k) => k !== 'chi');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: 12,
        backgroundColor: 'oklch(0.99 0.005 85)',
        borderColor: 'oklch(0.86 0.02 80)',
        borderWidth: 1,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '800', color: 'oklch(0.55 0.04 60)', letterSpacing: 0.5 }}>
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
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? tone.pressed : tone.bg,
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
      })}
    >
      <Text style={{ fontFamily: 'Noto Serif TC', fontSize: 18, fontWeight: '700', color: tone.fg }}>
        {meta.zh}
      </Text>
      <Text style={{ fontSize: 12, fontWeight: '800', color: tone.fg, letterSpacing: 0.4 }}>
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
