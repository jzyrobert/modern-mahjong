import type { Action, Seat } from '@mahjong/game-logic';
import { nextDealer } from '@mahjong/game-logic';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useGame } from '../state/game';
import { RulePanel } from './RulePanel';
import { ScoringBreakdownModal } from './ScoringBreakdownModal';
import { GhostButton, PrimaryButton } from './buttons';

interface ResultPanelProps {
  onAction: (a: Action) => void;
  mySeat: Seat;
  isHost: boolean;
}

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  paper: '#f1ebe0',
  hairline: '#cdc1ad',
  red: '#b14d3a',
  gold: '#d8a85a',
};

/**
 * End-of-hand result. Native port of `_legacy/src/ui/ResultPanel.tsx`.
 * Wins show a one-line summary + a "View breakdown" button that opens
 * `ScoringBreakdownModal` with the per-pattern faan list.
 */
export function ResultPanel({ onAction, mySeat, isHost }: ResultPanelProps) {
  const state = useGame((s) => s.state);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
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
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <GhostButton onPress={() => setBreakdownOpen(true)}>View breakdown</GhostButton>
          </View>
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
          onPress={() => onAction({ t: 'startHand', seed: randomSeed(), dealer: dealerForNext })}
        >
          Start next hand
        </PrimaryButton>
        <Text style={{ fontSize: 12, color: COLORS.ink3 }}>
          (seat {mySeat}; next dealer: seat {dealerForNext})
        </Text>
      </View>

      {r.kind === 'win' ? (
        <ScoringBreakdownModal
          open={breakdownOpen}
          onClose={() => setBreakdownOpen(false)}
          result={r}
          faanMin={state.rules.faanMin}
        />
      ) : null}
    </View>
  );
}

function randomSeed(): number {
  // Mirrors the override in Match.tsx so e2e tests can pin both the
  // first hand's seed (lobby button) and subsequent hands' seeds
  // (this button) to the same deterministic value.
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __MAHJONG_TEST_SEED__?: number })
      .__MAHJONG_TEST_SEED__;
    if (typeof override === 'number') return override;
  }
  return Math.floor(Math.random() * 0xffffffff);
}
