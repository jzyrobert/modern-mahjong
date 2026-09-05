import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';
import { type HeroBand, getHeroBand, setHeroBand, subscribeHeroBand } from './heroBand';

let scheduled = false;
const measurers = new Set<() => void>();

/** One rAF-throttled re-measure for every slot on scroll / resize. */
function scheduleMeasure(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const m of measurers) m();
  });
}

let listenersInstalled = false;
function ensureListeners(): void {
  if (listenersInstalled || typeof document === 'undefined') return;
  listenersInstalled = true;
  // Capture phase so scrolls inside the lobby ScrollView (a div) reach us.
  document.addEventListener('scroll', scheduleMeasure, { capture: true, passive: true });
  window.addEventListener('resize', scheduleMeasure);
}

/**
 * The empty band the lobby reserves under its title block for the hero
 * (the 3D rack + dice, or the classic DOM fan). Renders nothing
 * visible; on web it measures itself and publishes the rect through
 * `heroBand.ts` so the backdrop can place the hero *below the measured
 * title* instead of at a viewport fraction — the fix for the title text
 * running across the tile tops on short phones.
 *
 * The rect is the slot's live window rect, re-measured on scroll: the
 * backdrop itself never scrolls, so this is what makes the hero travel
 * with the title it belongs to instead of staying put while the glass
 * cards slide over it (round-1 feedback: the ivory rack ghosting
 * through the Online card's form). Also re-measured on layout, on
 * resize, once the web fonts have landed (the heading reflows) and once
 * more after the entrance choreography.
 */
export function HeroBandSlot({
  style,
  testID = 'hero-band',
}: { style?: ViewStyle; testID?: string }) {
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.getBoundingClientRect !== 'function') return;
    const r = node.getBoundingClientRect();
    setHeroBand({ x: r.left, y: r.top, w: r.width, h: r.height });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    ensureListeners();
    measurers.add(measure);
    measure();
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    let alive = true;
    fonts?.ready?.then(() => {
      if (alive) measure();
    });
    const settle = setTimeout(measure, 800);
    return () => {
      alive = false;
      clearTimeout(settle);
      measurers.delete(measure);
      setHeroBand(null);
    };
  }, [measure]);

  return <View ref={ref} onLayout={measure} pointerEvents="none" testID={testID} style={style} />;
}

const getServerBand = () => null;

/** The measured hero band, re-rendering on change (`null` off-web /
 *  before the slot has laid out). */
export function useHeroBand(): HeroBand | null {
  return useSyncExternalStore(subscribeHeroBand, getHeroBand, getServerBand);
}
