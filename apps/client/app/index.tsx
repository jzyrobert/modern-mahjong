import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useGame } from '@/src/state/game';
import { Lobby } from '@/src/ui/menu/Lobby';

/**
 * Root route. The lobby renders here while no transport is open. Once a
 * transport delivers its first `state` message the zustand store sets
 * `state` non-null; we forward to `/match` so the match screen takes
 * over (Phase 4 fills in the match UI; for now `/match` is a stub).
 */
export default function Index() {
  const router = useRouter();
  const state = useGame((s) => s.state);

  useEffect(() => {
    if (state) router.replace('/match');
  }, [state, router]);

  return <Lobby />;
}
