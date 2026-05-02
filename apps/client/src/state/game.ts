import type { GameState, Seat } from '@mahjong/game-logic';
import type { PublicPlayer, RuleConfig } from '@mahjong/protocol';
import { create } from 'zustand';

interface ClientGameStore {
  state: GameState | null;
  you: Seat | 'spectator' | null;
  lobby: { players: PublicPlayer[]; host: string; rules: RuleConfig } | null;
  setState: (state: GameState, you?: Seat | 'spectator') => void;
  setLobby: (l: { players: PublicPlayer[]; host: string; rules: RuleConfig }) => void;
  reset: () => void;
}

export const useGame = create<ClientGameStore>((set) => ({
  state: null,
  you: null,
  lobby: null,
  setState: (state, you) => set((prev) => ({ state, you: you ?? prev.you })),
  setLobby: (lobby) => set({ lobby }),
  reset: () => set({ state: null, you: null, lobby: null }),
}));
