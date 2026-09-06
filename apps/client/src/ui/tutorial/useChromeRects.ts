import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { TargetRect } from './TargetRegistry';
import {
  chromeSignature,
  collectChromeRects,
  collectKeepOutRects,
  handTilesInPlace,
} from './chromeRects';
import type { HaloRect } from './placement';
import type { TutorialTargetId } from './types';

/** How often the DOM is re-read for chrome while a step is active. A
 *  few hundred `getBoundingClientRect` calls every 400 ms is far below
 *  a frame's budget, and the signature check means the overlay only
 *  re-renders when something actually moved. */
const RESCAN_MS = 400;

const EMPTY: HaloRect[] = [];
/** Scans counted before the counter stops (only "at least three" matters). */
const SCANS_TRACKED = 3;

interface Options {
  active: boolean;
  targetId: TutorialTargetId | null;
  /** Re-scan immediately when the step changes. */
  stepKey: string;
  viewport: { width: number; height: number };
  /** Re-scan when the target settles somewhere new. */
  settledRect: TargetRect | null;
  /** Focused band of the target (see `collectChromeRects.focusBand`);
   *  `null` when the whole target is spotlit. */
  focusBand?: HaloRect | null;
  /** DOM node the overlay is positioned in (its client rect is the origin). */
  originNode: () => { getBoundingClientRect(): { left: number; top: number } } | null;
}

export interface ChromeScan {
  /** Chrome rects for `placeCaption`'s `avoid` list. */
  chrome: HaloRect[];
  /** Page elements a centred card keeps off (see `collectKeepOutRects`). */
  keepOuts: HaloRect[];
  /** Scans completed for the current step — the first runs at mount,
   *  the next two on the following frames. A card that waits for the
   *  third has seen the page as it is after any mount-time churn. */
  scans: number;
  /** The last scan found every hand tile inside the hand row (see
   *  `handTilesInPlace`); `true` off web. */
  handInPlace: boolean;
}

/**
 * Chrome rects for `placeCaption`'s `avoid` list, plus the page's
 * keep-out elements. Web only — native shells return empty lists (the
 * registry's other targets still feed the avoid list there via
 * `TargetRegistryApi.readAll`).
 */
export function useChromeRects({
  active,
  targetId,
  stepKey,
  viewport,
  settledRect,
  focusBand = null,
  originNode,
}: Options): ChromeScan {
  const [rects, setRects] = useState<HaloRect[]>(EMPTY);
  const [keepOuts, setKeepOuts] = useState<HaloRect[]>(EMPTY);
  const [scans, setScans] = useState(0);
  const [handInPlace, setHandInPlace] = useState(true);
  const sigRef = useRef('');
  const keepSigRef = useRef('');
  const originRef = useRef(originNode);
  originRef.current = originNode;
  const bandRef = useRef(focusBand);
  bandRef.current = focusBand;
  // Latest scan closure, so a step / settle change can force an
  // immediate re-read without tearing down the interval.
  const scanRef = useRef<(...reason: unknown[]) => void>(() => {});

  useEffect(() => {
    const canScan = Platform.OS === 'web' && typeof document !== 'undefined';
    if (!active || !canScan) {
      scanRef.current = () => {};
      if (sigRef.current !== '') {
        sigRef.current = '';
        setRects(EMPTY);
      }
      if (keepSigRef.current !== '') {
        keepSigRef.current = '';
        setKeepOuts(EMPTY);
      }
      return;
    }
    const scan = () => {
      const o = originRef.current()?.getBoundingClientRect();
      const next = collectChromeRects({
        doc: document,
        origin: { x: o?.left ?? 0, y: o?.top ?? 0 },
        viewport,
        activeTargetId: targetId,
        focusBand: bandRef.current,
      });
      const sig = chromeSignature(next);
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setRects(next);
      }
      const keep = collectKeepOutRects(document, { x: o?.left ?? 0, y: o?.top ?? 0 });
      const keepSig = chromeSignature(keep);
      if (keepSig !== keepSigRef.current) {
        keepSigRef.current = keepSig;
        setKeepOuts(keep);
      }
      setScans((n) => (n < SCANS_TRACKED ? n + 1 : n));
      setHandInPlace(handTilesInPlace(document));
    };
    scanRef.current = scan;
    scan();
    // The first scan can run while the previous route's DOM is still
    // mounted (a lesson launched from the lobby: the overlay appears a
    // frame before the lobby unmounts), so the card would dodge lobby
    // chrome and then jump once the 400 ms rescan sees the table. Rescan
    // on the next two frames and shortly after so stale rects last a
    // frame, not a click's worth of time.
    let raf = requestAnimationFrame(() => {
      scan();
      raf = requestAnimationFrame(scan);
    });
    const soon = setTimeout(scan, 120);
    const id = setInterval(scan, RESCAN_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(soon);
      clearInterval(id);
    };
  }, [active, targetId, viewport]);

  // Per step: the count restarts ahead of the step's first scan (both
  // land in one render) so a new card waits for its own scans.
  const stepRef = useRef('');
  useEffect(() => {
    if (stepRef.current !== stepKey) {
      stepRef.current = stepKey;
      setScans(0);
    }
    scanRef.current(stepKey, settledRect, focusBand);
  }, [stepKey, settledRect, focusBand]);

  return useMemo(
    () => ({ chrome: rects, keepOuts, scans, handInPlace }),
    [rects, keepOuts, scans, handInPlace],
  );
}
