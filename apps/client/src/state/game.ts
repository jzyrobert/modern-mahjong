import type { GameState, Seat } from '@mahjong/game-logic';
import type { PublicPlayer, RuleConfig } from '@mahjong/protocol';
import { create } from 'zustand';

export interface LobbyState {
  players: PublicPlayer[];
  host: string | null;
  rules: RuleConfig;
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
  setState: (state: GameState, you?: Seat | 'spectator') => void;
  setLobby: (l: LobbyState) => void;
  setShuffling: (shuffling: boolean) => void;
  reset: () => void;
}

export const useGame = create<ClientGameStore>((set) => ({
  state: null,
  you: null,
  lobby: null,
  shuffling: false,
  setState: (state, you) => set((prev) => ({ state, you: you ?? prev.you })),
  setLobby: (lobby) => set({ lobby }),
  setShuffling: (shuffling) => set({ shuffling }),
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
