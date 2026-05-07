import { useTransport } from '@/src/net/transport-context';
import { Match } from '@/src/ui/Match';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

/**
 * `/match` route entry. Wraps `<Match />` with reload-survival glue:
 * if the page lands here cold (no transport active in this tab) but
 * the URL carries the right query params, kick off the matching
 * `joinOnline` / `joinLan` so the user lands back in their match
 * without having to re-navigate from the lobby. The server's
 * `playerId → seat` rebind logic (see PR #211) takes care of the
 * server side.
 *
 * URL contracts (mirrored on every push from `app/index.tsx`):
 *   /match?code=ABCDE         → online (server rebinds by playerId)
 *   /match?code=ABCDE&host=…  → LAN (host URL must still be reachable)
 *   /match (bare)             → no recovery — falls through to the
 *                               existing "No active match" stranded
 *                               screen `Match` already renders
 *
 * Solo intentionally has no URL contract — the in-process bot loop
 * has no server snapshot to restore, so reload "recovery" would just
 * deal a fresh hand. We keep the existing stranded UX for that case.
 *
 * The auto-rejoin only fires once per mount and only when there's
 * no live transport, so re-renders during the connecting phase
 * don't kick off duplicate joins.
 */
export default function MatchRoute() {
  const params = useLocalSearchParams<{ code?: string; host?: string }>();
  const transport = useTransport();

  useEffect(() => {
    if (transport.hasTransport) return;
    if (typeof params.code === 'string' && params.code.length > 0) {
      if (typeof params.host === 'string' && params.host.length > 0) {
        transport.joinLan(params.host, params.code);
      } else {
        transport.joinOnline(params.code);
      }
    }
    // No params + no transport → leave to Match.tsx's "No active
    // match" recovery screen. We deliberately don't redirect to /
    // here so a deep link with a typo is debuggable.
  }, [transport, params.code, params.host]);

  return <Match />;
}
