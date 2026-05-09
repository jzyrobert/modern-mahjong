import { ReplayLibrary } from '@/src/ui/replay/ReplayLibrary';

/**
 * `/replays` route — list of saved replays. Uses an Expo Router subfolder
 * so the player route at `/replays/[id]` can sit beside it without
 * creating a layout indirection.
 */
export default function ReplaysIndex() {
  return <ReplayLibrary />;
}
