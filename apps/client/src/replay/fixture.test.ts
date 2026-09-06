import { describe, expect, test } from 'vitest';
import { FIXTURE_MID_FRAME, buildReplayFixture, replayFixtureId } from './fixture';
import { computeVisibleSeqs } from './playback';
import { listHeaders, loadRecord } from './storage';

describe('buildReplayFixture', () => {
  test('plays the requested hands to a result and records every action', () => {
    const rec = buildReplayFixture({ seed: 5, hands: 2 });
    expect(rec.header.id).toBe(replayFixtureId(5));
    expect(rec.header.handsPlayed).toBe(2);
    expect(rec.frames[0]!.events).toEqual([]);
    expect(rec.frames[0]!.state.phase).toBe('waiting');
    const last = rec.frames[rec.frames.length - 1]!;
    expect(last.state.phase).toBe('resolved');
    expect(rec.frames.filter((f) => f.events.some((e) => e.t === 'handStarted'))).toHaveLength(2);
    // Frame seq / ts are monotonic like the live recorder's.
    rec.frames.forEach((f, i) => {
      expect(f.seq).toBe(i);
      if (i > 0) expect(f.ts).toBeGreaterThan(rec.frames[i - 1]!.ts);
    });
    expect(rec.bookmarks.filter((b) => b.kind === 'hand-start')).toHaveLength(2);
    expect(rec.bookmarks.some((b) => b.kind === 'win' || b.kind === 'draw')).toBe(true);
  });

  test('is deterministic for a seed', () => {
    // Claim-window deadlines are wall-clock stamps (`Date.now()` in the
    // engine); everything else — deal, draws, discards, claims — is a
    // function of the seed.
    const strip = (k: string, v: unknown) => (k === 'deadlineMs' ? undefined : v);
    const a = buildReplayFixture({ seed: 5, hands: 2, startedAt: 0 });
    const b = buildReplayFixture({ seed: 5, hands: 2, startedAt: 0 });
    expect(JSON.stringify(a, strip)).toBe(JSON.stringify(b, strip));
  });

  test('the mid-frame recipe constant lands on a busy table', () => {
    // `replay-player-mid` deep-links to `?frame=FIXTURE_MID_FRAME` (a
    // visible-frame cursor) and expects exposed melds and a well-filled
    // river — keep that recipe honest against the fixture.
    const rec = buildReplayFixture({ seed: 5, hands: 2 });
    const visible = computeVisibleSeqs(rec.frames);
    expect(visible.length).toBeGreaterThan(FIXTURE_MID_FRAME + 20);
    const st = rec.frames[visible[FIXTURE_MID_FRAME]!]!.state;
    expect(st.phase).toBe('turn');
    expect(st.discardOrder.length).toBeGreaterThanOrEqual(36);
    expect(Object.values(st.melds).reduce((n, m) => n + m.length, 0)).toBeGreaterThanOrEqual(4);
    // Hand 2 starts after it, so the end frame is a different hand's result.
    const starts = rec.frames
      .map((f, i) => (f.events.some((e) => e.t === 'handStarted') ? i : -1))
      .filter((i) => i >= 0);
    expect(starts).toHaveLength(2);
    expect(starts[1]!).toBeGreaterThan(visible[FIXTURE_MID_FRAME]!);
    expect(rec.frames[rec.frames.length - 1]!.state.lastResult?.kind).toBe('win');
  });

  test('the test hatch saves the record to the library', () => {
    const id = globalThis.__MAHJONG_TEST_REPLAY_FIXTURE__!({ seed: 7, hands: 1 });
    expect(id).toBe(replayFixtureId(7));
    expect(listHeaders().some((h) => h.id === id)).toBe(true);
    expect(loadRecord(id)?.frames.length).toBeGreaterThan(10);
  });
});
