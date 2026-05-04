import {
  type Tile as MTile,
  type Seat,
  WINDS,
  type Wind,
  acrossSeat,
  nextSeat,
  prevSeat,
} from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import type { LobbyState } from '../state/game.js';
import { DiscardPile } from './DiscardPile.js';
import { Hand } from './Hand.js';
import { MeldStrip } from './match/MeldStrip.js';
import { PlayerBadge } from './match/PlayerBadge.js';
import { type SortMode, SortPicker } from './match/SortPicker.js';
import { WallEdge } from './match/WallEdge.js';
import { LIVE_WALL_TILES, computeWallLayout } from './match/wallLayout.js';

interface TableProps {
  /** The viewer's seat — placed at the bottom. */
  mySeat: Seat;
  /** Dealer seat from the engine — drives seat-wind rotation. */
  dealer: Seat;
  /** Seat whose turn it currently is (for the active-turn glow). */
  turn: Seat;
  /** Cumulative scores per seat (`state.scoreboard`). */
  scoreboard: Record<Seat, number>;
  hands: Record<Seat, MTile[]>;
  discards: Record<Seat, MTile[]>;
  /** Lobby snapshot — drives PlayerBadge name + initials. */
  lobby: LobbyState | null;
  ownHandClickable?: ((t: MTile) => void) | undefined;
  /**
   * When set, the user's wall has a pulsing first tile that triggers this
   * callback on click — replaces the older floating draw-tile.
   */
  onDrawNext?: (() => void) | undefined;
  /** Sort mode for the user's hand. */
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  /**
   * Engine `tileId` of the latest discard, set while
   * `phase === 'awaitingClaims'`. The matching tile in the discarder's
   * pile gets a pulsing red halo so claimers can track it.
   */
  latestDiscardId?: number | null;
  /**
   * Engine `tileId` of the user's just-drawn tile (from `useGame.drawnTileId`).
   * Hand uses it to glow that tile with a soft gold drop-shadow.
   */
  drawnTileId?: number | null;
  /** Persisted manual order under sortMode === 'manual'. */
  manualOrder?: readonly number[] | undefined;
  /** Commit a new manual order after a drag. */
  onReorder?: ((ids: number[]) => void) | undefined;
  /**
   * Sum of the opening dice from `state.openingRolls.breakPosition`. Drives
   * which seat's wall is broken and where; `undefined` falls back to a
   * "no break, all live" wall display.
   */
  breakPosition?: number | undefined;
  /** Live tiles still in the engine wall (drives drawn count + count badge). */
  liveWallCount: number;
  /**
   * Engine `Tile` at the next-to-draw position, used as the `layoutId`
   * source for the wall→hand FLIP animation. Falls back to null if
   * `state.wall` is empty.
   */
  nextDrawTile?: MTile | null | undefined;
  centerHud?: ReactNode;
}

interface SeatPosition {
  seat: Seat;
  position: 'bottom' | 'right' | 'top' | 'left';
  /** CSS Grid (column, row) in the outer 3×3 board grid. */
  outer: [number, number];
  /** CSS Grid position within the inner discards grid. */
  inner: [number, number];
  /** Tile rotation for face-down opponent hands. */
  rotate: number;
  /** Outer-grid alignment hints. */
  align: { justifySelf?: string; alignSelf?: string };
  /** Wrapping rotation transform for the opponent's Hand row. */
  wrapTransform?: string;
}

/**
 * Visual spacing between the hand row (outer, near the felt edge) and
 * the wall row (inner, flanking the discard pool). Larger than the 4px
 * we used to ship so each opponent's wall sits clearly inside the
 * playing area instead of pinned to the edge alongside the hand.
 */
const INNER_GAP_RAW = 'clamp(40px, 8vmin, 80px)';

export function Table({
  mySeat,
  dealer,
  turn,
  scoreboard,
  hands,
  discards,
  lobby,
  ownHandClickable,
  onDrawNext,
  sortMode,
  onSortModeChange,
  latestDiscardId = null,
  drawnTileId = null,
  manualOrder,
  onReorder,
  breakPosition,
  liveWallCount,
  nextDrawTile = null,
  centerHud,
}: TableProps) {
  const positions = layoutFor(mySeat);
  const me = positions[0];
  const opponents = [positions[1], positions[2], positions[3]];

  // Drawn count = LIVE_WALL_TILES (130) − live count remaining. The dice
  // rules walk drawn tiles CCW from the break, so the layout helper turns
  // engine `wall.length` into per-seat slot statuses.
  const wallLayout = computeWallLayout({
    dealer,
    breakPosition,
    drawn: Math.max(0, LIVE_WALL_TILES - liveWallCount),
    allowDraw: onDrawNext !== undefined,
  });

  const renderWall = (seat: Seat, opts: { reverse?: boolean; isMe?: boolean }) => (
    <WallEdge
      seatKey={seat}
      slots={wallLayout.slots[seat]}
      liveCount={liveWallCount}
      showCount={opts.isMe === true}
      reverse={opts.reverse}
      nextDrawTile={wallLayout.nextDrawSeat === seat ? nextDrawTile : null}
      onDrawNext={wallLayout.nextDrawSeat === seat ? onDrawNext : undefined}
      enableDrawTestId={wallLayout.nextDrawSeat === seat}
    />
  );

  return (
    <div
      style={{
        display: 'grid',
        // All tracks are content-sized so the four walls hug the central
        // discard area — replicates the tight square footprint of a real
        // mahjong table. `placeContent: 'center'` keeps the resulting
        // (smaller) grid centred inside the felt's `minHeight`.
        gridTemplateColumns: 'auto auto auto',
        gridTemplateRows: 'auto auto auto',
        placeContent: 'center',
        gap: 'clamp(4px, 1vmin, 12px)',
        // Scale the table to whatever vertical space is available — on a
        // landscape phone (~360px tall) this collapses to ~360px instead of
        // forcing a fixed 560 that overflows the viewport.
        minHeight: 'min(620px, 80vh)',
        padding: 'clamp(6px, 1.4vmin, 16px)',
        // Sage felt with a cream inner ring and gold outer hairline — ported
        // from /tmp/design/design/app.jsx's central felt frame. The two
        // gradient stops fall back to sage if the felt-skin CSS vars
        // haven't been set by SettingsPanel (e.g. running outside a Match).
        background: `radial-gradient(ellipse at 50% 40%,
          var(--felt-1, oklch(0.5 0.06 145)) 0%,
          var(--felt-1, oklch(0.4 0.06 145)) 55%,
          var(--felt-2, oklch(0.32 0.06 150)) 100%)`,
        boxShadow: `
          inset 0 0 0 5px oklch(0.3 0.06 150),
          inset 0 0 0 10px oklch(0.78 0.14 80 / 0.45),
          inset 0 0 60px rgba(0,0,0,0.18),
          0 12px 32px -8px rgba(40,30,20,0.3)
        `,
        borderRadius: 24,
        color: 'oklch(0.95 0.02 85)',
      }}
    >
      {opponents.map((p) => {
        const seatWind = seatWindFor(dealer, p.seat);
        // Opponent hands use the wall's smaller tile scale (≈half the
        // user's hand) so 13–14 face-down tiles fit even when the window
        // shrinks. Without this override the floor of `max(22px, 3.6vmin)`
        // pushes the rotated row past the felt edge on narrower viewports.
        const handTile = (
          <div
            style={{
              ['--tile-w' as string]: 'max(16px, 2.6vmin)',
              ['--tile-h' as string]: 'max(22px, 3.6vmin)',
            }}
          >
            <Hand tiles={hands[p.seat]} faceDown rotate={p.wrapTransform ? 0 : p.rotate} />
          </div>
        );
        // Left/top opponents render their walls in normal order; the right
        // opponent's wall mirrors so its physical "right end" stays on the
        // outer edge after the -90° rotation. Bottom user has its own
        // render below.
        const wallTile = renderWall(p.seat, { reverse: p.position === 'right' });
        // Top opponent's meld strip is rendered separately in the top-left
        // corner cell so it doesn't push the wall row away from the centre.
        const meldStrip = p.position === 'top' ? null : <MeldStrip orientation="vert" />;
        return (
          <div
            key={p.seat}
            style={{
              gridColumn: p.outer[0],
              gridRow: p.outer[1],
              ...p.align,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <PlayerBadge
              seat={p.seat}
              position={p.position}
              seatWind={seatWind}
              lobby={lobby}
              score={scoreboard[p.seat]}
              isActive={turn === p.seat}
            />
            {p.wrapTransform ? (
              // Reserve the *post-rotation* bounding box so the badge
              // above and the meld strip below can't sit on top of the
              // rotated tile rows. Pre-rotation the inner column is
              // ~14 hand tiles wide × (wall row + hand row + INNER_GAP) —
              // after the 90° rotation those swap. The wall sits on the
              // inner side of the rotation (toward the discard pool); the
              // hand stays at the outer edge.
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: `calc(2 * max(22px, 3.6vmin) + ${INNER_GAP_RAW})`,
                  height: 'calc(14 * max(16px, 2.6vmin) + 13 * 4px)',
                }}
              >
                <div style={{ transform: p.wrapTransform, whiteSpace: 'nowrap' }}>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: INNER_GAP_RAW,
                    }}
                  >
                    {wallTile}
                    {handTile}
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: INNER_GAP_RAW,
                }}
              >
                {handTile}
                {wallTile}
              </div>
            )}
            {meldStrip}
          </div>
        );
      })}

      {/* Top opponent's meld strip lives in the top-left corner cell so the
          wall row above can sit flush against the central discard area
          rather than being pushed outward by an inline meld strip. */}
      <div
        style={{
          gridColumn: 1,
          gridRow: 1,
          alignSelf: 'end',
          justifySelf: 'center',
        }}
      >
        <MeldStrip orientation="vert" />
      </div>

      <div
        style={{
          gridColumn: 2,
          gridRow: 2,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          gridTemplateRows: 'auto 1fr auto',
          gap: 'clamp(4px, 0.8vmin, 8px)',
          padding: 'clamp(6px, 1.2vmin, 12px)',
          minHeight: 'min(220px, 38vh)',
        }}
      >
        {positions.map((p) => (
          <div
            key={p.seat}
            style={{
              gridColumn: p.inner[0],
              gridRow: p.inner[1],
              ...p.align,
            }}
          >
            <DiscardPile tiles={discards[p.seat]} rotate={p.rotate} latestId={latestDiscardId} />
          </div>
        ))}
        <div
          style={{
            gridColumn: 2,
            gridRow: 2,
            alignSelf: 'center',
            justifySelf: 'center',
            textAlign: 'center',
          }}
        >
          {centerHud}
        </div>
      </div>

      <div
        style={{
          gridColumn: me.outer[0],
          gridRow: me.outer[1],
          justifySelf: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <div style={{ marginBottom: INNER_GAP_RAW }}>{renderWall(me.seat, { isMe: true })}</div>
        <PlayerBadge
          seat={me.seat}
          position="bottom"
          seatWind={seatWindFor(dealer, me.seat)}
          lobby={lobby}
          score={scoreboard[me.seat]}
          isActive={turn === me.seat}
        />
        <SortPicker mode={sortMode} onChange={onSortModeChange} />
        <Hand
          tiles={hands[me.seat]}
          onTileClick={ownHandClickable}
          sortMode={sortMode}
          drawnTileId={drawnTileId}
          manualOrder={manualOrder}
          onReorder={onReorder}
        />
      </div>
    </div>
  );
}

/**
 * Seat wind derives from dealer position: dealer is East, then S/W/N going
 * counter-clockwise around the table. Same `nextSeat` ordering the engine
 * uses for turn rotation.
 */
function seatWindFor(dealer: Seat, seat: Seat): Wind {
  const offset = (seat - dealer + 4) % 4;
  return WINDS[offset]!;
}

function layoutFor(mySeat: Seat): [SeatPosition, SeatPosition, SeatPosition, SeatPosition] {
  return [
    {
      seat: mySeat,
      position: 'bottom',
      outer: [2, 3],
      inner: [2, 3],
      rotate: 0,
      align: { justifySelf: 'center' },
    },
    {
      seat: nextSeat(mySeat),
      position: 'right',
      outer: [3, 2],
      inner: [3, 2],
      // Right seat: top of each tile must point LEFT (toward center) so
      // the seat reads them upright. CSS rotate is clockwise, so -90.
      rotate: -90,
      align: { alignSelf: 'center', justifySelf: 'end' },
      wrapTransform: 'rotate(-90deg)',
    },
    {
      seat: acrossSeat(mySeat),
      position: 'top',
      outer: [2, 1],
      inner: [2, 1],
      rotate: 180,
      align: { justifySelf: 'center' },
    },
    {
      seat: prevSeat(mySeat),
      position: 'left',
      outer: [1, 2],
      inner: [1, 2],
      // Left seat: top of each tile must point RIGHT (toward center).
      rotate: 90,
      align: { alignSelf: 'center' },
      wrapTransform: 'rotate(90deg)',
    },
  ];
}
