import type { Action, Seat } from '@mahjong/game-logic';
import { nextDealer } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import { useGame } from '../state/game';
import { GhostButton, PrimaryButton } from './buttons';
import { RulePanel } from './RulePanel';

interface ResultPanelProps {
  onAction: (a: Action) => void;
  mySeat: Seat;
  isHost: boolean;
}

const COLORS = {
  ink: 'oklch(0.25 0.04 60)',
  ink3: 'oklch(0.55 0.04 60)',
  paper: 'oklch(0.97 0.01 80)',
  hairline: 'oklch(0.86 0.02 80)',
  red: 'oklch(0.55 0.18 25)',
  gold: 'oklch(0.78 0.14 80)',
};

/**
 * End-of-hand result. Native port of `_legacy/src/ui/ResultPanel.tsx`.
 * The `ScoringBreakdownModal` integration is deferred — for now the
 * faan breakdown surfaces inline as a list. Phase 6 cleanup adds the
 * modal.
 */
export function ResultPanel({ onAction, mySeat, isHost }: ResultPanelProps) {
  const state = useGame((s) => s.state);
  if (!state || !state.lastResult) return null;
  const r = state.lastResult;
  const dealerForNext = nextDealer(state);

  return (
    <View
      style={{
        marginTop: 16,
        padding: 14,
        backgroundColor: COLORS.paper,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        gap: 10,
      }}
    >
      {r.kind === 'win' ? (
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.ink }}>
            Seat {r.winner} wins!
          </Text>
          <Text style={{ fontSize: 13, color: COLORS.ink3 }}>
            {r.faan} faan ({r.selfDraw ? 'self-draw 自摸' : `from seat ${r.from}`})
          </Text>
          {r.breakdown.length > 0 ? (
            <View style={{ marginTop: 6, gap: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.ink3 }}>Breakdown</Text>
              {r.breakdown.map((b, i) => (
                <View
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable for the duration of this hand
                  key={`${b.name}-${i}`}
                  style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                >
                  <Text style={{ fontSize: 12, color: COLORS.ink }}>
                    {b.name} <Text style={{ color: COLORS.ink3 }}>· {b.english}</Text>
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.red }}>
                    +{b.faan}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.ink }}>
          Drawn game (wall empty)
        </Text>
      )}

      <RulePanel rules={state.rules} isHost={isHost} onAction={onAction} />

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <PrimaryButton
          disabled={!isHost}
          onPress={() =>
            onAction({ t: 'startHand', seed: randomSeed(), dealer: dealerForNext })
          }
        >
          Start next hand
        </PrimaryButton>
        <Text style={{ fontSize: 12, color: COLORS.ink3 }}>
          (seat {mySeat}; next dealer: seat {dealerForNext})
        </Text>
      </View>
    </View>
  );
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}
