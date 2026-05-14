import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayRecord } from './types';

// Mock expo-clipboard before importing the module under test — the
// real module is a thin native bridge that doesn't load in jsdom.
const setStringAsyncMock = vi.fn();
vi.mock('expo-clipboard', () => ({
  setStringAsync: (text: string) => setStringAsyncMock(text),
}));

import { exportRecordToClipboard, tryImportRecord } from './exportImport';
import { listHeaders, loadRecord } from './storage';

function makeRecord(overrides: Partial<ReplayRecord['header']> = {}): ReplayRecord {
  return {
    header: {
      id: 'fixed-id',
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
    frames: [
      {
        seq: 0,
        ts: 0,
        // The export/import flow only validates envelope shape, not
        // engine-state shape — a stub is enough.
        state: {} as ReplayRecord['frames'][0]['state'],
        events: [],
      },
    ],
    bookmarks: [],
  };
}

beforeEach(() => {
  localStorage.clear();
  setStringAsyncMock.mockReset();
  setStringAsyncMock.mockResolvedValue(undefined);
});

afterEach(() => {
  localStorage.clear();
});

describe('exportRecordToClipboard', () => {
  it('serialises the record into an envelope and copies it', async () => {
    const rec = makeRecord();
    const bytes = await exportRecordToClipboard(rec);
    expect(setStringAsyncMock).toHaveBeenCalledTimes(1);
    const arg = setStringAsyncMock.mock.calls[0]![0] as string;
    const parsed = JSON.parse(arg);
    expect(parsed.version).toBe(1);
    expect(parsed.record.header.id).toBe('fixed-id');
    expect(bytes).toBe(arg.length);
  });
});

describe('tryImportRecord', () => {
  it('saves a fresh record under a freshly-minted id', () => {
    const rec = makeRecord({ id: 'imported-1' });
    const json = JSON.stringify({ version: 1, record: rec });
    const result = tryImportRecord(json, 50);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.record.header.id).not.toBe('imported-1');
      expect(loadRecord(result.record.header.id)).not.toBeNull();
    }
    expect(listHeaders()).toHaveLength(1);
  });

  it('errors on malformed JSON', () => {
    const result = tryImportRecord('{not json', 50);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error).toMatch(/Not valid JSON/);
    }
  });

  it('errors on a wrong-version envelope', () => {
    const json = JSON.stringify({ version: 2, record: makeRecord() });
    const result = tryImportRecord(json, 50);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error).toMatch(/Unsupported replay version/);
    }
  });

  it('errors when the record field is missing', () => {
    const json = JSON.stringify({ version: 1 });
    const result = tryImportRecord(json, 50);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error).toMatch(/Missing `record`/);
    }
  });

  it('errors when frames is empty or not an array', () => {
    const rec = makeRecord();
    const json = JSON.stringify({ version: 1, record: { ...rec, frames: [] } });
    const result = tryImportRecord(json, 50);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error).toMatch(/no frames/);
    }
  });

  it('errors when header is missing', () => {
    const json = JSON.stringify({
      version: 1,
      record: { frames: [{}], bookmarks: [] },
    });
    const result = tryImportRecord(json, 50);
    expect(result.kind).toBe('error');
  });

  it('errors when bookmarks is missing', () => {
    const rec = makeRecord();
    // biome-ignore lint/performance/noDelete: stripping the optional field for the test fixture
    delete (rec as Partial<ReplayRecord>).bookmarks;
    const json = JSON.stringify({ version: 1, record: rec });
    const result = tryImportRecord(json, 50);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error).toMatch(/Missing `bookmarks`/);
    }
  });

  it('errors when the top level is not an object', () => {
    const json = JSON.stringify('a bare string');
    const result = tryImportRecord(json, 50);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.error).toMatch(/JSON object/);
    }
  });
});
