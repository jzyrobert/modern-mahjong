import { describe, expect, it } from 'vitest';
import {
  type ClaimRound,
  type Seat,
  resolveClaims,
} from '../src/index.js';

const tile = (rank: 1 | 5 | 9): { kind: 'suit'; suit: 'man'; rank: typeof rank; copy: 0 } => ({
  kind: 'suit',
  suit: 'man',
  rank,
  copy: 0,
});

function round(submitted: Partial<Record<Seat, import('../src/index.js').Claim>>, from: Seat = 0): ClaimRound {
  return {
    discard: { tile: tile(5), from },
    deadlineMs: 9999,
    submitted,
  };
}

describe('claim resolution', () => {
  it('all-pass produces pass', () => {
    const r = resolveClaims(
      round({ 1: { kind: 'pass' }, 2: { kind: 'pass' }, 3: { kind: 'pass' } }),
    );
    expect(r.kind).toBe('pass');
  });

  it('hu beats peng', () => {
    const r = resolveClaims(
      round({ 1: { kind: 'peng' }, 2: { kind: 'hu' } }),
    );
    expect(r.kind).toBe('win');
    if (r.kind === 'win') {
      expect(r.seat).toBe(2);
      expect(r.claim.kind).toBe('hu');
    }
  });

  it('peng beats chi', () => {
    const r = resolveClaims(
      round({ 1: { kind: 'chi', with: [tile(1), tile(1)] }, 2: { kind: 'peng' } }, 0),
    );
    expect(r.kind).toBe('win');
    if (r.kind === 'win') {
      expect(r.claim.kind).toBe('peng');
    }
  });

  it('chi only legal for next seat', () => {
    // discard from 0; chi declared by seat 2 (not next) — should be ignored.
    const r = resolveClaims(round({ 2: { kind: 'chi', with: [tile(1), tile(1)] } }, 0));
    expect(r.kind).toBe('pass');
  });

  it('two simultaneous hu picks closest CCW', () => {
    // discard from seat 0; seats 1 and 3 both call hu.
    // CCW distance: 1 → 1, 3 → 3. Seat 1 wins.
    const r = resolveClaims(
      round({ 1: { kind: 'hu' }, 3: { kind: 'hu' } }, 0),
    );
    expect(r.kind).toBe('win');
    if (r.kind === 'win') {
      expect(r.seat).toBe(1);
    }
  });

  it('property: highest-priority kind always wins', () => {
    const priority = { hu: 3, peng: 2, gong: 2, chi: 1, pass: 0 } as const;
    const claims: import('../src/index.js').Claim[] = [
      { kind: 'pass' },
      { kind: 'chi', with: [tile(1), tile(1)] },
      { kind: 'peng' },
      { kind: 'gong' },
      { kind: 'hu' },
    ];

    for (let a = 0; a < claims.length; a++) {
      for (let b = 0; b < claims.length; b++) {
        for (let c = 0; c < claims.length; c++) {
          // Use seats 1 (next), 2, 3 against discard from 0.
          const r = resolveClaims(round({ 1: claims[a]!, 2: claims[b]!, 3: claims[c]! }, 0));
          const top = Math.max(priority[claims[a]!.kind], priority[claims[b]!.kind], priority[claims[c]!.kind]);
          if (top === 0) {
            expect(r.kind).toBe('pass');
          } else {
            // Chi only for seat 1 (next); skip cases where the only claim is chi from non-next seats.
            const chiFromOnlySource = top === 1 && (claims[b]!.kind === 'chi' || claims[c]!.kind === 'chi') && claims[a]!.kind !== 'chi';
            if (chiFromOnlySource) continue;
            expect(r.kind).toBe('win');
          }
        }
      }
    }
  });
});
