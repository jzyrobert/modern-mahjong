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
