import { isLanOrigin } from '@/src/net/transport';
import { useTransport } from '@/src/net/transport-context';
import { readSoloSnapshot } from '@/src/state/solo-persist';
import { Match } from '@/src/ui/Match';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * `/match` route entry. Wraps `<Match />` with reload-survival glue:
 * if the page lands here cold (no transport active in this tab) but
 * the URL carries the right query params, kick off the matching
 * `joinOnline` / `joinLan` / `joinSoloResume` so the user lands back
 * in their match without having to re-navigate from the lobby.
 *
 * URL contracts (mirrored on every push from `app/index.tsx`):
 *   /match?code=ABCDE         → online (server rebinds by playerId).
 *                               EXCEPT when the page itself is served
 *                               from a LAN origin (the host's
 *                               NanoHTTPD `http://lan-ip:port/…`):
 *                               in that case there's no separate
 *                               online server, so we infer the LAN
 *                               host from `window.location.origin`
 *                               and treat the URL as a LAN join.
 *                               This is what makes the single URL the
 *                               host shares from `LanInviteCard` /
 *                               `HostLanModal` work for browser
 *                               guests on the same Wi-Fi without
 *                               needing the app installed.
 *   /match?code=ABCDE&host=…  → LAN (host URL must still be reachable)
 *   /match?solo=1             → solo (rebuild from localStorage
 *                               snapshot in `solo-persist.ts`)
 *   /match (bare)             → no recovery — falls through to the
 *                               "No active match" stranded screen
 *
 * Online + LAN recover via the server's `playerId → seat` rebind
 * (see PR #211). Solo has no server, so the engine snapshot is
 * mirrored to `mj.activeMatch.solo.v1` on every state delta and the
 * resume seeds a fresh in-process bot loop with that snapshot.
 *
 * The auto-rejoin only fires once per mount and only when there's
 * no live transport, so re-renders during the connecting phase
 * don't kick off duplicate joins.
 */
export default function MatchRoute() {
  const params = useLocalSearchParams<{ code?: string; host?: string; solo?: string }>();
  const transport = useTransport();

  // Track whether this MatchRoute instance has ever seen a live
  // transport. The reload-survival effect below only fires the
  // auto-rejoin when `hasTransport` is false; without this guard,
  // an explicit `transport.leave()` (e.g. from the pregame lobby's
  // Leave button) flips `hasTransport` to false before the route
  // change to `/` settles, and the effect re-fires with the URL's
  // `params.code` still set — yanking the user right back into the
  // match they just left. Once we've held a transport on this route,
  // any subsequent `hasTransport=false` means the user explicitly
  // left (or got disconnected); we should NOT auto-rejoin.
  const everHadTransport = useRef(false);

  useEffect(() => {
    if (transport.hasTransport) {
      everHadTransport.current = true;
      return;
    }
    if (everHadTransport.current) return;
    if (typeof params.code === 'string' && params.code.length > 0) {
      if (typeof params.host === 'string' && params.host.length > 0) {
        transport.joinLan(params.host, params.code);
        return;
      }
      // Web browser served from a LAN origin (e.g. the host's
      // NanoHTTPD `http://192.168.1.42:7777/match?code=ABCD`): no
      // explicit `host` query param is needed because the same device
      // serving the bundle IS the LAN match server. Use
      // `window.location.origin` so a host can share a single URL
      // that works in any browser on the same Wi-Fi.
      if (Platform.OS === 'web' && isLanOrigin() && typeof window !== 'undefined') {
        transport.joinLan(window.location.origin, params.code);
        return;
      }
      transport.joinOnline(params.code);
      return;
    }
    if (params.solo === '1') {
      const snap = readSoloSnapshot();
      if (snap) transport.joinSoloResume(snap);
      // Snapshot missing/stale (private mode, manual localStorage
      // wipe, schema bump) → fall through to the stranded screen
      // rather than pretending we recovered.
      return;
    }
    // No params + no transport → leave to Match.tsx's "No active
    // match" recovery screen. We deliberately don't redirect to /
    // here so a deep link with a typo is debuggable.
  }, [transport, params.code, params.host, params.solo]);

  return <Match />;
}
