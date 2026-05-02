import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import { SEATS } from '@mahjong/game-logic';
import { useGame } from '../state/game.js';
import { Hand } from './Hand.js';

interface MatchProps {
  onAction: (action: Action) => void;
}

export function Match({ onAction }: MatchProps) {
  const state = useGame((s) => s.state);
  const you = useGame((s) => s.you);
  if (!state || you === null || you === 'spectator') {
    return <div>Waiting for the game to start…</div>;
  }
  const seat = you;

  if (state.phase === 'waiting') {
    return (
      <div style={{ padding: 24, color: '#eee', fontFamily: 'system-ui, sans-serif' }}>
        <h2>Lobby</h2>
        <p>You are seated as seat {seat}. Hit start when everyone has joined.</p>
        <button
          type="button"
          onClick={() => onAction({ t: 'startHand', seed: randomSeed(), dealer: 0 })}
        >
          Start match
        </button>
      </div>
    );
  }

  const onDiscard = (t: MTile) => {
    if (state.phase !== 'turn') return;
    if (state.turn !== seat) return;
    onAction({ t: 'discard', seat, tile: t });
  };

  const onDraw = () => {
    if (state.phase !== 'turn' || state.turn !== seat || state.hasDrawn) return;
    onAction({ t: 'draw', seat });
  };

  return (
    <div style={{ padding: 12, color: '#eee', fontFamily: 'system-ui, sans-serif' }}>
      <Hud />
      <h3>Other players</h3>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {SEATS.filter((s) => s !== seat).map((s) => (
          <SeatPanel key={s} seat={s} />
        ))}
      </div>
      <h3 style={{ marginTop: 16 }}>Your hand</h3>
      <Hand
        tiles={state.hands[seat]}
        onTileClick={state.phase === 'turn' && state.turn === seat ? onDiscard : undefined}
      />
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onDraw}
          disabled={state.phase !== 'turn' || state.turn !== seat || state.hasDrawn}
        >
          Draw
        </button>
        <button
          type="button"
          onClick={() => onAction({ t: 'declareWin', seat, selfDraw: true })}
          disabled={state.phase !== 'turn' || state.turn !== seat || !state.hasDrawn}
        >
          Declare win (tsumo)
        </button>
      </div>
      {state.phase === 'awaitingClaims' && state.lastDiscard && state.lastDiscard.from !== seat && (
        <ClaimBar onAction={onAction} seat={seat} />
      )}
      {state.lastResult && <ResultPanel onAction={onAction} mySeat={seat} />}
    </div>
  );
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

function Hud() {
  const state = useGame((s) => s.state)!;
  return (
    <div style={{ display: 'flex', gap: 16, fontSize: 13, opacity: 0.8 }}>
      <div>Phase: {state.phase}</div>
      <div>Turn: seat {state.turn}</div>
      <div>Wall: {state.wall.length}</div>
      <div>Prevailing: {state.prevailingWind}</div>
    </div>
  );
}

function SeatPanel({ seat }: { seat: Seat }) {
  const state = useGame((s) => s.state)!;
  return (
    <div style={{ border: '1px solid #444', padding: 8, borderRadius: 6 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>Seat {seat}</div>
      <Hand tiles={state.hands[seat]} faceDown />
      <div style={{ marginTop: 6, fontSize: 12 }}>
        Discards: {state.discards[seat].length}, melds: {state.melds[seat].length}
      </div>
    </div>
  );
}

function ClaimBar({ onAction, seat }: { onAction: (a: Action) => void; seat: Seat }) {
  return (
    <div style={{ marginTop: 12, padding: 8, border: '1px dashed #f3c54a', borderRadius: 6 }}>
      <span style={{ marginRight: 8 }}>Claim?</span>
      <button
        type="button"
        onClick={() => onAction({ t: 'declareClaim', seat, claim: { kind: 'pass' } })}
      >
        Pass
      </button>
      <button
        type="button"
        onClick={() => onAction({ t: 'declareClaim', seat, claim: { kind: 'peng' } })}
      >
        Peng
      </button>
      <button
        type="button"
        onClick={() => onAction({ t: 'declareClaim', seat, claim: { kind: 'gong' } })}
      >
        Gong
      </button>
      <button
        type="button"
        onClick={() => onAction({ t: 'declareClaim', seat, claim: { kind: 'hu' } })}
      >
        Hu (Win)
      </button>
    </div>
  );
}

function ResultPanel({ onAction, mySeat }: { onAction: (a: Action) => void; mySeat: Seat }) {
  const state = useGame((s) => s.state)!;
  const r = state.lastResult!;
  // Rotate the dealer counter-clockwise unless the previous dealer won (HK convention).
  const nextDealer: Seat =
    r.kind === 'win' && r.winner === state.dealer
      ? state.dealer
      : (((state.dealer + 1) % 4) as Seat);
  return (
    <div style={{ marginTop: 16, padding: 12, background: '#1d2538', borderRadius: 6 }}>
      {r.kind === 'win' ? (
        <>
          <strong>Seat {r.winner} wins!</strong> {r.faan} faan (
          {r.selfDraw ? 'self-draw' : `from seat ${r.from}`}).
          <ul>
            {r.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      ) : (
        <strong>Drawn game (wall empty)</strong>
      )}
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={() => onAction({ t: 'startHand', seed: randomSeed(), dealer: nextDealer })}
        >
          Start next hand
        </button>{' '}
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          (you are seat {mySeat}; next dealer will be seat {nextDealer})
        </span>
      </div>
    </div>
  );
}
