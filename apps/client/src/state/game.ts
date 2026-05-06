import type { BotKind } from '@mahjong/bots';
import type { Event as EngineEvent, GameState, Seat } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import type { PublicPlayer, RuleConfig } from '@mahjong/protocol';
import { create } from 'zustand';

export interface LobbyState {
  players: PublicPlayer[];
  host: string | null;
  rules: RuleConfig;
  /** Live spectator count from the server. Older servers omit this; defaults to 0. */
  viewers?: number;
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
  /** Sound effects toggle. The toggle is wired through to the
   *  Settings panel; the underlying `sound.ts` module is a no-op
   *  until the expo-audio port lands, so flipping this currently
   *  has no audible effect. */
  sound: boolean;
  /** When true, on the user's discard turn (after they've drawn) the
   *  tile the heuristic ranker recommends discarding is highlighted in
   *  the hand. Reads from the same `rankDiscards` ranker the
   *  `heuristicBot` uses, so the hint matches what a smart bot in the
   *  same seat would discard. Off by default so the user's first
   *  match isn't pre-coached. */
  discardHint: boolean;
  /** Per-seat bot kind for solo / practice matches. Indexed by seat
   *  1..3 (seat 0 is the user). The default mirrors the historical
   *  hard-coded mix in `createSoloTransport`. Persisted across
   *  sessions so the user's last-picked skill set survives reloads. */
  botSkills: [BotKind, BotKind, BotKind];
}

const DEFAULT_SETTINGS: UserSettings = {
  felt: 'sage',
  tileBack: 'cream',
  autoSort: true,
  animations: true,
  sound: false,
  discardHint: false,
  botSkills: ['heuristic', 'simple', 'passive'],
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
   * `setSettings` call. On native, the `expo-sqlite/localStorage/install`
   * polyfill imported at app startup makes localStorage durable across
   * WebView wipes / app reinstalls, so no separate native-preferences
   * mirror is needed.
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
  /**
   * Recent chat / emote messages — tagged with sender seat and an
   * incrementing local seq so React keys stay stable. Cleared on reset.
   * The `ChatBubbles` overlay reads this and auto-dismisses each entry
   * after a short window.
   */
  chats: ChatEntry[];
  /**
   * Monotonic counter incremented when a claim attempt loses the race
   * — either a server `PHASE` error after the hard fallback fired, or
   * a `claimsResolved` event that didn't crown the user. Drives the
   * `ClaimMissedToast` overlay; cleared on `reset`.
   */
  claimMissedSeq: number;
  setState: (state: GameState, you?: Seat | 'spectator') => void;
  setLobby: (l: LobbyState) => void;
  setShuffling: (shuffling: boolean) => void;
  setSettings: (patch: Partial<UserSettings>) => void;
  setManualOrder: (ids: number[]) => void;
  appendEvents: (events: EngineEvent[]) => void;
  pushChat: (entry: { from: Seat | 'spectator'; text: string; ts: number }) => void;
  dismissChat: (seq: number) => void;
  flashClaimMissed: () => void;
  reset: () => void;
}

export interface ChatEntry {
  /** Local monotonic counter — used as the React key. */
  seq: number;
  /** Server-tagged sender. */
  from: Seat | 'spectator';
  text: string;
  /** Server timestamp. */
  ts: number;
}

const CHAT_CAPACITY = 24;

export const useGame = create<ClientGameStore>((set) => ({
  state: null,
  you: null,
  lobby: null,
  shuffling: false,
  settings: loadSettings(),
  log: [],
  drawnTileId: null,
  manualOrder: [],
  chats: [],
  claimMissedSeq: 0,
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
  pushChat: (entry) =>
    set((prev) => {
      const seq = prev.chats.length > 0 ? prev.chats[prev.chats.length - 1]!.seq + 1 : 0;
      const next = [...prev.chats, { seq, ...entry }];
      return { chats: next.length > CHAT_CAPACITY ? next.slice(-CHAT_CAPACITY) : next };
    }),
  dismissChat: (seq) => set((prev) => ({ chats: prev.chats.filter((c) => c.seq !== seq) })),
  flashClaimMissed: () => set((prev) => ({ claimMissedSeq: prev.claimMissedSeq + 1 })),
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
      chats: [],
      claimMissedSeq: 0,
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

// Test-only hatch: expose the zustand store getter on `globalThis` so
// Playwright specs can read the engine state without us threading a
// data-testid through every consumer. Harmless in production — the
// store is already in memory, this is a getter — but only used by
// `apps/client/e2e/*.spec.ts` test code.
declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_GET_STATE__: (() => ClientGameStore) | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__MAHJONG_TEST_GET_STATE__ = () => useGame.getState();
}
