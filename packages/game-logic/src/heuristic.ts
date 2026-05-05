import { shanten } from './shanten.js';
import type { Seat } from './state.js';
import { DRAGONS, HONORS, RANKS, SUITS, type Tile, WINDS, type Wind, sameFace } from './tiles.js';

/**
 * The 34 unique tile faces — one per suit/rank pair plus one per
 * honor. Each face uses copy=0 since we're only checking face identity
 * (`sameFace`); the copy bit is irrelevant for shanten reasoning.
 */
export const ALL_FACES: readonly Tile[] = (() => {
  const out: Tile[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      out.push({ kind: 'suit', suit, rank, copy: 0 });
    }
  }
  for (const honor of HONORS) {
    out.push({ kind: 'honor', honor, copy: 0 });
  }
  return out;
})();

/** Seat wind for `seat` given the dealer. WINDS[0]=E so dealer's seat is East. */
export function seatWind(dealer: Seat, seat: Seat): Wind {
  return WINDS[(seat - dealer + 4) % 4]!;
}

export interface YakuhaiContext {
  dealer: Seat;
  prevailingWind: Wind;
  seat: Seat;
}

/**
 * A tile face is "yakuhai" — i.e. a triplet of it scores 1 faan in HK
 * rules — when it's a dragon or matches the prevailing wind or the
 * seat wind. See scoring.ts: 三元牌 (dragon triplet, 1 faan), 圈風 W
 * (prevailing-wind triplet, 1 faan), 門風 W (seat-wind triplet, 1
 * faan).
 */
export function isYakuhaiFace(face: Tile, ctx: YakuhaiContext): boolean {
  if (face.kind !== 'honor') return false;
  if ((DRAGONS as readonly string[]).includes(face.honor)) return true;
  if (face.honor === ctx.prevailingWind) return true;
  if (face.honor === seatWind(ctx.dealer, ctx.seat)) return true;
  return false;
}

/** Count yakuhai faces present as a pair (≥ 2 copies) in `hand`. */
export function yakuhaiPairCount(hand: readonly Tile[], ctx: YakuhaiContext): number {
  const seen = new Map<string, number>();
  for (const t of hand) {
    if (t.kind !== 'honor') continue;
    if (!isYakuhaiFace(t, ctx)) continue;
    const k = t.honor;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  let pairs = 0;
  for (const n of seen.values()) if (n >= 2) pairs++;
  return pairs;
}

export interface UkeireInput {
  hand: readonly Tile[];
  exposedMelds?: number;
  allowSpecial?: boolean;
}

/**
 * Effective-tile count: how many distinct tile faces, when added to
 * `hand`, would strictly reduce shanten. A higher ukeire on the same
 * shanten means a more flexible wait — more incoming faces accept the
 * hand, fewer wasted draws.
 *
 * Pure: makes ~34 shanten calls per invocation. Memoise at the call
 * site (e.g. `useMemo` keyed by hand-tileIds) for hot paths like the
 * UI hint.
 */
export function ukeire(input: UkeireInput): number {
  const { hand, exposedMelds = 0, allowSpecial = true } = input;
  const baseShanten = shanten({ hand, exposedMelds, allowSpecial });
  if (baseShanten < 0) return 0;
  let count = 0;
  for (const face of ALL_FACES) {
    // A 5th copy of a face the hand already has 4 of can't help.
    let already = 0;
    for (const t of hand) if (sameFace(t, face)) already++;
    if (already >= 4) continue;
    const test = [...hand, face];
    if (shanten({ hand: test, exposedMelds, allowSpecial }) < baseShanten) {
      count++;
    }
  }
  return count;
}

export interface DiscardChoiceInput {
  hand: readonly Tile[];
  exposedMelds?: number;
  allowSpecial?: boolean;
  yakuhai: YakuhaiContext;
  /** Optional safety scorer — higher = safer to discard. The bot
   *  typically passes `countDiscardedFace` from the live state. */
  safety?: (face: Tile) => number;
}

export interface DiscardScore {
  tile: Tile;
  shanten: number;
  ukeire: number;
  /** Pairs of yakuhai faces in the resulting hand. Higher = more
   *  yakuhai protection retained. */
  yakuhaiPairs: number;
  safety: number;
}

/**
 * Score every distinct face in `hand` as a discard candidate, ordered
 * lexicographically by:
 *
 *   1. lowest resulting shanten (the original heuristic)
 *   2. highest resulting ukeire (more accepting tiles)
 *   3. highest yakuhai pair retention (don't break value pairs)
 *   4. highest caller-supplied safety (deal-in risk proxy)
 *
 * Returns the candidates sorted best-first; the bot picks `[0]`, the
 * UI hint highlights `[0].tile`.
 *
 * Two-pass to keep the cost reasonable: only candidates that *already*
 * tie for min shanten run the inner ukeire loop (~34 shanten calls
 * each). Discards that worsen shanten get `ukeire: 0` since they
 * can't be the bot's pick anyway. Per turn this is ~`uniqueFaces`
 * shanten calls + `~few × 34` for the ukeire of the tied candidates,
 * vs. the naive `~uniqueFaces × 34` if every candidate ran ukeire.
 */
export function rankDiscards(input: DiscardChoiceInput): DiscardScore[] {
  const { hand, exposedMelds = 0, allowSpecial = true, yakuhai, safety } = input;
  // First pass: shanten + cheap signals for every distinct candidate.
  interface PartialScore {
    tile: Tile;
    shanten: number;
    remaining: Tile[];
    yakuhaiPairs: number;
    safety: number;
  }
  const seen = new Set<string>();
  const partial: PartialScore[] = [];
  let minShanten = Number.POSITIVE_INFINITY;
  for (const t of hand) {
    const k = faceKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    const remaining = removeOneFace(hand, t);
    const sh = shanten({ hand: remaining, exposedMelds, allowSpecial });
    if (sh < minShanten) minShanten = sh;
    partial.push({
      tile: t,
      shanten: sh,
      remaining,
      yakuhaiPairs: yakuhaiPairCount(remaining, yakuhai),
      safety: safety ? safety(t) : 0,
    });
  }
  // Second pass: ukeire is only meaningful as a tiebreak on min-shanten
  // candidates. Worsening discards keep `ukeire: 0` — they're never
  // going to be picked as long as min-shanten candidates exist.
  const out: DiscardScore[] = partial.map((p) => ({
    tile: p.tile,
    shanten: p.shanten,
    ukeire:
      p.shanten === minShanten ? ukeire({ hand: p.remaining, exposedMelds, allowSpecial }) : 0,
    yakuhaiPairs: p.yakuhaiPairs,
    safety: p.safety,
  }));
  out.sort(compareDiscardScore);
  return out;
}

function compareDiscardScore(a: DiscardScore, b: DiscardScore): number {
  if (a.shanten !== b.shanten) return a.shanten - b.shanten;
  if (a.ukeire !== b.ukeire) return b.ukeire - a.ukeire;
  if (a.yakuhaiPairs !== b.yakuhaiPairs) return b.yakuhaiPairs - a.yakuhaiPairs;
  return b.safety - a.safety;
}

function faceKey(t: Tile): string {
  return t.kind === 'suit' ? `s:${t.suit}:${t.rank}` : `h:${t.honor}`;
}

function removeOneFace(hand: readonly Tile[], target: Tile): Tile[] {
  const out = [...hand];
  const i = out.findIndex((t) => sameFace(t, target));
  if (i >= 0) out.splice(i, 1);
  return out;
}
