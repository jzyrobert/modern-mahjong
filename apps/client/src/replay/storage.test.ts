import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approximateStorageBytes,
  clearAll,
  deleteRecord,
  listHeaders,
  loadRecord,
  saveRecord,
} from './storage';
import type { ReplayRecord } from './types';

function makeRecord(overrides: Partial<ReplayRecord['header']> = {}): ReplayRecord {
  const id = overrides.id ?? Math.random().toString(36).slice(2);
  return {
    header: {
      id,
      matchCode: 'TEST',
      joinKind: 'solo',
      startedAt: 1700000000000,
      endedAt: 1700000060000,
      durationMs: 60000,
      localPlayerId: 'p1',
      localSeat: 0,
      localDisplayName: 'Tester',
      players: { 0: null, 1: null, 2: null, 3: null },
      finalScoreboard: { 0: 0, 1: 0, 2: 0, 3: 0 },
      handsPlayed: 1,
      engineVersion: 'test',
      rules: {
        faanMin: 3,
        allowSevenPairs: true,
        allowThirteenOrphans: true,
        turnTimeoutMs: 0,
        claimWindowMs: 0,
      },
      ...overrides,
    },
    frames: [],
    bookmarks: [],
  };
}

beforeEach(() => {
  clearAll();
  localStorage.clear();
});

afterEach(() => {
  clearAll();
  localStorage.clear();
});

describe('replay storage', () => {
  it('round-trips a saved record through loadRecord', () => {
    const rec = makeRecord({ id: 'r1' });
    expect(saveRecord(rec, 50)).toBe(true);
    const loaded = loadRecord('r1');
    expect(loaded).not.toBeNull();
    expect(loaded?.header.id).toBe('r1');
    expect(loaded?.header.matchCode).toBe('TEST');
  });

  it('lists headers most-recent-first', () => {
    saveRecord(makeRecord({ id: 'a' }), 50);
    saveRecord(makeRecord({ id: 'b' }), 50);
    saveRecord(makeRecord({ id: 'c' }), 50);
    const headers = listHeaders();
    expect(headers.map((h) => h.id)).toEqual(['c', 'b', 'a']);
  });

  it('updates an existing record in place without duplicating the header entry', () => {
    saveRecord(makeRecord({ id: 'r1', handsPlayed: 1 }), 50);
    saveRecord(makeRecord({ id: 'r1', handsPlayed: 5 }), 50);
    const headers = listHeaders();
    expect(headers).toHaveLength(1);
    expect(headers[0]!.handsPlayed).toBe(5);
  });

  it('prunes the oldest entries past the quota cap and deletes their record keys', () => {
    for (let i = 0; i < 5; i++) saveRecord(makeRecord({ id: `r${i}` }), 50);
    // Save 3 more with quota = 3 → r0/r1/r2/r3/r4 + 3 newest = 8 total,
    // newest-first; quota = 3 keeps the 3 most-recent.
    saveRecord(makeRecord({ id: 'r5' }), 3);
    saveRecord(makeRecord({ id: 'r6' }), 3);
    saveRecord(makeRecord({ id: 'r7' }), 3);
    const headers = listHeaders();
    expect(headers.map((h) => h.id)).toEqual(['r7', 'r6', 'r5']);
    // The pruned ones should be gone from disk too.
    expect(loadRecord('r0')).toBeNull();
    expect(loadRecord('r4')).toBeNull();
    expect(loadRecord('r5')).not.toBeNull();
  });

  it('deleteRecord removes both the index entry and the payload', () => {
    saveRecord(makeRecord({ id: 'r1' }), 50);
    saveRecord(makeRecord({ id: 'r2' }), 50);
    deleteRecord('r1');
    expect(loadRecord('r1')).toBeNull();
    expect(listHeaders().map((h) => h.id)).toEqual(['r2']);
  });

  it('approximateStorageBytes sums all stored payload lengths', () => {
    expect(approximateStorageBytes()).toBe(0);
    saveRecord(makeRecord({ id: 'r1' }), 50);
    const after = approximateStorageBytes();
    expect(after).toBeGreaterThan(0);
  });

  it('returns false from saveRecord when the underlying setItem throws', () => {
    // jsdom's localStorage methods aren't directly assignable, but
    // vi.spyOn handles the descriptor dance. Throw once (the record
    // write) — saveRecord catches and returns false before reaching
    // the index write.
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    try {
      const ok = saveRecord(makeRecord({ id: 'r-failing' }), 50);
      expect(ok).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('loadRecord returns null for malformed JSON or wrong-version envelopes', () => {
    localStorage.setItem('mj.replay.v1.junk', 'this is not JSON');
    expect(loadRecord('junk')).toBeNull();
    localStorage.setItem('mj.replay.v1.v2', JSON.stringify({ version: 2, record: {} }));
    expect(loadRecord('v2')).toBeNull();
  });

  it('listHeaders recovers from a malformed index', () => {
    localStorage.setItem('mj.replay.v1.index', '{not json');
    expect(listHeaders()).toEqual([]);
    localStorage.setItem(
      'mj.replay.v1.index',
      JSON.stringify({ version: 99, headers: [{ id: 'x' }] }),
    );
    expect(listHeaders()).toEqual([]);
  });
});
