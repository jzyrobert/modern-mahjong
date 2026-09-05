import { SEATS, type Seat, type Wind, seatWindFor } from '@mahjong/game-logic';
import { type BotKind, botDisplayName } from '@mahjong/protocol';
import { ScrollView, Text, View } from 'react-native';
import { type LobbyState, nameForSeat, playerForSeat, useGame } from '../../state/game';
import { computeInitials } from '../../util';
import { Modal } from '../Modal';
import { COLORS } from '../colors';
import { WIND_GLYPH, WIND_NAME } from '../winds';
import { type SheetPalette, type SheetTheme, microLabel, sheetPalette } from './sheetTheme';

interface PlayersSheetProps {
  open: boolean;
  onClose: () => void;
  /** The local player's seat — gets a "you" badge and the avatar
   *  picks up the bottom-seat colour. Spectators / pre-seat callers
   *  pass `null`. */
  mySeat: Seat | null;
  /** `paper` (default) is the classic cream sheet; `glass` is the 3D
   *  HUD's dark panel — glass rows with seat-wind badges. */
  theme?: SheetTheme;
}

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
export function PlayersSheet({ open, onClose, mySeat, theme = 'paper' }: PlayersSheetProps) {
  const state = useGame((s) => s.state);
  const lobby = useGame((s) => s.lobby);
  const glass = theme === 'glass';
  const P = sheetPalette(theme);

  return (
    <Modal
      open={open}
      title="Players"
      onClose={onClose}
      placement="bottom"
      maxWidth={520}
      variant={theme}
    >
      <ScrollView contentContainerStyle={{ padding: glass ? 14 : 18, paddingBottom: 28, gap: 10 }}>
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
                P={P}
                glass={glass}
              />
            ))}
          </View>
        ) : (
          <Text
            style={{
              fontSize: 13,
              color: glass ? P.text2 : COLORS.ink3,
              fontWeight: glass ? '500' : '600',
            }}
          >
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
  P: SheetPalette;
  glass: boolean;
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
  P,
  glass,
}: PlayerRowProps) {
  const name = nameForSeat(lobby, seat);
  const initials = computeInitials(name);
  const player = playerForSeat(lobby, seat);
  const botKind = (player?.isBot ? (player.botKind ?? null) : null) as BotKind | null;
  const botStatus = player?.isBot ? (botKind ? botDisplayName(botKind) : 'Bot') : null;
  const seatColor = RELATIVE_COLOR[relativeKey];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: glass ? 12 : 10,
        paddingHorizontal: 12,
        borderRadius: glass ? 14 : 12,
        backgroundColor: glass ? (isActive ? P.goldTint : P.surface) : COLORS.paperHi,
        borderWidth: glass ? 1 : isActive ? 2 : 1,
        borderColor: glass
          ? isActive
            ? P.goldBorder
            : P.border
          : isActive
            ? COLORS.gold
            : COLORS.hairline,
        // Room for the ON THE MOVE pill that overhangs the top edge.
        marginTop: glass && isActive ? 6 : 0,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: seatColor,
          alignItems: 'center',
          justifyContent: 'center',
          ...(glass && { boxShadow: '0 4px 12px rgba(0,0,0,0.35)' }),
        }}
      >
        <Text style={{ color: 'white', fontWeight: '800', fontSize: 13 }}>{initials}</Text>
      </View>
      <View style={{ flex: 1, gap: glass ? 5 : 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 14,
              fontWeight: glass ? '800' : '900',
              color: P.text,
              maxWidth: 200,
            }}
          >
            {name}
          </Text>
          {isMe ? (
            <Text
              style={
                glass
                  ? { ...microLabel(P.gold), fontSize: 9, lineHeight: 11 }
                  : { fontSize: 9, fontWeight: '900', color: COLORS.success, letterSpacing: 0.6 }
              }
            >
              YOU
            </Text>
          ) : null}
          {isDealer ? (
            <Text
              style={
                glass
                  ? { ...microLabel(P.red), fontSize: 9, lineHeight: 11 }
                  : { fontSize: 9, fontWeight: '900', color: COLORS.red, letterSpacing: 0.6 }
              }
            >
              DEALER
            </Text>
          ) : null}
          {botStatus ? (
            <View
              style={{
                backgroundColor: glass ? P.surfaceHi : 'rgba(115,90,163,0.12)',
                borderRadius: 4,
                paddingVertical: 1,
                paddingHorizontal: 5,
                ...(glass && { borderWidth: 1, borderColor: P.border }),
              }}
            >
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: '800',
                  letterSpacing: glass ? 0.6 : 0.3,
                  color: glass ? P.text2 : '#735aa3',
                }}
              >
                {botStatus}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              borderWidth: 1.5,
              borderColor: seatColor,
              alignItems: 'center',
              justifyContent: 'center',
              ...(glass && { backgroundColor: 'rgba(0,0,0,0.25)' }),
            }}
          >
            <Text
              style={{
                fontFamily: 'Noto Serif TC',
                fontSize: 13,
                lineHeight: 16,
                color: glass ? P.gold : COLORS.red,
              }}
            >
              {WIND_GLYPH[seatWind]}
            </Text>
          </View>
          <Text
            style={
              glass
                ? { ...microLabel(P.text2), letterSpacing: 1.2 }
                : { fontSize: 11, color: COLORS.ink3, fontWeight: '700' }
            }
          >
            {WIND_NAME[seatWind]} · seat {seat}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text
          style={{
            fontSize: 18,
            fontWeight: glass ? '800' : '900',
            color: P.text,
            fontVariant: ['tabular-nums'],
          }}
        >
          {score}
        </Text>
        <Text
          style={
            glass
              ? { ...microLabel(P.text3), fontSize: 9, lineHeight: 11 }
              : { fontSize: 9, color: COLORS.ink3, fontWeight: '700', letterSpacing: 0.4 }
          }
        >
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
            backgroundColor: P.gold,
            ...(glass && { boxShadow: '0 4px 12px rgba(216,168,90,0.35)' }),
          }}
        >
          <Text
            style={{
              fontSize: 9,
              fontWeight: glass ? '800' : '900',
              color: glass ? P.goldInk : COLORS.ink,
              letterSpacing: glass ? 1.2 : 0.6,
            }}
          >
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
