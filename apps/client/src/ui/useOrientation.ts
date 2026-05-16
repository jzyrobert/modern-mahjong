import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

/**
 * Live `isLandscape` flag, safe under soft-keyboard viewport shrink.
 *
 * On web, reads `matchMedia('(orientation: landscape)')` rather than
 * comparing `useWindowDimensions().width > height`. Android Chrome
 * shrinks `window.innerHeight` when the soft keyboard opens, which can
 * flip a dimension-based orientation check mid-tap. Any subtree that's
 * conditionally rendered on `isLandscape` will then unmount — taking a
 * focused `TextInput` (and the keyboard) with it. The media query
 * stays pinned to the device's physical orientation regardless of the
 * keyboard.
 *
 * Native targets fall back to `width > height` because `useWindowDimensions`
 * already reflects the (stable) layout viewport there and matchMedia
 * isn't available outside RN-Web.
 *
 * Consumers: `useIsPhoneViewport` (lobby home screen) and
 * `LobbyAccordion`'s portrait/landscape body split.
 */
export function useIsLandscape(): boolean {
  const { width, height } = useWindowDimensions();
  const [webLandscape, setWebLandscape] = useState<boolean>(() => readWebLandscape());
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(orientation: landscape)');
    setWebLandscape(mq.matches);
    const onChange = () => setWebLandscape(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return Platform.OS === 'web' ? webLandscape : width > height;
}

function readWebLandscape(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return window.matchMedia('(orientation: landscape)').matches;
}
