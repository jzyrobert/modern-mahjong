import type { Meld } from './hand.js';
import type { Tile, Wind } from './tiles.js';
import { WINDS } from './tiles.js';

export type Seat = 0 | 1 | 2 | 3;

export const SEATS: readonly Seat[] = [0, 1, 2, 3] as const;

export type Phase = 'waiting' | 'dealing' | 'turn' | 'awaitingClaims' | 'resolved';

export type { Wind };

export interface RuleConfig {
  /** Minimum faan to declare a win. */
  faanMin: 0 | 1 | 3 | 5;
  /** Allow seven-pairs winning shape. */
  allowSevenPairs: boolean;
  /** Allow thirteen-orphans winning shape. */
  allowThirteenOrphans: boolean;
  /** Soft per-turn timeout in ms; the server will auto-discard the just-drawn tile if exceeded. */
  turnTimeoutMs: number;
  /** Soft floor — earliest moment a claim window can resolve. Even
   *  when every non-discarder seat has submitted before this point,
   *  the engine waits until now ≥ deadlineMs to keep the table fair
   *  to slow-blinking humans. */
  claimWindowMs: number;
  /**
   * Soft expiry — when set, clients should start a visible countdown
   * toward `claimHardWindowMs` and surface the "next player about to
   * draw" cue. Pure UI hint; the engine ignores this. Solo leaves it
   * unset (= no countdown, claim is effectively infinite).
   */
  claimSoftWindowMs?: number;
  /**
   * Hard fallback — past this point the server auto-passes any
   * non-discarder seat that hasn't submitted. Solo leaves it unset
   * (= infinite claim window; only bots + the user's explicit click
   * advance the hand).
   */
  claimHardWindowMs?: number;
}

export const DEFAULT_RULES: RuleConfig = {
  faanMin: 3,
  allowSevenPairs: true,
  allowThirteenOrphans: true,
  turnTimeoutMs: 20_000,
  claimWindowMs: 3_000,
  claimSoftWindowMs: 8_000,
  claimHardWindowMs: 12_000,
};

export const FAAN_OPTIONS: readonly RuleConfig['faanMin'][] = [0, 1, 3, 5] as const;

export type Claim =
  | { kind: 'pass' }
  | { kind: 'chi'; with: [Tile, Tile] } // the two tiles already in hand that complete the run
  | { kind: 'peng' }
  | { kind: 'gang' }
  | { kind: 'hu' };

export type DiePair = [number, number];

export interface OpeningRolls {
  /**
   * One pair of dice per seat that rolled. On the first hand of a session
   * all four seats roll; on subsequent hands, only the previous winner does.
   */
  dice: Partial<Record<Seat, DiePair>>;
  /** Wall break position (purely decorative in the simplified model). */
  breakPosition: number;
  /** Whether all four seats rolled (first hand of the session). */
  fullRoll: boolean;
}

export interface ClaimRound {
  discard: { tile: Tile; from: Seat };
  /** Soft floor — server-clock timestamp before which resolution is
   *  blocked even if every non-discarder seat has submitted. Computed
   *  as `discardTime + rules.claimWindowMs`. */
  deadlineMs: number;
  /** Soft expiry — server-clock timestamp at which the UI should
   *  start a visible "drawing in N…" countdown. Absent in solo
   *  (where `claimSoftWindowMs` is unset). */
  softExpiryMs?: number;
  /** Hard fallback — server-clock timestamp past which the server
   *  auto-passes any silent non-discarder seat. Absent in solo
   *  (where `claimHardWindowMs` is unset → infinite timeout). */
  hardDeadlineMs?: number;
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
  /**
   * Chronological log of every discard in the current hand. Each entry
   * records the tile and the seat that pitched it; the array index doubles
   * as the seq number used by the mobile shared-discard pool to render
   * tiles in true turn order. Cleared on `startHand`.
   */
  discardOrder: { tile: Tile; from: Seat }[];
  lastDiscard?: { tile: Tile; from: Seat } | undefined;
  pendingClaims?: ClaimRound | undefined;
  /** Cumulative scores across hands in the same lobby session. */
  scoreboard: Record<Seat, number>;
  /** Result of the most recent hand, if any. */
  lastResult?: HandResult | undefined;
  /** Opening dice for the current hand (cleared at the start of the next). */
  openingRolls?: OpeningRolls | undefined;
}

/** One scoring pattern that contributed faan, with its name + value. */
export interface FaanBreakdown {
  /** Traditional Chinese name (e.g. 清一色). */
  name: string;
  /** Short English gloss (e.g. "full flush"). */
  english: string;
  /** Faan contributed by this pattern. */
  faan: number;
  /**
   * Tiles that triggered this pattern (e.g. 9 dragon tiles for 大三元,
   * the single winning tile for 自摸, every tile in the hand for 字一色).
   */
  tiles: Tile[];
}

export type HandResult =
  | {
      kind: 'win';
      winner: Seat;
      from: Seat;
      tile: Tile;
      selfDraw: boolean;
      faan: number;
      breakdown: FaanBreakdown[];
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
    discardOrder: [],
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
 * Wind label for a given seat at the table, anchored to the dealer
 * (dealer is always East). The four seats rotate counter-clockwise
 * E → S → W → N, so seat-relative-to-dealer = (seat - dealer) mod 4.
 *
 * Used by every UI surface that renders a seat-wind glyph
 * (Scoreboard, PlayersSheet, OppHandStrip via DesktopTable / Match
 * placements). Lives in the engine package because the formula is
 * mahjong rules — clients shouldn't need to re-derive the rotation
 * convention themselves.
 */
export function seatWindFor(dealer: Seat, seat: Seat): Wind {
  // Cast is safe — `WINDS` has length 4 and the modulo keeps the
  // index in range.
  return WINDS[(seat - dealer + 4) % 4] as Wind;
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
