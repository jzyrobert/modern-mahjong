import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';
import { useGame } from '../../state/game';
import { Menu3DHero } from '../../three/entry';
import { resolveMenuBackdrop } from '../../three/renderer';
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
 * The band the lobby reserves under its title block for the hero.
 *
 * Under the 3D renderer it *hosts* the hero: the rack + dice render
 * into a canvas mounted here (`Menu3DHero` → `HeroSceneView`), sized
 * to the band. The band is ScrollView content, so the compositor moves
 * the rack with the title — no scroll listener re-aims a camera, which
 * is what had the rack redrawn a frame behind the title on Android
 * Chrome (round-3 feedback: "the background tiles jitter when
 * scrolling"). Under the classic renderer the slot stays empty and the
 * DOM fan in the backdrop centres itself in it.
 *
 * On web it also measures itself and publishes its live window rect
 * through `heroBand.ts`: the classic fan reads it, and the fixed drift
 * field behind the page (`DriftScene`) reads it for its scale (band
 * size) and for the rack keep-out that must keep following the rack
 * as it scrolls. Re-measured on layout, on scroll, on resize, once the
 * web fonts have landed (the heading reflows) and once more after the
 * entrance choreography.
 */
export function HeroBandSlot({
  style,
  testID = 'hero-band',
}: { style?: ViewStyle; testID?: string }) {
  const ref = useRef<View>(null);
  const rendererSetting = useGame((s) => s.settings.renderer);
  // Same gate as `LobbyBackdrop`: under `auto` the low quality tier
  // keeps the DOM-only menu — see `resolveMenuBackdrop`.
  const use3d =
    Platform.OS === 'web' && Menu3DHero !== null && resolveMenuBackdrop(rendererSetting);
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

  return (
    <View ref={ref} onLayout={measure} pointerEvents="none" testID={testID} style={style}>
      {use3d && Menu3DHero ? <Menu3DHero /> : null}
    </View>
  );
}

const getServerBand = () => null;

/** The measured hero band, re-rendering on change (`null` off-web /
 *  before the slot has laid out). */
export function useHeroBand(): HeroBand | null {
  return useSyncExternalStore(subscribeHeroBand, getHeroBand, getServerBand);
}
