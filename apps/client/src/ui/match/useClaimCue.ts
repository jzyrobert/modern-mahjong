import { useEffect, useState } from 'react';

/**
 * Returns `true` once `Date.now() >= deadlineMs`, scheduling a single
 * re-render when the threshold is crossed.
 *
 * Used by the claim-window UI to flip the "next player about to draw"
 * cue on once the soft floor (`pendingClaims.deadlineMs`) elapses, and
 * the countdown digit on at `softExpiryMs`. Pass `null` / `undefined`
 * when there's no deadline (e.g. solo's infinite window) — the hook
 * stays inert in that case.
 */
export function useDeadlineCrossed(deadlineMs: number | null | undefined): boolean {
  const [crossed, setCrossed] = useState(
    () => deadlineMs !== null && deadlineMs !== undefined && Date.now() >= deadlineMs,
  );
  useEffect(() => {
    if (deadlineMs === null || deadlineMs === undefined) {
      setCrossed(false);
      return;
    }
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      setCrossed(true);
      return;
    }
    setCrossed(false);
    const handle = setTimeout(() => setCrossed(true), remaining);
    return () => clearTimeout(handle);
  }, [deadlineMs]);
  return crossed;
}

/**
 * Returns the number of whole seconds until `deadlineMs`, re-rendering
 * once per second. Returns 0 once the deadline has passed; returns
 * `null` when no deadline is set. Used by the "drawing in N…"
 * countdown that appears once `softExpiryMs` is crossed.
 */
export function useSecondsUntil(deadlineMs: number | null | undefined): number | null {
  const [secs, setSecs] = useState(() => secondsUntil(deadlineMs));
  useEffect(() => {
    if (deadlineMs === null || deadlineMs === undefined) {
      setSecs(null);
      return;
    }
    setSecs(secondsUntil(deadlineMs));
    const handle = setInterval(() => {
      const next = secondsUntil(deadlineMs);
      setSecs(next);
      if (next !== null && next <= 0) clearInterval(handle);
    }, 250);
    return () => clearInterval(handle);
  }, [deadlineMs]);
  return secs;
}

function secondsUntil(deadlineMs: number | null | undefined): number | null {
  if (deadlineMs === null || deadlineMs === undefined) return null;
  return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
}
