import { LanHostBridge, type LanHostBridgeNative } from '@mahjong/match-session';
import {
  addListener as lanAddListener,
  close as lanClose,
  send as lanSend,
} from '../native/lan-server';

/**
 * Client-side wiring for the host-side `LanHostBridge` (which lives
 * in `@mahjong/match-session` so vitest can cover it without dragging
 * the test runner into the Expo app). This file does two small things:
 *
 *   1. Adapts the real `expo-lan-server` module to the bridge's
 *      `LanHostBridgeNative` interface — the only complication is
 *      `addListener`, whose overloaded signature lets the bridge ask
 *      for narrower-typed subscriptions.
 *   2. Hands out a single process-global bridge instance via
 *      `start/stop/getActiveLanHostBridge` so the LAN modal can hook
 *      it onto the same lifecycle as the embedded NanoHTTPD server
 *      (which is itself process-global — only one can bind a port at
 *      a time, so there's no value in supporting multiple bridges).
 */

const nativeAdapter: LanHostBridgeNative = {
  // The bridge's interface narrows `addListener` per-event. Forwarding
  // it through this object preserves the overload resolution at each
  // call site inside the bridge.
  addListener: ((event: string, cb: (e: unknown) => void) =>
    // biome-ignore lint/suspicious/noExplicitAny: shimming overloaded export
    lanAddListener(event as any, cb as any)) as LanHostBridgeNative['addListener'],
  send: lanSend,
  close: lanClose,
};

let active: LanHostBridge | null = null;

export function startLanHostBridge(): LanHostBridge {
  active?.dispose();
  active = new LanHostBridge({ native: nativeAdapter });
  return active;
}

export function stopLanHostBridge(): void {
  active?.dispose();
  active = null;
}

export function getActiveLanHostBridge(): LanHostBridge | null {
  return active;
}
