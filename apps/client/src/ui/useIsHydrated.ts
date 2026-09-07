import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` while React is rendering HTML that has to match a pre-rendered
 * document — the Expo Router static render in Node (`web.output:
 * "static"`) and the client's hydration pass over that HTML — and `true`
 * on every render after hydration commits. On native, and on a plain
 * client render with nothing to hydrate, it is `true` from the first
 * render, so consumers never see an extra empty frame there.
 *
 * `useSyncExternalStore` is the one hook React lets disagree between the
 * server and the client without raising a hydration mismatch: the
 * hydration render uses `getServerSnapshot()` so the tree is identical
 * to the pre-rendered HTML, then React re-renders with `getSnapshot()`.
 * Use it to fence off trees whose first render depends on things the
 * static render can't know — viewport size (`useWindowDimensions` is
 * 0×0 in Node), `localStorage`-backed identity / settings / replays,
 * `matchMedia`, WebGL availability.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
