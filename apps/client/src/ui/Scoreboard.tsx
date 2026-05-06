import { SEATS, type Wind, seatWindFor } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import { useGame } from '../state/game';

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  paper: '#f1ebe0',
  hairline: '#cdc1ad',
  red: '#b14d3a',
};

const WIND_GLYPH: Record<Wind, string> = { E: '東', S: '南', W: '西', N: '北' };

/**
 * Compact running-score chip strip — one entry per seat showing the
 * seat's relative wind glyph (always East-anchored at the dealer, so
 * dealer rotation reads visually) and the score. Names live in the
 * players sheet (`tap the GameStatusBar pill`); on phones, repeating
 * `"Bot (passive)"` 3× across the row consumed two lines and drowned
 * out the actual scores. Two stylistic cues distinguish the four
 * chips: dealer's glyph is red, and the user's own chip carries a
 * subtle `(you)` tag so the user can spot their own running total at
 * a glance.
 */
export function Scoreboard() {
  const state = useGame((s) => s.state);
  const you = useGame((s) => s.you);
  if (!state) return null;

  // At the start of a hand every score is 0 — the row would just say
  // "東: 0 南: 0 西: 0 北: 0", which is noise that eats vertical space
  // before any tile information shows up. Skip rendering until at
  // least one score moves; the dealer marker is already on the
  // GameStatusBar so nothing is lost.
  const allZero = SEATS.every((s) => state.scoreboard[s] === 0);
  if (allZero) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 6,
        paddingHorizontal: 10,
        backgroundColor: COLORS.paper,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 6,
      }}
    >
      {SEATS.map((s) => {
        const isDealer = s === state.dealer;
        const isYou = typeof you === 'number' && s === you;
        const seatWind = seatWindFor(state.dealer, s);
        return (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Text
              style={{
                fontFamily: 'Noto Serif TC',
                fontSize: 14,
                fontWeight: '700',
                color: isDealer ? COLORS.red : COLORS.ink,
              }}
            >
              {WIND_GLYPH[seatWind]}
            </Text>
            {isYou ? (
              <Text style={{ fontSize: 9, color: COLORS.ink3, fontWeight: '700' }}>(you)</Text>
            ) : null}
            <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.ink }}>
              {state.scoreboard[s]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
