import type { Seat } from '@mahjong/game-logic';
import { GameLog } from './GameLog';
import { MenuSheet } from './MenuSheet';
import { PlayersSheet } from './PlayersSheet';
import { SettingsPanel } from './SettingsPanel';
import { TileReferenceSheet } from './TileReferenceSheet';

interface MatchModalsProps {
  mySeat: Seat;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  logOpen: boolean;
  setLogOpen: (open: boolean) => void;
  referenceOpen: boolean;
  setReferenceOpen: (open: boolean) => void;
  playersOpen: boolean;
  setPlayersOpen: (open: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  onLeave: () => void;
}

/**
 * Bundles the five sheet/modal mounts that both `DesktopShell` and
 * `MobileShell` render identically — `SettingsPanel`, `GameLog`,
 * `TileReferenceSheet`, `PlayersSheet`, and the consolidated
 * `MenuSheet`. Exists so the two shells don't duplicate the same
 * five-line wiring block.
 *
 * The state lives in `Match.tsx`'s `useState` hooks; this component
 * is intentionally pure (no internal state) so the shells can share
 * exactly one React tree of modals across the two layout variants.
 */
export function MatchModals({
  mySeat,
  settingsOpen,
  setSettingsOpen,
  logOpen,
  setLogOpen,
  referenceOpen,
  setReferenceOpen,
  playersOpen,
  setPlayersOpen,
  menuOpen,
  setMenuOpen,
  onLeave,
}: MatchModalsProps) {
  return (
    <>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <GameLog open={logOpen} onClose={() => setLogOpen(false)} />
      <TileReferenceSheet open={referenceOpen} onClose={() => setReferenceOpen(false)} />
      <PlayersSheet open={playersOpen} onClose={() => setPlayersOpen(false)} mySeat={mySeat} />
      <MenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenLog={() => setLogOpen(true)}
        onOpenReference={() => setReferenceOpen(true)}
        onLeave={onLeave}
      />
    </>
  );
}
