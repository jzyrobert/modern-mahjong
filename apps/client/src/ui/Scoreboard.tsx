import { SEATS } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import { nameForSeat, useGame } from '../state/game';

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  paper: '#f1ebe0',
  hairline: '#cdc1ad',
  red: '#b14d3a',
};

export function Scoreboard() {
  const state = useGame((s) => s.state);
  const lobby = useGame((s) => s.lobby);
  if (!state) return null;

  // At the start of a hand every score is 0 — the row would just say
  // "Scoreboard P1: 0 P2: 0 P3: 0 P4: 0", which is noise that eats
  // ~25% of the phone's vertical space before any tile information
  // shows up. Skip rendering until at least one score moves; the
  // dealer marker is already on `GameStatusBar` so nothing is lost.
  const allZero = SEATS.every((s) => state.scoreboard[s] === 0);
  if (allZero) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: COLORS.paper,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 6,
      }}
    >
      {SEATS.map((s) => {
        const isDealer = s === state.dealer;
        return (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Text style={{ fontSize: 13, color: isDealer ? COLORS.red : COLORS.ink }}>
              {nameForSeat(lobby, s)}:
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.ink }}>
              {state.scoreboard[s]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
