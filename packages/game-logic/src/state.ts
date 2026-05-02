import type { Meld } from './hand.js';
import type { Tile } from './tiles.js';

export type Seat = 0 | 1 | 2 | 3;

export const SEATS: readonly Seat[] = [0, 1, 2, 3] as const;

export type Phase = 'waiting' | 'dealing' | 'turn' | 'awaitingClaims' | 'resolved';

export type Wind = 'E' | 'S' | 'W' | 'N';

export interface RuleConfig {
  /** Minimum faan to declare a win. */
  faanMin: 0 | 1 | 3 | 5;
  /** Allow seven-pairs winning shape. */
  allowSevenPairs: boolean;
  /** Allow thirteen-orphans winning shape. */
  allowThirteenOrphans: boolean;
  /** Soft per-turn timeout in ms; the server will auto-discard the just-drawn tile if exceeded. */
  turnTimeoutMs: number;
  /** Window after each discard during which other seats may claim. */
  claimWindowMs: number;
}

export const DEFAULT_RULES: RuleConfig = {
  faanMin: 3,
  allowSevenPairs: true,
  allowThirteenOrphans: true,
  turnTimeoutMs: 20_000,
  claimWindowMs: 3_000,
};

export const FAAN_OPTIONS: readonly RuleConfig['faanMin'][] = [0, 1, 3, 5] as const;

export type Claim =
  | { kind: 'pass' }
  | { kind: 'chi'; with: [Tile, Tile] } // the two tiles already in hand that complete the run
  | { kind: 'peng' }
  | { kind: 'gong' }
  | { kind: 'hu' };

export interface ClaimRound {
  discard: { tile: Tile; from: Seat };
  /** Server-clock deadline. */
  deadlineMs: number;
  submitted: Partial<Record<Seat, Claim>>;
}

export interface GameState {
  phase: Phase;
  rules: RuleConfig;
  /** PRNG seed for the current hand. */
  seed: number;
  prevailingWind: Wind;
  dealer: Seat;
  /** The seat whose turn it is to act (draw or discard, depending on phase). */
  turn: Seat;
  /** Whether the current `turn` seat has already drawn this turn. */
  hasDrawn: boolean;
  wall: Tile[];
  deadWall: Tile[];
  hands: Record<Seat, Tile[]>;
  melds: Record<Seat, Meld[]>;
  discards: Record<Seat, Tile[]>;
  lastDiscard?: { tile: Tile; from: Seat } | undefined;
  pendingClaims?: ClaimRound | undefined;
  /** Cumulative scores across hands in the same lobby session. */
  scoreboard: Record<Seat, number>;
  /** Result of the most recent hand, if any. */
  lastResult?: HandResult | undefined;
}

export type HandResult =
  | {
      kind: 'win';
      winner: Seat;
      from: Seat;
      tile: Tile;
      selfDraw: boolean;
      faan: number;
      reasons: string[];
    }
  | { kind: 'draw'; reason: 'wall-empty' };

export function emptyState(rules: RuleConfig = DEFAULT_RULES): GameState {
  return {
    phase: 'waiting',
    rules,
    seed: 0,
    prevailingWind: 'E',
    dealer: 0,
    turn: 0,
    hasDrawn: false,
    wall: [],
    deadWall: [],
    hands: { 0: [], 1: [], 2: [], 3: [] },
    melds: { 0: [], 1: [], 2: [], 3: [] },
    discards: { 0: [], 1: [], 2: [], 3: [] },
    scoreboard: { 0: 0, 1: 0, 2: 0, 3: 0 },
  };
}

/** Counter-clockwise turn order: E → S → W → N → E. */
export function nextSeat(s: Seat): Seat {
  return ((s + 1) % 4) as Seat;
}

export function prevSeat(s: Seat): Seat {
  return ((s + 3) % 4) as Seat;
}

export function acrossSeat(s: Seat): Seat {
  return ((s + 2) % 4) as Seat;
}

/**
 * HK dealer rotation: the dealer keeps the seat if they won or the hand
 * was drawn; otherwise rotation advances counter-clockwise. Returns the
 * dealer seat for the next hand.
 */
export function nextDealer(state: GameState): Seat {
  const r = state.lastResult;
  if (!r) return state.dealer;
  if (r.kind === 'win' && r.winner !== state.dealer) return nextSeat(state.dealer);
  return state.dealer;
}
