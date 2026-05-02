import type { Action, Claim, Seat } from '@mahjong/game-logic';
import { legalClaimsFor } from '@mahjong/game-logic';
import { useGame } from '../state/game.js';

interface ClaimBarProps {
  onAction: (a: Action) => void;
  seat: Seat;
}

const BUTTONS: { kind: Claim['kind']; label: string }[] = [
  { kind: 'pass', label: 'Pass' },
  { kind: 'peng', label: 'Peng' },
  { kind: 'gong', label: 'Gong' },
  { kind: 'hu', label: 'Hu (Win)' },
];

export function ClaimBar({ onAction, seat }: ClaimBarProps) {
  const state = useGame((s) => s.state);
  const legal = state ? new Set(legalClaimsFor(state, seat)) : new Set<Claim['kind']>();
  // hu requires a shanten/scoring check we don't repeat client-side; let the server reject.
  legal.add('hu');
  legal.add('pass');

  return (
    <div style={{ marginTop: 12, padding: 8, border: '1px dashed #f3c54a', borderRadius: 6 }}>
      <span style={{ marginRight: 8 }}>Claim?</span>
      {BUTTONS.map(({ kind, label }) => (
        <button
          key={kind}
          type="button"
          disabled={!legal.has(kind)}
          onClick={() => onAction({ t: 'declareClaim', seat, claim: claimFor(kind) })}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function claimFor(kind: Claim['kind']): Claim {
  if (kind === 'chi') {
    throw new Error('chi requires explicit tile selection — not used by ClaimBar');
  }
  return { kind } as Claim;
}
