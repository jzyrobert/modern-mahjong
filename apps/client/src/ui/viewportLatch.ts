/**
 * The pure half of `useStableViewportHeight`: which viewport to key
 * layout on given the one latched so far and the live one — the
 * previous while only the height moved (browser chrome: Android
 * Chrome's URL bar retracting mid-scroll, an older Chrome's soft
 * keyboard), the live one once the width has (orientation flip, window
 * drag, split screen). Pure (no React / RN) so vitest can drive it.
 */
export interface LatchedViewport {
  width: number;
  height: number;
}

export function latchViewportHeight(prev: LatchedViewport, live: LatchedViewport): LatchedViewport {
  return prev.width === live.width ? prev : live;
}
