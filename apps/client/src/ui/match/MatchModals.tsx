import type { Seat } from '@mahjong/game-logic';
import { GameLog } from './GameLog';
import { MenuSheet } from './MenuSheet';
import { MenuSidePanel } from './MenuSidePanel';
import { PlayersSheet } from './PlayersSheet';
import { ScoringRulesSheet } from './ScoringRulesSheet';
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
  scoringOpen: boolean;
  setScoringOpen: (open: boolean) => void;
  playersOpen: boolean;
  setPlayersOpen: (open: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  onLeave: () => void;
  /** Wire emote-row taps through the menu sheet to the transport.
   *  Optional — when omitted, the menu hides the emote row (used by
   *  shells that already host a persistent `<ChatBar>` outside the
   *  menu, e.g. the desktop felt). */
  onSendChat?: ((text: string) => void) | undefined;
  /** When true, the ☰ menu renders as a right-anchored slide-in
   *  panel (`<MenuSidePanel>`) instead of the mobile bottom-sheet.
   *  Driven by `DesktopShell` — mobile shells leave it false / omit
   *  it and keep the bottom-sheet pattern. */
  menuVariant?: 'sheet' | 'sidePanel';
}

/**
 * Bundles the five sheet/modal mounts that both `DesktopShell` and
 * `MobileShell` render identically — `SettingsPanel`, `GameLog`,
 * `TileReferenceSheet`, `PlayersSheet`, and the consolidated ☰
 * menu (either `MenuSheet` or `MenuSidePanel` depending on
 * `menuVariant`). Exists so the two shells don't duplicate the same
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
  scoringOpen,
  setScoringOpen,
  playersOpen,
  setPlayersOpen,
  menuOpen,
  setMenuOpen,
  onLeave,
  onSendChat,
  menuVariant = 'sheet',
}: MatchModalsProps) {
  const MenuComponent = menuVariant === 'sidePanel' ? MenuSidePanel : MenuSheet;
  return (
    <>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <GameLog open={logOpen} onClose={() => setLogOpen(false)} />
      <TileReferenceSheet open={referenceOpen} onClose={() => setReferenceOpen(false)} />
      <ScoringRulesSheet open={scoringOpen} onClose={() => setScoringOpen(false)} />
      <PlayersSheet open={playersOpen} onClose={() => setPlayersOpen(false)} mySeat={mySeat} />
      <MenuComponent
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenLog={() => setLogOpen(true)}
        onOpenReference={() => setReferenceOpen(true)}
        onOpenScoring={() => setScoringOpen(true)}
        onLeave={onLeave}
        onSendChat={onSendChat}
      />
    </>
  );
}
