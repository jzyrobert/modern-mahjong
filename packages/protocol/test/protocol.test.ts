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

  it('accepts an action envelope without deep-validating the action', () => {
    const r = parseClientMessage({
      t: 'action',
      action: { t: 'discard', seat: 0, tile: { kind: 'honor', honor: 'E', copy: 0 } },
    });
    expect(r.ok).toBe(true);
  });
});
