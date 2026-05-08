import { useTransport } from '@/src/net/transport-context';
import { readSoloSnapshot } from '@/src/state/solo-persist';
import { Match } from '@/src/ui/Match';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

/**
 * `/match` route entry. Wraps `<Match />` with reload-survival glue:
 * if the page lands here cold (no transport active in this tab) but
 * the URL carries the right query params, kick off the matching
 * `joinOnline` / `joinLan` / `joinSoloResume` so the user lands back
 * in their match without having to re-navigate from the lobby.
 *
 * URL contracts (mirrored on every push from `app/index.tsx`):
 *   /match?code=ABCDE         → online (server rebinds by playerId)
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

  useEffect(() => {
    if (transport.hasTransport) return;
    if (typeof params.code === 'string' && params.code.length > 0) {
      if (typeof params.host === 'string' && params.host.length > 0) {
        transport.joinLan(params.host, params.code);
      } else {
        transport.joinOnline(params.code);
      }
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
