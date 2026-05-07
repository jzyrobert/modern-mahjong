import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import { nextDealer, sameTile, sortHand, tileId } from '@mahjong/game-logic';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useGame } from '../state/game';
import { randomSeed } from '../util';
import { RulePanel } from './RulePanel';
import { ScoringBreakdownModal } from './ScoringBreakdownModal';
import { Tile } from './Tile';
import { GhostButton, PrimaryButton } from './buttons';
import { COLORS } from './colors';
import { MeldStrip } from './match/MeldStrip';

interface ResultPanelProps {
  onAction: (a: Action) => void;
  mySeat: Seat;
  isHost: boolean;
}

/**
 * End-of-hand result.
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
          <WinningHand winner={r.winner} winningTile={r.tile} />
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

/**
 * Winning hand display for the result panel: the winner's exposed
 * melds (in claim order — chi tiles already arrive sorted), followed
 * by the concealed strip in canonical hand-display order (man <
 * pin < sou < honors), with the winning tile highlighted by a
 * gold-tinted frame the way the catalog example hands do. Reads
 * directly from `state.hands[winner]` (which post-fix includes the
 * winning tile) so the source of truth is the engine's resolved
 * state rather than re-deriving from `lastResult`.
 */
function WinningHand({ winner, winningTile }: { winner: Seat; winningTile: MTile }) {
  const state = useGame((s) => s.state);
  if (!state) return null;
  const concealed = sortHand(state.hands[winner]);
  const melds = state.melds[winner];
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      {melds.length > 0 ? <MeldStrip melds={melds} tileWidth={22} tileHeight={30} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
        {concealed.map((t) => {
          // `sameTile` matches by id (suit/rank + copy), so only the
          // exact physical winning tile gets the gold frame even when
          // the winner holds another copy of the same face.
          const isWin = sameTile(t, winningTile);
          if (isWin) {
            return (
              <View
                key={tileId(t)}
                style={{
                  padding: 2,
                  borderRadius: 4,
                  backgroundColor: '#fff5d6',
                  borderColor: '#d4a73a',
                  borderWidth: 1,
                }}
              >
                <Tile tile={t} width={26} height={36} />
              </View>
            );
          }
          return <Tile key={tileId(t)} tile={t} width={26} height={36} />;
        })}
      </View>
    </View>
  );
}
