import { describe, expect, test, vi } from 'vitest';
import { type SizableRuntime, applyHostSize } from './sizing';

function fakeRuntime(): SizableRuntime & { calls: string[] } {
  const calls: string[] = [];
  let ratio = 1;
  return {
    calls,
    size: { width: 1, height: 1 },
    sizedOnce: false,
    minDpr: undefined,
    maxDpr: undefined,
    quality: { maxDpr: 2 },
    renderer: {
      setPixelRatio: (d) => {
        ratio = d;
        calls.push(`dpr:${d}`);
      },
      setSize: (w, h) => calls.push(`size:${w}x${h}`),
      getPixelRatio: () => ratio,
    },
    rig: { setAspect: (a) => calls.push(`aspect:${a.toFixed(3)}`) },
    handle: { resize: (w, h) => calls.push(`resize:${w}x${h}`) },
    loop: {
      renderNow: () => calls.push('renderNow'),
      requestRender: () => calls.push('requestRender'),
    },
  };
}

describe('applyHostSize — the resize → redraw contract', () => {
  test('the first sizing sets up the renderer and waits for the loop (no synchronous render)', () => {
    const rt = fakeRuntime();
    expect(applyHostSize(rt, 412, 700, 2)).toBe('first');
    expect(rt.size).toEqual({ width: 412, height: 700 });
    expect(rt.calls).toEqual([
      'dpr:2',
      'size:412x700',
      `aspect:${(412 / 700).toFixed(3)}`,
      'resize:412x700',
      'requestRender',
    ]);
  });

  test('an identical size and dpr is a no-op (the observer’s initial callback, an unrelated resize event)', () => {
    const rt = fakeRuntime();
    applyHostSize(rt, 412, 700, 2);
    rt.calls.length = 0;
    expect(applyHostSize(rt, 412, 700, 2)).toBe('unchanged');
    expect(rt.calls).toEqual([]);
  });

  test('a real size change re-allocates the buffer and renders synchronously, after the scene’s own resize', () => {
    const rt = fakeRuntime();
    applyHostSize(rt, 412, 700, 2);
    rt.calls.length = 0;
    // Android Chrome's URL bar retracting: +100 px of height mid-scroll.
    expect(applyHostSize(rt, 412, 800, 2)).toBe('resized');
    expect(rt.calls).toEqual([
      'dpr:2',
      'size:412x800',
      `aspect:${(412 / 800).toFixed(3)}`,
      'resize:412x800',
      'renderNow',
    ]);
    expect(rt.calls).not.toContain('requestRender');
    expect(rt.size).toEqual({ width: 412, height: 800 });
  });

  test('a dpr change alone (quality downgrade) also redraws in the same task', () => {
    const rt = fakeRuntime();
    applyHostSize(rt, 412, 700, 2);
    rt.quality.maxDpr = 1.5;
    rt.calls.length = 0;
    expect(applyHostSize(rt, 412, 700, 2)).toBe('resized');
    expect(rt.calls[0]).toBe('dpr:1.5');
    expect(rt.calls.at(-1)).toBe('renderNow');
  });

  test('dpr clamps: `maxDpr` overrides the tier cap, `minDpr` lifts a dpr-1 display', () => {
    const rt = fakeRuntime();
    rt.maxDpr = 3;
    applyHostSize(rt, 100, 100, 3);
    expect(rt.calls[0]).toBe('dpr:3');
    const lifted = fakeRuntime();
    lifted.minDpr = 2;
    applyHostSize(lifted, 100, 100, 1);
    expect(lifted.calls[0]).toBe('dpr:2');
  });

  test('a runtime without a scene handle still sizes (mid-rebuild)', () => {
    const rt = fakeRuntime();
    rt.handle = null;
    const render = vi.fn();
    rt.loop.renderNow = render;
    applyHostSize(rt, 300, 200, 1);
    applyHostSize(rt, 300, 250, 1);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
