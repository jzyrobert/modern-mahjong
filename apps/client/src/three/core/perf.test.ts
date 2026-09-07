import { afterEach, describe, expect, test } from 'vitest';
import { PerfMonitor, WARMUP_FRAMES, resetPerfMonitorsForTests } from './perf';

/** The slice of `WebGLRenderer` the monitor reads. */
function fakeRenderer(o: { calls: number; tris: number; textures: number; programs: number }) {
  return {
    info: {
      render: { calls: o.calls, triangles: o.tris },
      memory: { textures: o.textures, geometries: 1 },
      programs: new Array(o.programs).fill(null),
    },
    getSize: (v: { x: number; y: number; set(x: number, y: number): unknown }) => {
      v.x = 400;
      v.y = 300;
      return v;
    },
    getPixelRatio: () => 2,
  } as unknown as ConstructorParameters<typeof PerfMonitor>[0];
}

function renderFrames(m: PerfMonitor, n: number, ms: number, from = 0) {
  for (let i = 0; i < n; i++) m.recordFrame(ms, from + i * 16);
}

describe('PerfMonitor page aggregation', () => {
  afterEach(() => resetPerfMonitorsForTests());

  test('one live monitor publishes its own snapshot unchanged', () => {
    const m = new PerfMonitor(fakeRenderer({ calls: 5, tris: 25_000, textures: 5, programs: 4 }));
    renderFrames(m, WARMUP_FRAMES + 3, 2);
    m.maybePublish(1000, true);
    const snap = globalThis.__MAHJONG_PERF__;
    expect(snap).toBeTruthy();
    expect(snap?.drawCalls).toBe(5);
    expect(snap?.triangles).toBe(25_000);
    expect(snap?.programs).toBe(4);
    expect(snap?.textures).toBe(5);
    expect(snap?.renders).toBe(WARMUP_FRAMES + 3);
    expect(snap?.sample).toBe(1);
    m.maybePublish(2100);
    expect(globalThis.__MAHJONG_PERF__?.sample).toBe(2);
  });

  test('two live monitors publish the page total: work counters sum, idle needs both idle', () => {
    const hero = new PerfMonitor(
      fakeRenderer({ calls: 5, tris: 20_000, textures: 3, programs: 5 }),
    );
    const drift = new PerfMonitor(
      fakeRenderer({ calls: 1, tris: 6_000, textures: 2, programs: 2 }),
    );
    // Frames land in the 800..1000 ms window: busy at t = 1000.
    renderFrames(hero, WARMUP_FRAMES + 2, 3, 800);
    renderFrames(drift, WARMUP_FRAMES + 8, 1, 800);
    hero.maybePublish(1000, true);
    drift.maybePublish(1000, true);
    const snap = globalThis.__MAHJONG_PERF__;
    expect(snap?.drawCalls).toBe(6);
    expect(snap?.triangles).toBe(26_000);
    expect(snap?.textures).toBe(5);
    expect(snap?.programs).toBe(7);
    expect(snap?.renders).toBe(WARMUP_FRAMES * 2 + 10);
    expect(snap?.fps).toBe(WARMUP_FRAMES * 2 + 10);
    // JS frame times add up (both canvases render in the same rAF).
    expect(snap?.frameMsP95).toBe(4);
    // Neither has been quiet for 500 ms at t = 1000 → not idle…
    expect(snap?.idle).toBe(false);
    // …and once both have, the page is idle; the sample keeps advancing.
    hero.maybePublish(2100);
    drift.maybePublish(2100);
    expect(globalThis.__MAHJONG_PERF__?.idle).toBe(true);
    expect(globalThis.__MAHJONG_PERF__?.sample).toBe(4);
  });

  test('disposing one monitor leaves the other’s numbers; disposing the last clears the global', () => {
    const a = new PerfMonitor(fakeRenderer({ calls: 5, tris: 20_000, textures: 3, programs: 5 }));
    const b = new PerfMonitor(fakeRenderer({ calls: 1, tris: 6_000, textures: 2, programs: 2 }));
    a.maybePublish(1000, true);
    b.maybePublish(1000, true);
    expect(globalThis.__MAHJONG_PERF__?.drawCalls).toBe(6);
    b.dispose();
    expect(globalThis.__MAHJONG_PERF__?.drawCalls).toBe(5);
    a.dispose();
    expect(globalThis.__MAHJONG_PERF__).toBeUndefined();
    // A parked runtime re-attaching (`reset`) rejoins the page total.
    a.reset();
    a.maybePublish(3000, true);
    expect(globalThis.__MAHJONG_PERF__?.drawCalls).toBe(5);
  });
});
