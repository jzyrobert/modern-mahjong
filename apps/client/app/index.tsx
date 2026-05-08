import { useTransport } from '@/src/net/transport-context';
import { useGame } from '@/src/state/game';
import { Lobby } from '@/src/ui/menu/Lobby';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

/**
 * Root route. The lobby renders here while no transport is open. Once a
 * transport delivers its first `state` message the zustand store sets
 * `state` non-null; we forward to `/match?…` so the match screen takes
 * over. The query params encode the join descriptor so a browser
 * reload of `/match?code=ABCDE` (or `?solo=1`) can rebuild the
 * transport without bouncing through the lobby first — see
 * `app/match.tsx`'s reload-survival effect.
 */
export default function Index() {
  const router = useRouter();
  const state = useGame((s) => s.state);
  const joinInfo = useTransport().joinInfo;

  useEffect(() => {
    if (!state) return;
    router.replace(matchUrlFor(joinInfo));
  }, [state, joinInfo, router]);

  return <Lobby />;
}

function matchUrlFor(info: ReturnType<typeof useTransport>['joinInfo']): string {
  if (!info) return '/match';
  // Solo gets `?solo=1` so a reload of the route can tell the auto-
  // rejoin effect (`app/match.tsx`) to look in localStorage for the
  // persisted engine snapshot rather than fall through to the
  // "stranded" recovery screen. The actual state-of-the-world lives
  // in `mj.activeMatch.solo.v1` — the URL param is just a hint that
  // there *should* be something to rebuild.
  if (info.kind === 'solo') return '/match?solo=1';
  if (info.kind === 'online') return `/match?code=${encodeURIComponent(info.code)}`;
  // LAN — both code + hostUrl are required for a returning client to
  // re-establish the WS, so we encode both.
  return `/match?code=${encodeURIComponent(info.code)}&host=${encodeURIComponent(info.hostUrl)}`;
}
