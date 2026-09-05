import { useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { type LatchedViewport, latchViewportHeight } from './viewportLatch';

/**
 * The viewport height for layout that must not move while the page
 * scrolls: `useWindowDimensions().height` latched at the last *width*
 * change.
 *
 * On web, browser chrome changes the height on its own — Android Chrome
 * retracts its URL bar as the page scrolls (`innerHeight` grows by
 * 56–100 px mid-scroll and shrinks again on the way back up), older
 * Chromes resize for the soft keyboard — and anything sized from the
 * live height (the lobby's hero band, and with it the hero canvas and
 * the whole card stack under it) reflowed under the user's finger
 * (round-4 feedback: "the tiles flicker when scrolling"). A real resize
 * — an orientation flip, a window drag, a split-screen change — moves
 * the width too, and the latch follows. The trade-off: a desktop window
 * dragged taller or shorter *only* keeps its height until the width
 * moves, which is what `matchMedia`-based orientation already accepts
 * (`useIsLandscape`).
 *
 * Native reports the stable layout viewport already and passes the live
 * value through.
 */
export function useStableViewportHeight(): number {
  const live = useWindowDimensions();
  const [latched, setLatched] = useState<LatchedViewport>(live);
  if (Platform.OS !== 'web') return live.height;
  const next = latchViewportHeight(latched, live);
  // Adjusting state during render (React's sanctioned pattern for a
  // value derived from a changed input): the new width is committed for
  // the next height comparison, and this render already uses it.
  if (next !== latched) setLatched(next);
  return next.height;
}
