import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  generateMatchCode,
  isValidMatchCode,
  parseClientMessage,
} from '../src/index.js';

describe('protocol — match codes', () => {
  it('generated codes are valid', () => {
    for (let i = 0; i < 100; i++) {
      const c = generateMatchCode();
      expect(isValidMatchCode(c)).toBe(true);
      expect(c.length).toBe(5);
    }
  });

  it('alphabet excludes confusing chars', () => {
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('rejects malformed codes', () => {
    expect(isValidMatchCode('ABC')).toBe(false);
    expect(isValidMatchCode('AB0CD')).toBe(false);
    expect(isValidMatchCode('AB1CD')).toBe(false);
  });
});

describe('protocol — message parsing', () => {
  it('accepts a well-formed hello', () => {
    const r = parseClientMessage({
      t: 'hello',
      playerId: 'p1',
      displayName: 'me',
      matchCode: 'ABCDE',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a missing field', () => {
    const r = parseClientMessage({ t: 'hello', playerId: 'p1' });
    expect(r.ok).toBe(false);
  });

  it('accepts an action envelope (discriminator + seat validated, tile passed through)', () => {
    const r = parseClientMessage({
      t: 'action',
      action: { t: 'discard', seat: 0, tile: { kind: 'honor', honor: 'E', copy: 0 } },
    });
    expect(r.ok).toBe(true);
  });

  it('accepts every action discriminator with minimum valid scalars', () => {
    const cases = [
      { t: 'startHand', seed: 0 },
      { t: 'startHand', seed: 1, dealer: 2 },
      { t: 'setRules', rules: {} },
      { t: 'draw', seat: 0 },
      { t: 'discard', seat: 1, tile: {} },
      { t: 'declareClaim', seat: 2, claim: { kind: 'pass' } },
      { t: 'resolveClaims', nowMs: 1700000000000 },
      { t: 'declareGangConcealed', seat: 3, tile: {} },
      { t: 'declareGangPromoted', seat: 0, tile: {} },
      { t: 'declareWin', seat: 1, selfDraw: false },
    ];
    for (const action of cases) {
      const r = parseClientMessage({ t: 'action', action });
      expect(r.ok, `action.t=${action.t}`).toBe(true);
    }
  });

  it('rejects an action envelope with no action body', () => {
    const r = parseClientMessage({ t: 'action' });
    expect(r.ok).toBe(false);
  });

  it('rejects an action with an unknown discriminator', () => {
    const r = parseClientMessage({ t: 'action', action: { t: 'discardX', seat: 0, tile: {} } });
    expect(r.ok).toBe(false);
  });

  it('rejects an action with a non-numeric seat', () => {
    const r = parseClientMessage({ t: 'action', action: { t: 'draw', seat: 'foo' } });
    expect(r.ok).toBe(false);
  });

  it('rejects an action with an out-of-range seat', () => {
    const r1 = parseClientMessage({ t: 'action', action: { t: 'draw', seat: 4 } });
    expect(r1.ok).toBe(false);
    const r2 = parseClientMessage({ t: 'action', action: { t: 'draw', seat: -1 } });
    expect(r2.ok).toBe(false);
  });

  it('rejects declareWin missing selfDraw', () => {
    const r = parseClientMessage({ t: 'action', action: { t: 'declareWin', seat: 0 } });
    expect(r.ok).toBe(false);
  });

  it('rejects resolveClaims with a non-numeric nowMs', () => {
    const r = parseClientMessage({ t: 'action', action: { t: 'resolveClaims', nowMs: 'now' } });
    expect(r.ok).toBe(false);
  });

  it('accepts a seatBot message', () => {
    const r = parseClientMessage({ t: 'seatBot', seat: 1, kind: 'heuristic' });
    expect(r.ok).toBe(true);
  });

  it('rejects seatBot with an out-of-range seat', () => {
    const r = parseClientMessage({ t: 'seatBot', seat: 4, kind: 'heuristic' });
    expect(r.ok).toBe(false);
  });

  it('rejects seatBot with an unknown bot kind', () => {
    const r = parseClientMessage({ t: 'seatBot', seat: 1, kind: 'genius' });
    expect(r.ok).toBe(false);
  });

  it('accepts an unseatBot message', () => {
    const r = parseClientMessage({ t: 'unseatBot', seat: 2 });
    expect(r.ok).toBe(true);
  });
});
