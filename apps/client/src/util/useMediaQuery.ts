import { useEffect, useState } from 'react';

/**
 * React hook around `window.matchMedia`. Returns the live `.matches` value
 * for the given media query string and re-renders when it changes.
 *
 * Used by Match.tsx to pick between the desktop shell and `MobileMatch`
 * based on the viewport (the design's "landscape phone" gate is
 * `(max-width: 900px) and (orientation: landscape)`).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
