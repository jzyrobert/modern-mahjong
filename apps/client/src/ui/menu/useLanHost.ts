import { generateMatchCode } from '@mahjong/protocol';
import { useState } from 'react';
import { Platform } from 'react-native';
import { getDisplayName } from '../../identity';
import {
  isLanServerAvailable,
  advertise as lanAdvertise,
  start as lanStart,
  stop as lanStop,
  unadvertise as lanUnadvertise,
} from '../../native/lan-server';
import { startLanHostBridge, stopLanHostBridge } from '../../net/lan-host-bridge';
import type { useTransport } from '../../net/transport-context';

// Embedded NanoHTTPD port the host's LAN server listens on. Matches the
// legacy LanServer convention so any prior copy-pasted URLs from the
// mobile app keep working. The native module falls back to a free port
// if 7777 is already taken — the resolved port is what we read back
// from `start()`.
export const HOST_PORT = 7777;

export type HostStatus = null | 'starting' | string;

/**
 * "Host LAN match" flow shared by the phone and desktop lobbies. Starts
 * the embedded server, wires the in-process MatchSession bridge,
 * advertises on mDNS and joins as host in the same async block so a
 * guest who already has the code can't slip into seat 0 first.
 *
 * Hosting is hidden on web (no NanoHTTPD in a browser tab) and in Expo
 * Go (no third-party native modules); joining a LAN match is plain WS
 * and works everywhere, so callers keep "Join LAN match" unconditional.
 */
export function useLanHost(transport: ReturnType<typeof useTransport>): {
  canHostLan: boolean;
  hostStatus: HostStatus;
  hostError: string | null;
  onHostLan: () => Promise<void>;
} {
  const [hostStatus, setHostStatus] = useState<HostStatus>(null);
  const canHostLan = Platform.OS !== 'web' && isLanServerAvailable();

  const onHostLan = async () => {
    if (hostStatus === 'starting') return;
    setHostStatus('starting');
    try {
      // Defensive cleanup: a back-navigation can leave the bridge wired
      // to a half-dead server, and `lanStart` then lands on a port the
      // kernel hasn't released. Both calls are idempotent no-ops when
      // there's nothing to tear down.
      stopLanHostBridge();
      await lanUnadvertise().catch((err) => console.warn('useLanHost: lanUnadvertise failed', err));
      await lanStop().catch((err) => console.warn('useLanHost: lanStop (pre-start) failed', err));

      const res = await lanStart({ port: HOST_PORT });
      const hostUrl = res.addresses[0];
      if (!hostUrl) {
        await lanStop().catch((err) => console.warn('useLanHost: lanStop (rollback) failed', err));
        setHostStatus('No LAN address found — are you on Wi-Fi?');
        return;
      }
      startLanHostBridge();
      const serviceName = getDisplayName() || 'Modern Mahjong host';
      lanAdvertise({ serviceName, port: res.port }).catch((err) =>
        console.warn('useLanHost: lanAdvertise failed', err),
      );
      transport.joinLan(hostUrl, generateMatchCode());
      setHostStatus(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHostStatus(`Couldn't start the embedded server: ${msg}`);
    }
  };

  const hostError = typeof hostStatus === 'string' && hostStatus !== 'starting' ? hostStatus : null;
  return { canHostLan, hostStatus, hostError, onHostLan };
}
