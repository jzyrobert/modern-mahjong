import { type Seat, tileLabel } from '@mahjong/game-logic';
import { type ReactNode, createContext, useContext } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { type LogEntry, nameForSeat, useGame } from '../../state/game';
import { Modal } from '../Modal';
import { COLORS } from '../colors';
import { SEAT_WIND_GLYPH } from '../winds';
import { GLASS_SHEET, type SheetTheme, seatColorFrom, sheetPalette } from './sheetTheme';

interface GameLogProps {
  open: boolean;
  onClose: () => void;
  /** The local player's seat — colours the glass rows' seat dots
   *  relative to the table (you = coral, then jade / mauve / sky
   *  clockwise). Omit / `null` for spectators. */
  mySeat?: Seat | null;
  /** `paper` (default) is the classic cream sheet; `glass` is the 3D
   *  HUD's dark panel — glass rows, no monospace, seat colour dots. */
  theme?: SheetTheme;
}

interface LogTheme {
  glass: boolean;
  mySeat: Seat | null;
}
const LogThemeContext = createContext<LogTheme>({ glass: false, mySeat: null });

/**
 * Recent-actions sheet — renders the last `LOG_CAPACITY` engine events
 * with a one-line gloss each. Latest event first; lobby names
 * are looked up so seat labels read as e.g. "Bold Crane 東 drew a tile."
 */
export function GameLog({ open, onClose, mySeat = null, theme = 'paper' }: GameLogProps) {
  const log = useGame((s) => s.log);
  const lobby = useGame((s) => s.lobby);
  const glass = theme === 'glass';
  const P = sheetPalette(theme);
  return (
    <Modal
      open={open}
      title="Last actions"
      onClose={onClose}
      maxWidth={520}
      variant={theme}
      placement={glass ? 'bottom' : 'center'}
    >
      <LogThemeContext.Provider value={{ glass, mySeat }}>
        <ScrollView
          contentContainerStyle={{
            padding: glass ? 14 : 18,
            paddingBottom: glass ? 24 : 18,
            gap: 6,
          }}
        >
          {log.length === 0 ? (
            <Text
              style={{
                fontSize: 13,
                lineHeight: 18,
                color: glass ? P.text2 : COLORS.ink3,
                fontWeight: glass ? '500' : '600',
              }}
            >
              Nothing has happened yet — the log fills up as the hand plays out.
            </Text>
          ) : (
            [...log].reverse().map((entry) => (
              <View
                key={entry.seq}
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  gap: glass ? 10 : 8,
                  paddingHorizontal: glass ? 12 : 10,
                  paddingVertical: glass ? 9 : 8,
                  backgroundColor: glass ? P.surface : COLORS.cream,
                  borderColor: glass ? P.hairline : COLORS.hairline,
                  borderWidth: 1,
                  borderRadius: glass ? 12 : 8,
                }}
              >
                <Text
                  style={
                    glass
                      ? {
                          fontSize: 11,
                          lineHeight: 13,
                          fontWeight: '700',
                          letterSpacing: 1,
                          color: P.text3,
                          minWidth: 26,
                          fontVariant: ['tabular-nums'],
                        }
                      : {
                          fontFamily: 'Courier',
                          fontSize: 10,
                          color: COLORS.ink3,
                          fontWeight: '700',
                          minWidth: 32,
                        }
                  }
                >
                  {glass ? entry.seq : `#${entry.seq.toString().padStart(2, '0')}`}
                </Text>
                <View style={{ flex: 1 }}>
                  <DescribeEvent entry={entry} lobby={lobby} />
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </LogThemeContext.Provider>
    </Modal>
  );
}

type Lobby = ReturnType<typeof useGame.getState>['lobby'];

function DescribeEvent({ entry, lobby }: { entry: LogEntry; lobby: Lobby }) {
  const { glass } = useContext(LogThemeContext);
  const e = entry.event;
  switch (e.t) {
    case 'handStarted':
      return (
        <Line>
          Hand <Mono>started</Mono> · seed <Mono>{e.seed}</Mono>
        </Line>
      );
    case 'opened':
      return (
        <Line>
          Opening rolls — {e.rolls.fullRoll ? 'all four seats rolled' : 'winner re-rolled'}.
        </Line>
      );
    case 'rulesChanged':
      return <Line>Rules updated.</Line>;
    case 'drew':
      return (
        <Line>
          <SeatLabel seat={e.seat} lobby={lobby} /> drew a tile.
        </Line>
      );
    case 'discarded':
      return (
        <Line>
          <SeatLabel seat={e.seat} lobby={lobby} /> discarded <TileChip label={tileLabel(e.tile)} />
          .
        </Line>
      );
    case 'claimsOpened':
      return <Line>Claim window open.</Line>;
    case 'claimsResolved': {
      const r = e.result;
      if (r.kind === 'pass') return <Line>All passed.</Line>;
      if (r.claim.kind === 'hu') {
        return (
          <Line>
            <SeatLabel seat={r.seat} lobby={lobby} /> declared{' '}
            <Strong color={glass ? GLASS_SHEET.gold : COLORS.red}>win</Strong> (糊).
          </Line>
        );
      }
      return (
        <Line>
          <SeatLabel seat={r.seat} lobby={lobby} /> called{' '}
          <Strong>{describeClaimKind(r.claim.kind)}</Strong>.
        </Line>
      );
    }
    case 'gangDeclared':
      return (
        <Line>
          <SeatLabel seat={e.seat} lobby={lobby} /> declared <Strong>{e.kind} gang</Strong>.
        </Line>
      );
    case 'won':
      return (
        <Line>
          <SeatLabel seat={e.seat} lobby={lobby} /> won {e.faan} faan
          {e.selfDraw ? ' (self-draw)' : null}
          {!e.selfDraw && e.from !== undefined ? (
            <>
              {' '}
              from <SeatLabel seat={e.from} lobby={lobby} />
            </>
          ) : null}
          .
        </Line>
      );
    case 'drawn-game':
      return <Line>Drawn game — wall empty.</Line>;
    default:
      return null;
  }
}

function describeClaimKind(kind: 'pass' | 'chi' | 'peng' | 'gang' | 'hu'): string {
  switch (kind) {
    case 'chi':
      return 'chi (吃)';
    case 'peng':
      return 'peng (碰)';
    case 'gang':
      return 'gang (槓)';
    case 'hu':
      return 'win (糊)';
    case 'pass':
      return 'pass';
  }
}

function Line({ children }: { children: ReactNode }) {
  const { glass } = useContext(LogThemeContext);
  return (
    <Text
      style={{
        fontSize: glass ? 13 : 12,
        color: glass ? GLASS_SHEET.text2 : COLORS.ink,
        lineHeight: glass ? 19 : 18,
      }}
    >
      {children}
    </Text>
  );
}

function SeatLabel({ seat, lobby }: { seat: Seat; lobby: Lobby }) {
  const { glass, mySeat } = useContext(LogThemeContext);
  const name = nameForSeat(lobby, seat);
  if (glass) {
    // 6 px seat-colour dot (relative to the user's seat) in front of
    // the name; the wind glyph stays in Noto Serif TC.
    return (
      <>
        <Text
          style={{ fontSize: 9, lineHeight: 13, color: seatColorFrom(mySeat, seat) }}
          accessibilityElementsHidden
        >
          {'● '}
        </Text>
        <Text style={{ fontWeight: '800', color: GLASS_SHEET.text }}>{name}</Text>
        <Text style={{ fontFamily: 'Noto Serif TC', color: GLASS_SHEET.gold }}>
          {` ${SEAT_WIND_GLYPH[seat]}`}
        </Text>
      </>
    );
  }
  return (
    <>
      <Text style={{ fontWeight: '800', color: COLORS.ink }}>{name}</Text>
      <Text
        style={{ fontFamily: 'Noto Serif TC', color: COLORS.red }}
      >{` ${SEAT_WIND_GLYPH[seat]}`}</Text>
    </>
  );
}

function Strong({ children, color }: { children: ReactNode; color?: string }) {
  const { glass } = useContext(LogThemeContext);
  return (
    <Text style={{ fontWeight: '800', color: color ?? (glass ? GLASS_SHEET.text : COLORS.ink) }}>
      {children}
    </Text>
  );
}

function TileChip({ label }: { label: string }) {
  const { glass } = useContext(LogThemeContext);
  return (
    <Text
      style={
        glass
          ? {
              backgroundColor: GLASS_SHEET.goldTint,
              borderColor: GLASS_SHEET.goldBorder,
              borderWidth: 1,
              borderRadius: 5,
              paddingHorizontal: 5,
              fontSize: 12,
              fontWeight: '800',
              color: GLASS_SHEET.gold,
            }
          : {
              backgroundColor: COLORS.paperHi,
              borderColor: COLORS.hairline,
              borderWidth: 1,
              borderRadius: 4,
              paddingHorizontal: 4,
              fontFamily: 'Courier',
              fontSize: 11,
              color: COLORS.ink,
            }
      }
    >
      {label}
    </Text>
  );
}

function Mono({ children }: { children: ReactNode }) {
  const { glass } = useContext(LogThemeContext);
  return (
    <Text
      style={
        glass
          ? { fontWeight: '700', color: GLASS_SHEET.text }
          : { fontFamily: 'Courier', color: COLORS.ink3 }
      }
    >
      {children}
    </Text>
  );
}
