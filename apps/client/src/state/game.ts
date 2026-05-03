import type { Event as EngineEvent, GameState, Seat } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import type { PublicPlayer, RuleConfig } from '@mahjong/protocol';
import { create } from 'zustand';
import { getPreference, setPreference } from '../native/preferences.js';

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
  const json = JSON.stringify(s);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, json);
    } catch {
      /* storage might be full or disabled in private mode — silent skip */
    }
  }
  // Mirror to native Preferences so settings survive a WebView wipe on
  // iOS / Android. No-op on web where the plugin import fails silently.
  void setPreference(SETTINGS_STORAGE_KEY, json);
}

/**
 * Sync settings between localStorage and native Preferences. Mirrors the
 * `hydrateIdentity` pattern: if the WebView wiped localStorage, reseed
 * from Preferences; conversely if Preferences is empty (first launch
 * after a web → installed-app upgrade), push localStorage in. Idempotent.
 *
 * Call once at app startup before the first render.
 */
export async function hydrateSettings(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  let local: string | null = null;
  try {
    local = localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    /* localStorage might be disabled */
  }
  const stored = await getPreference(SETTINGS_STORAGE_KEY);
  if (local && !stored) {
    await setPreference(SETTINGS_STORAGE_KEY, local);
  } else if (!local && stored) {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, stored);
      // Also push the rehydrated value into the live store so the UI
      // reflects it without a refresh.
      const parsed = JSON.parse(stored) as Partial<UserSettings>;
      useGame.getState().setSettings(parsed);
    } catch {
      /* invalid JSON or storage error — fall back to defaults */
    }
  }
}

/**
 * One ring-buffer entry. The engine emits `Event[]` per `apply`; the client
 * keeps the last `LOG_CAPACITY` events tagged with a monotonic `seq` so the
 * UI can render a stable list keyed off it.
 */
export interface LogEntry {
  seq: number;
  event: EngineEvent;
}

const LOG_CAPACITY = 12;

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
   * `setSettings` call. Also mirrored to `@capacitor/preferences` so they
   * survive a WebView wipe on native.
   */
  settings: UserSettings;
  /**
   * Last `LOG_CAPACITY` engine events the server broadcast on this match.
   * Cleared on reset; populated by `appendEvents(events)` from the
   * server's `delta` messages.
   */
  log: LogEntry[];
  /**
   * Engine `tileId` of the tile the local seat most recently drew, or
   * null when the user has discarded / it's not their turn / they haven't
   * drawn yet. Drives the soft gold glow on the just-drawn tile in
   * `Hand.tsx`. Maintained inside `appendEvents` from the engine's
   * `drew` / `discarded` events so it stays in sync with the wire stream.
   */
  drawnTileId: number | null;
  /**
   * Per-tileId display order used when `sortMode === 'manual'`. Cleared on
   * reset / handStarted so each fresh hand starts from a clean slate. New
   * tiles drawn into the hand append to the end; tiles that leave the hand
   * are pruned in `setManualOrder`. Empty array means the user hasn't
   * touched the order yet — Hand falls back to engine order.
   */
  manualOrder: number[];
  setState: (state: GameState, you?: Seat | 'spectator') => void;
  setLobby: (l: LobbyState) => void;
  setShuffling: (shuffling: boolean) => void;
  setSettings: (patch: Partial<UserSettings>) => void;
  setManualOrder: (ids: number[]) => void;
  appendEvents: (events: EngineEvent[]) => void;
  reset: () => void;
}

export const useGame = create<ClientGameStore>((set) => ({
  state: null,
  you: null,
  lobby: null,
  shuffling: false,
  settings: loadSettings(),
  log: [],
  drawnTileId: null,
  manualOrder: [],
  setState: (state, you) => set((prev) => ({ state, you: you ?? prev.you })),
  setLobby: (lobby) => set({ lobby }),
  setShuffling: (shuffling) => set({ shuffling }),
  setSettings: (patch) =>
    set((prev) => {
      const next = { ...prev.settings, ...patch };
      persistSettings(next);
      return { settings: next };
    }),
  setManualOrder: (ids) => set({ manualOrder: [...ids] }),
  appendEvents: (events) =>
    set((prev) => {
      if (events.length === 0) return prev;
      const baseSeq = prev.log.length > 0 ? prev.log[prev.log.length - 1]!.seq + 1 : 0;
      const fresh = events.map((event, i) => ({ seq: baseSeq + i, event }));
      const log = [...prev.log, ...fresh];
      const trimmed = log.length > LOG_CAPACITY ? log.slice(-LOG_CAPACITY) : log;

      // Track the local seat's drawn tile from drew/discarded events so
      // Hand.tsx can glow it. `you` may be null (spectator / lobby) — in
      // that case nothing to update.
      let drawnTileId = prev.drawnTileId;
      let manualOrder = prev.manualOrder;
      if (typeof prev.you === 'number') {
        for (const event of events) {
          if (event.t === 'drew' && event.seat === prev.you) {
            drawnTileId = tileId(event.tile);
            // New tile in the hand — append to manual order so it slots in
            // at the end rather than disappearing.
            const id = tileId(event.tile);
            if (!manualOrder.includes(id)) manualOrder = [...manualOrder, id];
          } else if (event.t === 'discarded' && event.seat === prev.you) {
            drawnTileId = null;
            const id = tileId(event.tile);
            if (manualOrder.includes(id)) manualOrder = manualOrder.filter((x) => x !== id);
          } else if (event.t === 'handStarted') {
            // Fresh hand — old drawn-tile reference is stale and the
            // manual order reset to empty.
            drawnTileId = null;
            manualOrder = [];
          }
        }
      }

      const next: Partial<ClientGameStore> = { log: trimmed };
      if (drawnTileId !== prev.drawnTileId) next.drawnTileId = drawnTileId;
      if (manualOrder !== prev.manualOrder) next.manualOrder = manualOrder;
      return next;
    }),
  reset: () =>
    set({
      state: null,
      you: null,
      lobby: null,
      shuffling: false,
      log: [],
      drawnTileId: null,
      manualOrder: [],
    }),
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
