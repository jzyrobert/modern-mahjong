import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { TargetRect } from './TargetRegistry';
import { chromeSignature, collectChromeRects } from './chromeRects';
import type { HaloRect } from './placement';
import type { TutorialTargetId } from './types';

/** How often the DOM is re-read for chrome while a step is active. A
 *  few hundred `getBoundingClientRect` calls every 400 ms is far below
 *  a frame's budget, and the signature check means the overlay only
 *  re-renders when something actually moved. */
const RESCAN_MS = 400;

const EMPTY: HaloRect[] = [];

interface Options {
  active: boolean;
  targetId: TutorialTargetId | null;
  /** Re-scan immediately when the step changes. */
  stepKey: string;
  viewport: { width: number; height: number };
  /** Re-scan when the target settles somewhere new. */
  settledRect: TargetRect | null;
  /** DOM node the overlay is positioned in (its client rect is the origin). */
  originNode: () => { getBoundingClientRect(): { left: number; top: number } } | null;
}

/**
 * Chrome rects for `placeCaption`'s `avoid` list. Web only — native
 * shells return an empty list (the registry's other targets still
 * feed the avoid list there via `TargetRegistryApi.readAll`).
 */
export function useChromeRects({
  active,
  targetId,
  stepKey,
  viewport,
  settledRect,
  originNode,
}: Options): HaloRect[] {
  const [rects, setRects] = useState<HaloRect[]>(EMPTY);
  const sigRef = useRef('');
  const originRef = useRef(originNode);
  originRef.current = originNode;
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
      return;
    }
    const scan = () => {
      const o = originRef.current()?.getBoundingClientRect();
      const next = collectChromeRects({
        doc: document,
        origin: { x: o?.left ?? 0, y: o?.top ?? 0 },
        viewport,
        activeTargetId: targetId,
      });
      const sig = chromeSignature(next);
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setRects(next);
      }
    };
    scanRef.current = scan;
    scan();
    const id = setInterval(scan, RESCAN_MS);
    return () => clearInterval(id);
  }, [active, targetId, viewport]);

  useEffect(() => {
    scanRef.current(stepKey, settledRect);
  }, [stepKey, settledRect]);

  return rects;
}
