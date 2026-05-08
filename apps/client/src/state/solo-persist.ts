import type { GameState, Seat } from '@mahjong/game-logic';
import type { LobbyState } from './game';

/**
 * Persistence layer for solo-match reload survival. Solo has no
 * server snapshot to fall back on (it's an in-process bot loop), so
 * the only way `/match` can rebuild the engine after a reload is to
 * mirror the live state to localStorage on every `setState` /
 * `setLobby` and rehydrate from there on the next mount.
 *
 * We persist the engine `state`, the lobby projection, and the local
 * seat (`you`). Bot skills already round-trip through
 * `mj.settings.v1` (see `state/game.ts`), so the resumed transport
 * just reads them from settings and we don't duplicate them here.
 *
 * Online + LAN matches don't use this — they have their own URL +
 * server-rebind contract (`apps/client/app/index.tsx` matchUrlFor).
 *
 * Key bumped on schema changes; on a version mismatch we drop the
 * snapshot rather than mis-restore.
 */

const STORAGE_KEY = 'mj.activeMatch.solo.v1';

export interface SoloSnapshot {
  version: 1;
  state: GameState;
  lobby: LobbyState;
  you: Seat | 'spectator';
}

export function saveSoloSnapshot(snap: Omit<SoloSnapshot, 'version'>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: SoloSnapshot = { version: 1, ...snap };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage full or disabled (private mode) — silent skip; reload
    // recovery is best-effort.
  }
}

export function readSoloSnapshot(): SoloSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SoloSnapshot>;
    if (parsed.version !== 1) return null;
    if (!parsed.state || !parsed.lobby || parsed.you === undefined) return null;
    return parsed as SoloSnapshot;
  } catch {
    return null;
  }
}

export function clearSoloSnapshot(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* silent */
  }
}
