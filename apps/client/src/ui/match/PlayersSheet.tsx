import { SEATS, type Seat, type Wind, seatWindFor } from '@mahjong/game-logic';
import { ScrollView, Text, View } from 'react-native';
import { type LobbyState, nameForSeat, useGame } from '../../state/game';
import { Modal } from '../Modal';

interface PlayersSheetProps {
  open: boolean;
  onClose: () => void;
  /** The local player's seat — gets a "you" badge and the avatar
   *  picks up the bottom-seat colour. Spectators / pre-seat callers
   *  pass `null`. */
  mySeat: Seat | null;
}

const WIND_GLYPH: Record<Wind, string> = { E: '東', S: '南', W: '西', N: '北' };
const WIND_NAME: Record<Wind, string> = { E: 'East', S: 'South', W: 'West', N: 'North' };

// Seat colours mirror the perimeter layout (`PlayerBadge.SEAT_COLOR`):
// the player at the bottom of the table is red-orange, opponents
// rotate through jade / lavender / blue. The mapping here is by
// *relative* seat (you / next / across / prev) so swapping host /
// guest seats still surfaces the right colour for each badge.
const RELATIVE_COLOR: Record<'you' | 'next' | 'across' | 'prev', string> = {
  you: '#de7660',
  next: '#5db698',
  across: '#c581b7',
  prev: '#729fc6',
};

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
  red: '#b14d3a',
  green: '#58c280',
  gold: '#d8a85a',
};

/**
 * Bottom-sheet roster of every seat in the current match. Opens from
 * the match `TopBar`'s 📋 button. Each row carries the seat's
 * coloured avatar, display name, seat-wind glyph + name, dealer
 * badge, cumulative faan score, and a soft "your turn" highlight
 * for the seat the engine's currently waiting on. Mirrors the
 * `Scoreboard` data + `PlayerBadge` styling, but laid out vertically
 * so on a portrait phone every player is visible at once without
 * the player needing to interpret the perimeter layout.
 */
export function PlayersSheet({ open, onClose, mySeat }: PlayersSheetProps) {
  const state = useGame((s) => s.state);
  const lobby = useGame((s) => s.lobby);

  return (
    <Modal open={open} title="Players" onClose={onClose} placement="bottom" maxWidth={520}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 28, gap: 10 }}>
        {state ? (
          <View style={{ gap: 8 }}>
            {SEATS.map((seat) => (
              <PlayerRow
                key={seat}
                seat={seat}
                lobby={lobby}
                score={state.scoreboard[seat]}
                isDealer={state.dealer === seat}
                isActive={state.phase === 'turn' && state.turn === seat}
                isMe={mySeat === seat}
                seatWind={seatWindFor(state.dealer, seat)}
                relativeKey={relativeKey(mySeat, seat)}
              />
            ))}
          </View>
        ) : (
          <Text style={{ fontSize: 13, color: COLORS.ink3, fontWeight: '600' }}>
            Waiting for the match to start.
          </Text>
        )}
      </ScrollView>
    </Modal>
  );
}

interface PlayerRowProps {
  seat: Seat;
  lobby: LobbyState | null;
  score: number;
  isDealer: boolean;
  isActive: boolean;
  isMe: boolean;
  seatWind: Wind;
  relativeKey: 'you' | 'next' | 'across' | 'prev';
}

function PlayerRow({
  seat,
  lobby,
  score,
  isDealer,
  isActive,
  isMe,
  seatWind,
  relativeKey,
}: PlayerRowProps) {
  const name = nameForSeat(lobby, seat);
  const initials = computeInitials(name);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: COLORS.paperHi,
        borderWidth: isActive ? 2 : 1,
        borderColor: isActive ? COLORS.gold : COLORS.hairline,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: RELATIVE_COLOR[relativeKey],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: 'white', fontWeight: '800', fontSize: 13 }}>{initials}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: 14, fontWeight: '900', color: COLORS.ink, maxWidth: 200 }}
          >
            {name}
          </Text>
          {isMe ? (
            <Text
              style={{
                fontSize: 9,
                fontWeight: '900',
                color: COLORS.green,
                letterSpacing: 0.6,
              }}
            >
              YOU
            </Text>
          ) : null}
          {isDealer ? (
            <Text
              style={{
                fontSize: 9,
                fontWeight: '900',
                color: COLORS.red,
                letterSpacing: 0.6,
              }}
            >
              DEALER
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={{ fontFamily: 'Noto Serif TC', fontSize: 13, color: COLORS.red }}>
            {WIND_GLYPH[seatWind]}
          </Text>
          <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '700' }}>
            {WIND_NAME[seatWind]} · seat {seat}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.ink }}>{score}</Text>
        <Text style={{ fontSize: 9, color: COLORS.ink3, fontWeight: '700', letterSpacing: 0.4 }}>
          FAAN
        </Text>
      </View>
      {isActive ? (
        <View
          style={{
            position: 'absolute',
            top: -8,
            right: 16,
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 8,
            backgroundColor: COLORS.gold,
          }}
        >
          <Text style={{ fontSize: 9, fontWeight: '900', color: COLORS.ink, letterSpacing: 0.6 }}>
            ON THE MOVE
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function relativeKey(mySeat: Seat | null, seat: Seat): 'you' | 'next' | 'across' | 'prev' {
  if (mySeat === null)
    return seat === 0 ? 'you' : seat === 1 ? 'next' : seat === 2 ? 'across' : 'prev';
  const offset = (seat - mySeat + 4) % 4;
  if (offset === 0) return 'you';
  if (offset === 1) return 'next';
  if (offset === 2) return 'across';
  return 'prev';
}

function computeInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
