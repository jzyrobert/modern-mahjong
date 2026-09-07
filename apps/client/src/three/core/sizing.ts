/**
 * Sizing a scene runtime to its host, and what the size change means
 * for the frame on screen — the pure half of `SceneHost.applySize`,
 * split out so the contract is unit-testable without a WebGL context.
 */
export interface SizableRuntime {
  /** CSS-pixel size, shared with the scene through `SceneContext`. */
  size: { width: number; height: number };
  sizedOnce: boolean;
  minDpr: number | undefined;
  maxDpr: number | undefined;
  quality: { maxDpr: number };
  renderer: {
    setPixelRatio(dpr: number): void;
    setSize(width: number, height: number, updateStyle: boolean): void;
    getPixelRatio(): number;
  };
  rig: { setAspect(aspect: number): void };
  handle: { resize?: ((width: number, height: number) => void) | undefined } | null;
  loop: { renderNow(): void; requestRender(): void };
}

export type SizeOutcome = 'unchanged' | 'first' | 'resized';

/**
 * Size the renderer to `w × h` CSS px at the clamped device pixel ratio.
 *
 * - `unchanged`: nothing differs from the current size / dpr (the
 *   ResizeObserver's initial callback, a `resize` event that didn't
 *   touch this host) — no work, no render.
 * - `first`: the first sizing after (re)attach. Nothing is on screen
 *   yet (the host fades in on `onReady`), so the frame waits for the
 *   loop's rAF and the veiled warm-up frame it drives.
 * - `resized`: a presented frame's canvas was re-allocated.
 *   `renderer.setSize` hands back a *cleared* drawing buffer, and the
 *   callback that got us here (ResizeObserver / `resize`) runs before
 *   the compositor takes the frame — so the scene is redrawn right
 *   here, in the same task, or the page shows an empty canvas until
 *   the next animation frame (the menu's tiles blinking while Android
 *   Chrome's URL bar retracts mid-scroll).
 */
export function applyHostSize(
  rt: SizableRuntime,
  w: number,
  h: number,
  devicePixelRatio: number,
): SizeOutcome {
  const dpr = Math.max(
    rt.minDpr ?? 0,
    Math.min(devicePixelRatio || 1, rt.maxDpr ?? rt.quality.maxDpr),
  );
  if (
    rt.sizedOnce &&
    w === rt.size.width &&
    h === rt.size.height &&
    dpr === rt.renderer.getPixelRatio()
  )
    return 'unchanged';
  const outcome: SizeOutcome = rt.sizedOnce ? 'resized' : 'first';
  rt.sizedOnce = true;
  rt.size.width = w;
  rt.size.height = h;
  rt.renderer.setPixelRatio(dpr);
  rt.renderer.setSize(w, h, false);
  rt.rig.setAspect(w / h);
  rt.handle?.resize?.(w, h);
  if (outcome === 'resized') rt.loop.renderNow();
  else rt.loop.requestRender();
  return outcome;
}
