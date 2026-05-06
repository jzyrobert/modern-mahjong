import { useGame } from '@/src/state/game';
import { Lobby } from '@/src/ui/menu/Lobby';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

/**
 * Root route. The lobby renders here while no transport is open. Once a
 * transport delivers its first `state` message the zustand store sets
 * `state` non-null; we forward to `/match` so the match screen takes over.
 */
export default function Index() {
  const router = useRouter();
  const state = useGame((s) => s.state);

  useEffect(() => {
    if (state) router.replace('/match');
  }, [state, router]);

  return <Lobby />;
}
