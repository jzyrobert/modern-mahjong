import { useCallback, useEffect, useId, useRef } from 'react';
import { Platform, type View } from 'react-native';
import {
  addOccluderMeasurer,
  remeasureOccluders,
  removeOccluder,
  setOccluder,
} from './menuOccluders';
import type { OccluderKind } from './menuOccluders';

let webListenersInstalled = false;
let scheduled = false;

function scheduleRemeasure(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    remeasureOccluders();
  });
}

function ensureWebListeners(): void {
  if (webListenersInstalled || Platform.OS !== 'web' || typeof document === 'undefined') return;
  webListenersInstalled = true;
  // Capture phase so scrolls inside the lobby ScrollView (a div) reach us.
  document.addEventListener('scroll', scheduleRemeasure, { capture: true, passive: true });
  window.addEventListener('resize', scheduleRemeasure);
}

/**
 * Register the wrapped View as a backdrop occluder (`menuOccluders.ts`).
 * Spread the result onto the View (`ref` + `onLayout`); the rect is
 * re-measured on layout, on scroll / resize, and once more after the
 * entrance choreography has finished moving the card (`Reveal`,
 * ≤ 700 ms). Off-web nothing reads the registry (no 3D backdrop), so
 * the hook is a no-op there.
 */
export function useMenuOccluder(kind: OccluderKind, enabled = Platform.OS === 'web') {
  const id = useId();
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node || typeof node.measureInWindow !== 'function') return;
    node.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) setOccluder(id, { x, y, w, h, kind });
    });
  }, [enabled, id, kind]);

  useEffect(() => {
    if (!enabled) return;
    ensureWebListeners();
    const drop = addOccluderMeasurer(measure);
    measure();
    const settle = setTimeout(measure, 800);
    return () => {
      clearTimeout(settle);
      drop();
      removeOccluder(id);
    };
  }, [enabled, id, measure]);

  return { ref, onLayout: measure };
}
