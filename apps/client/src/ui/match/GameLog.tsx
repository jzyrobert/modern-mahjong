import type { Event as EngineEvent, Tile as MTile, Seat } from '@mahjong/game-logic';
import { tileLabel } from '@mahjong/game-logic';
import {
  CREAM,
  HAIRLINE,
  INK,
  INK_3,
  MONO,
  PAPER_HI,
  RED,
  SANS,
  SERIF,
} from '../../native/theme.js';
import { type LogEntry, nameForSeat, useGame } from '../../state/game.js';
import { Modal } from '../Modal.js';

interface GameLogProps {
  open: boolean;
  onClose: () => void;
}

const WIND_GLYPH = ['東', '南', '西', '北'] as const;

/**
 * Recent-actions sheet — renders the last `LOG_CAPACITY` engine events
 * with a one-line gloss each. Closes the "Game log buffer" entry in
 * TODO.md → Design port follow-ups; mobile bottom-sheet integration is
 * still queued separately.
 */
export function GameLog({ open, onClose }: GameLogProps) {
  const log = useGame((s) => s.log);
  const lobby = useGame((s) => s.lobby);
  return (
    <Modal open={open} title="Last actions" onClose={onClose}>
      {log.length === 0 ? (
        <div style={{ fontSize: 13, color: INK_3, fontFamily: SANS }}>
          Nothing has happened yet — the log fills up as the hand plays out.
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {[...log].reverse().map((entry) => (
            <li
              key={entry.seq}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                padding: '8px 10px',
                background: CREAM,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 8,
                fontFamily: SANS,
                fontSize: 12,
                color: INK,
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  color: INK_3,
                  fontWeight: 700,
                  minWidth: 28,
                }}
              >
                #{entry.seq.toString().padStart(2, '0')}
              </span>
              <span style={{ flex: 1 }}>{describeEvent(entry, lobby)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

type Lobby = ReturnType<typeof useGame.getState>['lobby'];

function describeEvent(entry: LogEntry, lobby: Lobby): React.ReactNode {
  const e = entry.event;
  switch (e.t) {
    case 'handStarted':
      return (
        <>
          Hand <Mono>started</Mono> · seed <Mono>{e.seed}</Mono>
        </>
      );
    case 'opened':
      return (
        <>Opening rolls — {e.rolls.fullRoll ? 'all four seats rolled' : 'winner re-rolled'}.</>
      );
    case 'rulesChanged':
      return <>Rules updated.</>;
    case 'drew':
      return <>{seatLabel(e.seat, lobby)} drew a tile.</>;
    case 'discarded':
      return (
        <>
          {seatLabel(e.seat, lobby)} discarded <TileChip tile={e.tile} />.
        </>
      );
    case 'claimsOpened':
      return <>Claim window open.</>;
    case 'claimsResolved': {
      const r = e.result;
      if (r.kind === 'pass') return <>All passed.</>;
      if (r.claim.kind === 'hu') {
        return (
          <>
            {seatLabel(r.seat, lobby)} declared <strong style={{ color: RED }}>win</strong> (糊).
          </>
        );
      }
      return (
        <>
          {seatLabel(r.seat, lobby)} called <strong>{describeClaimKind(r.claim.kind)}</strong>.
        </>
      );
    }
    case 'kongDeclared':
      return (
        <>
          {seatLabel(e.seat, lobby)} declared <strong>{e.kind} kong</strong>.
        </>
      );
    case 'won':
      return (
        <>
          {seatLabel(e.seat, lobby)} won {e.faan} faan
          {e.selfDraw ? ' (self-draw)' : ` from ${seatLabel(e.from, lobby)}`}.
        </>
      );
    case 'drawn-game':
      return <>Drawn game — wall empty.</>;
  }
}

function describeClaimKind(kind: 'pass' | 'chi' | 'peng' | 'gong' | 'hu'): string {
  switch (kind) {
    case 'chi':
      return 'chow (吃)';
    case 'peng':
      return 'pung (碰)';
    case 'gong':
      return 'kong (槓)';
    case 'hu':
      return 'win (糊)';
    case 'pass':
      return 'pass';
  }
}

function seatLabel(seat: Seat, lobby: Lobby): React.ReactNode {
  const name = nameForSeat(lobby, seat);
  return (
    <>
      <strong style={{ fontWeight: 800 }}>{name}</strong>{' '}
      <span style={{ fontFamily: SERIF, color: RED }}>{WIND_GLYPH[seat]}</span>
    </>
  );
}

function TileChip({ tile }: { tile: MTile }) {
  return (
    <code
      style={{
        background: PAPER_HI,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 4,
        padding: '0 4px',
        fontFamily: MONO,
        fontSize: 11,
      }}
    >
      {tileLabel(tile)}
    </code>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span style={{ fontFamily: MONO, color: INK_3 }}>{children}</span>;
}
