import type { GameState, Seat } from '@mahjong/game-logic';
import type { PublicPlayer, RuleConfig } from '@mahjong/protocol';
import { create } from 'zustand';

export interface LobbyState {
  players: PublicPlayer[];
  host: string | null;
  rules: RuleConfig;
}

/** Felt skin id — drives the table-surface gradient hue + chroma. */
export type FeltSkin = 'sage' | 'jade' | 'ocean' | 'rose';
/** Tile-back skin id — drives the face-down tile gradient. */
export type TileBackSkin = 'cream' | 'blue' | 'plum' | 'mint';

export interface UserSettings {
  felt: FeltSkin;
  tileBack: TileBackSkin;
  /** When true, the user's hand always comes back sorted on every state update. */
  autoSort: boolean;
  /** Override for the OS-level prefers-reduced-motion. true=motion on, false=reduced. */
  animations: boolean;
  /** Sound effects toggle — no engine wiring yet (queued in TODO.md). */
  sound: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  felt: 'sage',
  tileBack: 'cream',
  autoSort: true,
  animations: true,
  sound: false,
};

const SETTINGS_STORAGE_KEY = 'mj.settings.v1';

function loadSettings(): UserSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(s: UserSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage might be full or disabled in private mode — silent skip */
  }
}

interface ClientGameStore {
  state: GameState | null;
  you: Seat | 'spectator' | null;
  lobby: LobbyState | null;
  /**
   * True while the between-hand shuffle overlay is active. `Tile` reads
   * this to swap to a slower transition so the layoutId-driven dispense
   * (every tile flying from its old position to its new wall position)
   * is deliberate enough to read.
   */
  shuffling: boolean;
  /**
   * User preferences — felt skin, tile-back, sort behaviour, animations,
   * sound. Loaded from localStorage on init; mirrored back on every
   * `setSettings` call. Mirroring to `@capacitor/preferences` (so the
   * settings survive a WebView wipe on native) is queued — see the
   * "Settings persistence wiring" entry in TODO.md.
   */
  settings: UserSettings;
  setState: (state: GameState, you?: Seat | 'spectator') => void;
  setLobby: (l: LobbyState) => void;
  setShuffling: (shuffling: boolean) => void;
  setSettings: (patch: Partial<UserSettings>) => void;
  reset: () => void;
}

export const useGame = create<ClientGameStore>((set) => ({
  state: null,
  you: null,
  lobby: null,
  shuffling: false,
  settings: loadSettings(),
  setState: (state, you) => set((prev) => ({ state, you: you ?? prev.you })),
  setLobby: (lobby) => set({ lobby }),
  setShuffling: (shuffling) => set({ shuffling }),
  setSettings: (patch) =>
    set((prev) => {
      const next = { ...prev.settings, ...patch };
      persistSettings(next);
      return { settings: next };
    }),
  reset: () => set({ state: null, you: null, lobby: null, shuffling: false }),
}));

export function playerForSeat(lobby: LobbyState | null, seat: Seat | null): PublicPlayer | null {
  if (!lobby || seat === null) return null;
  return lobby.players.find((p) => p.seat === seat) ?? null;
}

export function isSeatHost(lobby: LobbyState | null, seat: Seat | null): boolean {
  if (!lobby || lobby.host === null) return false;
  const p = playerForSeat(lobby, seat);
  return p !== null && p.playerId === lobby.host;
}

export function nameForSeat(lobby: LobbyState | null, seat: Seat): string {
  return playerForSeat(lobby, seat)?.displayName ?? `Seat ${seat}`;
}
