import {
  type Action,
  type Tile as MTile,
  type Seat,
  WINDS,
  type Wind,
  acrossSeat,
  isWinning,
  legalClaimsFor,
  nextSeat,
  prevSeat,
  tileId,
} from '@mahjong/game-logic';
import { motion } from 'framer-motion';
import { useCallback, useMemo } from 'react';
import { vibrateLight } from '../native/init.js';
import { useGame } from '../state/game.js';
import { ClaimBar } from './ClaimBar.js';
import { Hand } from './Hand.js';
import { Tile } from './Tile.js';
import { GameStatusBar } from './match/GameStatusBar.js';
import { OppHandStrip } from './match/OppHandStrip.js';
import { SharedDiscardPool } from './match/SharedDiscardPool.js';
import { type SortMode, SortPicker } from './match/SortPicker.js';
import { TopBar } from './match/TopBar.js';
import { FELT_SKINS } from './match/skins.js';

interface MobileMatchProps {
  onAction: (action: Action) => void;
  matchCode: string | null;
  onLeave: () => void;
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  onOpenSettings: () => void;
}

type Position = 'bottom' | 'right' | 'top' | 'left';

interface SeatPlacement {
  seat: Seat;
  position: Position;
  seatWind: Wind;
}

/**
 * Landscape mobile shell — ported from `/tmp/design/design/app-mobile.jsx`.
 * Used when the viewport matches `(max-width: 900px) and (orientation:
 * landscape)`. Compact glass top bars, OppHandStrip pills along the felt
 * edges, a shared discard pool in the center with seat-color underlines,
 * and the user's own hand + SortPicker docked at the bottom.
 *
 * The bottom-sheet menu / reference / players panels from the design are
 * queued — they need additional navigation work and aren't required for
 * a playable mobile match. See TODO.md → Design port follow-ups.
 */
export function MobileMatch({
  onAction,
  matchCode,
  onLeave,
  sortMode,
  onSortModeChange,
  onOpenSettings,
}: MobileMatchProps) {
  const state = useGame((s) => s.state);
  const you = useGame((s) => s.you);
  const lobby = useGame((s) => s.lobby);
  const settings = useGame((s) => s.settings);

  const seat = you !== null && you !== 'spectator' ? you : null;
  const myTurn = !!state && state.phase === 'turn' && state.turn === seat;
  const needsDraw = myTurn && !!state && !state.hasDrawn;

  const onDiscard = useCallback(
    (t: MTile) => {
      if (myTurn && seat !== null) {
        onAction({ t: 'discard', seat, tile: t });
        void vibrateLight();
      }
    },
    [myTurn, seat, onAction],
  );

  const onDrawNext = useCallback(() => {
    if (needsDraw && seat !== null) onAction({ t: 'draw', seat });
  }, [needsDraw, seat, onAction]);

  const showClaim = useMemo(() => {
    if (!state || seat === null) return false;
    if (state.phase !== 'awaitingClaims') return false;
    if (!state.lastDiscard || state.lastDiscard.from === seat) return false;
    const legal = legalClaimsFor(state, seat).filter((k) => k !== 'pass');
    if (legal.length > 0) return true;
    const handPlusTile = [...state.hands[seat], state.lastDiscard.tile];
    return isWinning({
      hand: handPlusTile,
      exposedMelds: state.melds[seat].length,
      allowSpecial: state.rules.allowSevenPairs || state.rules.allowThirteenOrphans,
    });
  }, [state, seat]);

  const canTsumo = useMemo(() => {
    if (!state || seat === null) return false;
    return (
      myTurn &&
      state.hasDrawn &&
      isWinning({
        hand: state.hands[seat],
        exposedMelds: state.melds[seat].length,
        allowSpecial: state.rules.allowSevenPairs || state.rules.allowThirteenOrphans,
      })
    );
  }, [state, seat, myTurn]);

  const wallSlice = useMemo(() => {
    if (!state || seat === null) return [] as readonly MTile[];
    const out: MTile[] = [];
    for (const [i, tile] of state.wall.entries()) {
      if (i % 4 === seat) out.push(tile);
    }
    return out;
  }, [state, seat]);

  if (!state || seat === null) {
    return null;
  }

  const placements = layoutFor(seat, state.dealer);
  const opponents = placements.filter((p) => p.position !== 'bottom');
  const me = placements.find((p) => p.position === 'bottom')!;

  // Map per-seat discards onto visual positions for the SharedDiscardPool.
  const discardsByPosition: Record<Position, readonly MTile[]> = {
    bottom: state.discards[me.seat],
    right: state.discards[placements.find((p) => p.position === 'right')!.seat],
    top: state.discards[placements.find((p) => p.position === 'top')!.seat],
    left: state.discards[placements.find((p) => p.position === 'left')!.seat],
  };
  // Highlight the live discard only while a claim is on offer; outside
  // `awaitingClaims` the discard already resolved and the halo would be
  // stale.
  const latestId =
    state.phase === 'awaitingClaims' && state.lastDiscard ? tileId(state.lastDiscard.tile) : null;
  const felt = FELT_SKINS[settings.felt];

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '100vh',
        background: `radial-gradient(ellipse at center, ${felt.top}, ${felt.bottom})`,
        boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.25)',
        overflow: 'hidden',
        ['--tile-w' as string]: '20px',
        ['--tile-h' as string]: '28px',
        ['--felt-1' as string]: felt.top,
        ['--felt-2' as string]: felt.bottom,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          right: 6,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 6,
          zIndex: 6,
        }}
      >
        <GameStatusBar
          prevailing={state.prevailingWind}
          dealerName={
            lobby?.players.find((p) => p.seat === state.dealer)?.displayName ??
            `Seat ${state.dealer}`
          }
          wallCount={state.wall.length}
          isMyTurn={myTurn}
        />
        <TopBar gameId={matchCode} onLeave={onLeave} onSettings={onOpenSettings} />
      </div>

      <div
        style={{
          position: 'absolute',
          top: 56,
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      >
        <OppHandStrip
          seat={opponents.find((p) => p.position === 'top')!.seat}
          position="top"
          seatWind={opponents.find((p) => p.position === 'top')!.seatWind}
          lobby={lobby}
          handBacks={state.hands[opponents.find((p) => p.position === 'top')!.seat].length}
          isActive={state.turn === opponents.find((p) => p.position === 'top')!.seat}
        />
      </div>

      <div style={{ position: 'absolute', top: '50%', left: 6, transform: 'translateY(-50%)' }}>
        <OppHandStrip
          seat={opponents.find((p) => p.position === 'left')!.seat}
          position="left"
          seatWind={opponents.find((p) => p.position === 'left')!.seatWind}
          lobby={lobby}
          handBacks={state.hands[opponents.find((p) => p.position === 'left')!.seat].length}
          isActive={state.turn === opponents.find((p) => p.position === 'left')!.seat}
        />
      </div>

      <div style={{ position: 'absolute', top: '50%', right: 6, transform: 'translateY(-50%)' }}>
        <OppHandStrip
          seat={opponents.find((p) => p.position === 'right')!.seat}
          position="right"
          seatWind={opponents.find((p) => p.position === 'right')!.seatWind}
          lobby={lobby}
          handBacks={state.hands[opponents.find((p) => p.position === 'right')!.seat].length}
          isActive={state.turn === opponents.find((p) => p.position === 'right')!.seat}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        <SharedDiscardPool discardsByPosition={discardsByPosition} latestId={latestId} />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 6,
          right: 6,
          bottom: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {showClaim ? <ClaimBar onAction={onAction} seat={seat} /> : null}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
          }}
        >
          {needsDraw && wallSlice.length > 0 ? (
            <DrawCue tile={wallSlice[0]!} onClick={onDrawNext} />
          ) : (
            <div />
          )}
          <SortPicker mode={sortMode} onChange={onSortModeChange} />
        </div>
        <Hand
          tiles={state.hands[seat]}
          onTileClick={myTurn ? onDiscard : undefined}
          sortMode={sortMode}
        />
        {canTsumo ? (
          <button
            type="button"
            onClick={() => onAction({ t: 'declareWin', seat, selfDraw: true })}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(135deg, oklch(0.78 0.16 75), oklch(0.68 0.18 60))',
              color: 'white',
              fontWeight: 800,
              fontSize: 12,
              cursor: 'pointer',
              alignSelf: 'flex-start',
            }}
          >
            Declare win (tsumo)
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DrawCue({ tile, onClick }: { tile: MTile; onClick: () => void }) {
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <motion.div
        animate={{ scale: [1, 1.18, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 6,
          background: '#f3c54a',
          pointerEvents: 'none',
        }}
      />
      <Tile tile={tile} faceDown onClick={onClick} testId="wall-draw-next" />
    </div>
  );
}

function layoutFor(mySeat: Seat, dealer: Seat): SeatPlacement[] {
  return [
    { seat: mySeat, position: 'bottom', seatWind: seatWindFor(dealer, mySeat) },
    {
      seat: nextSeat(mySeat),
      position: 'right',
      seatWind: seatWindFor(dealer, nextSeat(mySeat)),
    },
    {
      seat: acrossSeat(mySeat),
      position: 'top',
      seatWind: seatWindFor(dealer, acrossSeat(mySeat)),
    },
    {
      seat: prevSeat(mySeat),
      position: 'left',
      seatWind: seatWindFor(dealer, prevSeat(mySeat)),
    },
  ];
}

function seatWindFor(dealer: Seat, seat: Seat): Wind {
  const offset = (seat - dealer + 4) % 4;
  return WINDS[offset]!;
}
