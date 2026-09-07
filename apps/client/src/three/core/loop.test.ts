import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Loop } from './loop';
import type { PerfMonitor } from './perf';

/**
 * Drive the loop by hand: `requestAnimationFrame` queues callbacks that
 * `frame(now)` flushes one at a time, so a test controls exactly which
 * ticks happen and when.
 */
let queue: FrameRequestCallback[] = [];
function frame(now: number): void {
  const cbs = queue;
  queue = [];
  for (const cb of cbs) cb(now);
}

function fakePerf() {
  const frames: number[] = [];
  const publishes: boolean[] = [];
  const perf = {
    recordFrame: (cost: number) => frames.push(cost),
    maybePublish: (_now: number, force?: boolean) => publishes.push(force === true),
    p95: () => 0,
  } as unknown as PerfMonitor;
  return { perf, frames, publishes };
}

describe('Loop.renderNow', () => {
  beforeEach(() => {
    queue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('renders synchronously, without running updaters or counting a perf frame', () => {
    const render = vi.fn();
    const updater = vi.fn(() => false);
    const { perf, frames } = fakePerf();
    const loop = new Loop({ renderer: {} as never, render, perf });
    loop.add(updater);
    loop.renderNow();
    expect(render).toHaveBeenCalledTimes(1);
    expect(updater).not.toHaveBeenCalled();
    expect(frames).toEqual([]);
  });

  test('clears the pending request: a quiet tick afterwards does not render again', () => {
    const render = vi.fn();
    const { perf } = fakePerf();
    const loop = new Loop({ renderer: {} as never, render, perf });
    loop.add(() => false);
    loop.start();
    frame(16); // the first tick renders (the loop starts dirty)
    expect(render).toHaveBeenCalledTimes(1);
    loop.requestRender();
    loop.renderNow();
    expect(render).toHaveBeenCalledTimes(2);
    frame(32);
    expect(render).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  test('`requestRender` keeps its meaning: the next tick renders once and records the frame', () => {
    const render = vi.fn();
    const { perf, frames } = fakePerf();
    const loop = new Loop({ renderer: {} as never, render, perf });
    loop.start();
    frame(16);
    loop.requestRender();
    frame(32);
    expect(render).toHaveBeenCalledTimes(2);
    expect(frames).toHaveLength(2);
    frame(48);
    expect(render).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  test('a live updater still renders every tick after a renderNow', () => {
    const render = vi.fn();
    const { perf } = fakePerf();
    const loop = new Loop({ renderer: {} as never, render, perf });
    loop.add(() => true);
    loop.start();
    loop.renderNow();
    frame(16);
    frame(32);
    expect(render).toHaveBeenCalledTimes(3);
    loop.stop();
  });
});
