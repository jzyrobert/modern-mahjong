import { type Seat, tileLabel } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { type LogEntry, nameForSeat, useGame } from '../../state/game';
import { Modal } from '../Modal';
import { COLORS } from '../colors';
import { SEAT_WIND_GLYPH } from '../winds';

interface GameLogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Recent-actions sheet — renders the last `LOG_CAPACITY` engine events
 * with a one-line gloss each. Latest event first; lobby names
 * are looked up so seat labels read as e.g. "Bold Crane 東 drew a tile."
 */
export function GameLog({ open, onClose }: GameLogProps) {
  const log = useGame((s) => s.log);
  const lobby = useGame((s) => s.lobby);
  return (
    <Modal open={open} title="Last actions" onClose={onClose} maxWidth={520}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 6 }}>
        {log.length === 0 ? (
          <Text style={{ fontSize: 13, color: COLORS.ink3, fontWeight: '600' }}>
            Nothing has happened yet — the log fills up as the hand plays out.
          </Text>
        ) : (
          [...log].reverse().map((entry) => (
            <View
              key={entry.seq}
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                gap: 8,
                paddingHorizontal: 10,
                paddingVertical: 8,
                backgroundColor: COLORS.cream,
                borderColor: COLORS.hairline,
                borderWidth: 1,
                borderRadius: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Courier',
                  fontSize: 10,
                  color: COLORS.ink3,
                  fontWeight: '700',
                  minWidth: 32,
                }}
              >
                #{entry.seq.toString().padStart(2, '0')}
              </Text>
              <View style={{ flex: 1 }}>
                <DescribeEvent entry={entry} lobby={lobby} />
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </Modal>
  );
}

type Lobby = ReturnType<typeof useGame.getState>['lobby'];

function DescribeEvent({ entry, lobby }: { entry: LogEntry; lobby: Lobby }) {
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
            <Strong color={COLORS.red}>win</Strong> (糊).
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
  return <Text style={{ fontSize: 12, color: COLORS.ink, lineHeight: 18 }}>{children}</Text>;
}

function SeatLabel({ seat, lobby }: { seat: Seat; lobby: Lobby }) {
  const name = nameForSeat(lobby, seat);
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
  return <Text style={{ fontWeight: '800', color: color ?? COLORS.ink }}>{children}</Text>;
}

function TileChip({ label }: { label: string }) {
  return (
    <Text
      style={{
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 4,
        paddingHorizontal: 4,
        fontFamily: 'Courier',
        fontSize: 11,
        color: COLORS.ink,
      }}
    >
      {label}
    </Text>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: 'Courier', color: COLORS.ink3 }}>{children}</Text>;
}
