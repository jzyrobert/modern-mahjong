import {
  type Claim,
  type GameState,
  type Seat,
  type Tile,
  canChi,
  isWinning,
  legalClaimsFor,
  sameFace,
  shanten,
} from '@mahjong/game-logic';

/**
 * The minimum information a bot is allowed to see — the same projection of
 * GameState that a human at this seat would see (own hand revealed,
 * opponents' hands hidden but counts known). Bots that read more than this
 * would be cheating.
 */
export interface PlayerView {
  state: GameState;
  seat: Seat;
}

export type BotKind = 'simple' | 'heuristic' | 'passive';

export interface Bot {
  kind: BotKind;
  /** Pick a discard tile from the player's hand (called when it's their turn after drawing). */
  pickDiscard(view: PlayerView): Tile;
  /**
   * React to a discard during the claim window. Default response is `pass`
   * unless the bot affirmatively wants to claim.
   */
  pickClaim(view: PlayerView): Claim;
}

/**
 * `simple`: discards the most "isolated" tile — no neighbors of same suit
 * within ±2 ranks; no other copies of same honor. Falls through to first
 * tile if every tile is connected. Claims `peng`/`gong` only if it
 * completes a meld (i.e. always — those are valid melds by definition).
 * Never claims `chi`. Declares `hu` whenever isWinning is true and the
 * declared faan would meet the lobby minimum.
 */
export const simpleBot: Bot = {
  kind: 'simple',
  pickDiscard(view) {
    const hand = view.state.hands[view.seat];
    let best: Tile = hand[0]!;
    let bestScore = -1;
    for (const t of hand) {
      const score = isolationScore(t, hand);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  },
  pickClaim(view) {
    const { state, seat } = view;
    if (!state.lastDiscard) return { kind: 'pass' };
    // Win first.
    if (canDeclareWin(state, seat)) return { kind: 'hu' };
    const legal = legalClaimsFor(state, seat);
    if (legal.includes('gong')) return { kind: 'gong' };
    if (legal.includes('peng')) return { kind: 'peng' };
    return { kind: 'pass' };
  },
};

/**
 * `heuristic`: same as simple, but the discard is chosen to minimize
 * shanten of the resulting concealed hand. Ties broken by tile safety
 * (count of identical tiles already discarded across all seats — more
 * discards = safer). Claims `chi` only if it strictly reduces shanten.
 */
export const heuristicBot: Bot = {
  kind: 'heuristic',
  pickDiscard(view) {
    const { state, seat } = view;
    const hand = state.hands[seat];
    const exposed = state.melds[seat].length;

    let best: Tile = hand[0]!;
    let bestShanten = Number.POSITIVE_INFINITY;
    let bestSafety = -1;
    const seen = new Set<string>();

    for (const t of hand) {
      const k = faceKey(t);
      if (seen.has(k)) continue;
      seen.add(k);
      const remaining = removeOneFace(hand, t);
      const sh = shanten({ hand: remaining, exposedMelds: exposed });
      const safety = countDiscardedFace(state, t);
      if (sh < bestShanten || (sh === bestShanten && safety > bestSafety)) {
        bestShanten = sh;
        bestSafety = safety;
        best = t;
      }
    }
    return best;
  },
  pickClaim(view) {
    const { state, seat } = view;
    if (!state.lastDiscard) return { kind: 'pass' };
    if (canDeclareWin(state, seat)) return { kind: 'hu' };
    const legal = legalClaimsFor(state, seat);

    if (legal.includes('gong')) return { kind: 'gong' };
    if (legal.includes('peng')) return { kind: 'peng' };

    if (legal.includes('chi')) {
      const chi = pickChiIfImproving(state, seat);
      if (chi) return chi;
    }
    return { kind: 'pass' };
  },
};

/**
 * `passive`: the disconnect stand-in. Always discards the most recently
 * drawn tile (the last one in the hand). Never claims. Designed to do as
 * little harm as possible to the absent player's hand.
 */
export const passiveBot: Bot = {
  kind: 'passive',
  pickDiscard(view) {
    const hand = view.state.hands[view.seat];
    return hand[hand.length - 1]!;
  },
  pickClaim() {
    return { kind: 'pass' };
  },
};

export const bots: Record<BotKind, Bot> = {
  simple: simpleBot,
  heuristic: heuristicBot,
  passive: passiveBot,
};

// --- helpers -----------------------------------------------------------

function isolationScore(t: Tile, hand: readonly Tile[]): number {
  let neighbors = 0;
  for (const o of hand) {
    if (o === t) continue;
    if (t.kind === 'suit' && o.kind === 'suit' && o.suit === t.suit) {
      const d = Math.abs(o.rank - t.rank);
      if (d <= 2) neighbors++;
    } else if (t.kind === 'honor' && o.kind === 'honor' && o.honor === t.honor) {
      neighbors++;
    }
  }
  // Higher score = more isolated = better discard candidate.
  return -neighbors;
}

function canDeclareWin(state: GameState, seat: Seat): boolean {
  if (!state.lastDiscard) return false;
  const concealed = [...state.hands[seat], state.lastDiscard.tile];
  return isWinning({
    hand: concealed,
    exposedMelds: state.melds[seat].length,
    allowSpecial: state.rules.allowSevenPairs || state.rules.allowThirteenOrphans,
  });
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

function countDiscardedFace(state: GameState, t: Tile): number {
  let n = 0;
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    for (const d of state.discards[seat]) if (sameFace(d, t)) n++;
  }
  return n;
}

function pickChiIfImproving(state: GameState, seat: Seat): Claim | undefined {
  if (!state.lastDiscard) return undefined;
  const tile = state.lastDiscard.tile;
  if (tile.kind !== 'suit') return undefined;
  const hand = state.hands[seat];
  if (!canChi(hand, tile)) return undefined;

  const r = tile.rank;
  const exposed = state.melds[seat].length;
  const before = shanten({ hand, exposedMelds: exposed });

  const candidates: [number, number][] = [
    [r - 2, r - 1],
    [r - 1, r + 1],
    [r + 1, r + 2],
  ];
  for (const [a, b] of candidates) {
    if (a < 1 || b > 9) continue;
    const aTile = hand.find((t) => t.kind === 'suit' && t.suit === tile.suit && t.rank === a);
    const bTile = hand.find((t) => t.kind === 'suit' && t.suit === tile.suit && t.rank === b);
    if (!aTile || !bTile) continue;
    const after = removeOneFace(removeOneFace(hand, aTile), bTile);
    const sh = shanten({ hand: after, exposedMelds: exposed + 1 });
    if (sh < before) {
      return { kind: 'chi', with: [aTile, bTile] };
    }
  }
  return undefined;
}
