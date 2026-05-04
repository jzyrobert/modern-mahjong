import { SEATS } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import { nameForSeat, useGame } from '../state/game';

const COLORS = {
  ink: 'oklch(0.25 0.04 60)',
  ink3: 'oklch(0.55 0.04 60)',
  paper: 'oklch(0.97 0.01 80)',
  hairline: 'oklch(0.86 0.02 80)',
  red: 'oklch(0.55 0.18 25)',
};

export function Scoreboard() {
  const state = useGame((s) => s.state);
  const lobby = useGame((s) => s.lobby);
  if (!state) return null;

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
      <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.ink }}>Scoreboard</Text>
      {SEATS.map((s) => {
        const isDealer = s === state.dealer;
        return (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Text style={{ fontSize: 13, color: COLORS.ink }}>{nameForSeat(lobby, s)}:</Text>
            <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.ink }}>
              {state.scoreboard[s]}
            </Text>
            {isDealer ? (
              <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.red }}>(dealer)</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
