import type { Action, Claim, Seat } from '@mahjong/game-logic';
import { legalClaimsFor } from '@mahjong/game-logic';
import { HAIRLINE, INK, INK_3, PAPER_HI, SANS } from '../native/theme.js';
import { useGame } from '../state/game.js';
import { type CallAction, CallButton } from './match/CallButton.js';

interface ClaimBarProps {
  onAction: (a: Action) => void;
  seat: Seat;
}

interface ClaimChoice {
  /** Engine claim kind. */
  kind: Claim['kind'];
  /** Visual label / colour scheme. */
  action: CallAction;
}

const CHOICES: readonly ClaimChoice[] = [
  { kind: 'chi', action: 'chow' },
  { kind: 'peng', action: 'pung' },
  { kind: 'gong', action: 'kong' },
  { kind: 'hu', action: 'win' },
  { kind: 'pass', action: 'pass' },
];

/**
 * Claim bar shown when the local seat has an actual claim opportunity
 * against the latest discard. Renders the design's CallButton style with
 * gradient + bilingual labels (吃 Chow / 碰 Pung / 槓 Kong / 糊 Win / 過 Pass).
 *
 * Gating logic from PR #35 is unchanged — Match.tsx checks
 * `legalClaimsFor + isWinning` before rendering this bar at all, so the
 * inner buttons just need to disable any individual options that aren't
 * legal for this seat.
 */
export function ClaimBar({ onAction, seat }: ClaimBarProps) {
  const state = useGame((s) => s.state);
  const legal = state ? new Set(legalClaimsFor(state, seat)) : new Set<Claim['kind']>();
  // hu requires a shanten/scoring check we don't repeat client-side; let the
  // server reject it if the seat's hand isn't actually winning.
  legal.add('hu');
  legal.add('pass');

  return (
    <div
      style={{
        marginTop: 12,
        padding: '12px 16px',
        background: PAPER_HI,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 14,
        boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontFamily: SANS,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: INK_3,
        }}
      >
        Claim?
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {CHOICES.filter((c) => legal.has(c.kind)).map((c) => (
          <CallButton
            key={c.kind}
            action={c.action}
            onClick={() => onAction({ t: 'declareClaim', seat, claim: claimFor(c.kind) })}
          />
        ))}
      </div>
      <span
        style={{
          marginLeft: 'auto',
          fontFamily: SANS,
          fontSize: 11,
          fontWeight: 700,
          color: INK,
          opacity: 0.6,
        }}
      >
        Auto-pass when the timer runs out.
      </span>
    </div>
  );
}

function claimFor(kind: Claim['kind']): Claim {
  if (kind === 'chi') {
    throw new Error('chi requires explicit tile selection — not used by ClaimBar');
  }
  return { kind } as Claim;
}
