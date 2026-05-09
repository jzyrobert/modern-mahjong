import {
  type Action,
  DEFAULT_RULES,
  type GameState,
  SEATS,
  type Seat,
  type Tile,
  chiOptions,
  emptyState,
  isWinning,
  legalClaimsFor,
  meldSize,
  reduce,
  sameFace,
  tileId,
} from '../src/index.js';

/**
 * Engine fuzzing helpers — used by both the cheap in-CI invariant tests
 * (`invariants.test.ts`) and the long opt-in campaign
 * (`fuzz-campaign.test.ts`). Lives in a non-`*.test.ts` file so vitest
 * doesn't pick it up as a suite of its own when the campaign file
 * imports from it.
 */

// Solo rules: drop the fairness gate so claim resolution is synchronous
// and `awaitingClaims` can't pin us forever waiting on a wall-clock
// deadline that won't tick during a synchronous test.
export const SOLO_RULES = (() => {
  const { claimSoftWindowMs: _s, claimHardWindowMs: _h, ...rest } = DEFAULT_RULES;
  void _s;
  void _h;
  return { ...rest, faanMin: 0, turnTimeoutMs: 0 } as const;
})();

export const MAX_STEPS = 400;

export interface Driver {
  state: GameState;
  steps: number;
  trace: Action[];
}

export function startDriver(seed: number, dealer: Seat = 0): Driver {
  const init = emptyState(SOLO_RULES);
  const start = reduce(init, { t: 'startHand', seed, dealer }).state;
  return { state: start, steps: 0, trace: [{ t: 'startHand', seed, dealer }] };
}

function totalGangCount(state: GameState): number {
  let n = 0;
  for (const s of SEATS) {
    for (const m of state.melds[s]) {
      if (m.kind === 'gang-exposed' || m.kind === 'gang-concealed' || m.kind === 'gang-promoted') {
        n++;
      }
    }
  }
  return n;
}

function totalMeldTiles(state: GameState, seat: Seat): number {
  let n = 0;
  for (const m of state.melds[seat]) n += meldSize(m);
  return n;
}

function gangCountFor(state: GameState, seat: Seat): number {
  let n = 0;
  for (const m of state.melds[seat]) {
    if (m.kind === 'gang-exposed' || m.kind === 'gang-concealed' || m.kind === 'gang-promoted') {
      n++;
    }
  }
  return n;
}

function allTileIds(state: GameState): number[] {
  const ids: number[] = [];
  for (const t of state.wall) ids.push(tileId(t));
  for (const t of state.deadWall) ids.push(tileId(t));
  for (const s of SEATS) {
    for (const t of state.hands[s]) ids.push(tileId(t));
    for (const t of state.discards[s]) ids.push(tileId(t));
    for (const m of state.melds[s]) for (const t of m.tiles) ids.push(tileId(t));
  }
  return ids;
}

function hasFourOf(hand: readonly Tile[], face: Tile): boolean {
  let n = 0;
  for (const t of hand) if (sameFace(t, face)) n++;
  return n >= 4;
}

function promotionTargets(state: GameState, seat: Seat): Tile[] {
  const out: Tile[] = [];
  for (const m of state.melds[seat]) {
    if (m.kind !== 'peng') continue;
    const face = m.tiles[0];
    if (!face) continue;
    const inHand = state.hands[seat].find((t) => sameFace(t, face));
    if (inHand) out.push(inHand);
  }
  return out;
}

export function legalActions(state: GameState): Action[] {
  const out: Action[] = [];
  if (state.phase === 'turn') {
    const seat = state.turn;
    if (!state.hasDrawn) {
      out.push({ t: 'draw', seat });
    } else {
      for (const tile of state.hands[seat]) out.push({ t: 'discard', seat, tile });
      const seen = new Set<string>();
      for (const tile of state.hands[seat]) {
        const k = tile.kind === 'suit' ? `s:${tile.suit}:${tile.rank}` : `h:${tile.honor}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (hasFourOf(state.hands[seat], tile)) {
          out.push({ t: 'declareGangConcealed', seat, tile });
        }
      }
      for (const tile of promotionTargets(state, seat)) {
        out.push({ t: 'declareGangPromoted', seat, tile });
      }
      if (
        isWinning({
          hand: state.hands[seat],
          exposedMelds: state.melds[seat].length,
          allowSpecial: state.rules.allowSevenPairs || state.rules.allowThirteenOrphans,
        })
      ) {
        out.push({ t: 'declareWin', seat, selfDraw: true });
      }
    }
  } else if (state.phase === 'awaitingClaims' && state.pendingClaims) {
    const submitted = state.pendingClaims.submitted;
    const discarder = state.pendingClaims.discard.from;
    for (const seat of SEATS) {
      if (seat === discarder) continue;
      if (submitted[seat]) continue;
      out.push({ t: 'declareClaim', seat, claim: { kind: 'pass' } });
      const legal = legalClaimsFor(state, seat);
      for (const kind of legal) {
        if (kind === 'pass') continue;
        if (kind === 'peng') out.push({ t: 'declareClaim', seat, claim: { kind: 'peng' } });
        if (kind === 'gang') out.push({ t: 'declareClaim', seat, claim: { kind: 'gang' } });
        if (kind === 'chi') {
          for (const [a, b] of chiOptions(state.hands[seat], state.pendingClaims.discard.tile)) {
            out.push({ t: 'declareClaim', seat, claim: { kind: 'chi', with: [a, b] } });
          }
        }
      }
      const winnable = isWinning({
        hand: [...state.hands[seat], state.pendingClaims.discard.tile],
        exposedMelds: state.melds[seat].length,
        allowSpecial: state.rules.allowSevenPairs || state.rules.allowThirteenOrphans,
      });
      if (winnable) {
        out.push({ t: 'declareClaim', seat, claim: { kind: 'hu' } });
      }
    }
  }
  return out;
}

export function pickAction(candidates: Action[], rand: () => number): Action {
  // Always take a self-draw win when one's offered — exercises declareWin
  // (selfDraw=true). Random walks effectively never assemble a winning
  // hand otherwise, so this is the only realistic way to cover the path.
  const wins = candidates.filter((a) => a.t === 'declareWin');
  if (wins.length > 0) return wins[0]!;
  // Take a hu-claim if offered (rare, but bumps the win/applyClaim branch).
  const hus = candidates.filter((a) => a.t === 'declareClaim' && a.claim.kind === 'hu');
  if (hus.length > 0) return hus[0]!;
  // Slight bias: pick a discard 50% of the time when one is available.
  // Without this the fuzzer can spend most of its budget on pass-loops.
  const discards = candidates.filter((a) => a.t === 'discard');
  if (discards.length > 0 && rand() < 0.5) {
    return discards[Math.floor(rand() * discards.length)]!;
  }
  return candidates[Math.floor(rand() * candidates.length)]!;
}

export interface InvariantViolation {
  invariant: string;
  detail: string;
}

export function checkInvariants(state: GameState): InvariantViolation | null {
  // [1] Tile conservation: total tiles always = 136.
  const ids = allTileIds(state);
  if (ids.length !== 136) {
    return { invariant: 'tile-conservation', detail: `total=${ids.length}, expected 136` };
  }

  // [2] No tile in two places: every tileId is unique.
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) {
      return {
        invariant: 'unique-tileIds',
        detail: `tileId ${id} appears twice across wall/hands/discards/melds`,
      };
    }
    seen.add(id);
  }

  // [3] Dead wall + total gang count = 14.
  const expectedDeadWall = 14 - totalGangCount(state);
  if (state.deadWall.length !== expectedDeadWall) {
    return {
      invariant: 'dead-wall-balance',
      detail: `deadWall=${state.deadWall.length}, expected 14 - gangCount(${totalGangCount(state)}) = ${expectedDeadWall}`,
    };
  }

  // [4] Per-seat tile balance.
  for (const seat of SEATS) {
    const hand = state.hands[seat].length;
    const meld = totalMeldTiles(state, seat);
    const gangs = gangCountFor(state, seat);
    const balance = hand + meld - gangs;
    let expected: number | null = null;
    // During a 搶槓 rob window the gang seat keeps the promotion tile
    // in hand (engine moves it into the meld only on all-pass, or pops
    // it back to the winner on a successful rob — see
    // declareGangPromoted / finalizePromotion). So the gang seat looks
    // like 14 effective tiles even though phase=awaitingClaims.
    const inRobWindowAsGangSeat =
      state.phase === 'awaitingClaims' &&
      state.pendingPromotedGang !== undefined &&
      state.pendingPromotedGang.seat === seat;
    if (state.phase === 'turn' && state.turn === seat) {
      expected = state.hasDrawn ? 14 : 13;
    } else if (inRobWindowAsGangSeat) {
      expected = 14;
    } else if (state.phase === 'turn' || state.phase === 'awaitingClaims') {
      expected = 13;
    } else if (state.phase === 'resolved' && state.lastResult?.kind === 'win') {
      expected = state.lastResult.winner === seat ? 14 : 13;
    }
    if (expected !== null && balance !== expected) {
      return {
        invariant: 'per-seat-tile-balance',
        detail: `seat ${seat}: hand=${hand} + meld=${meld} - gangs=${gangs} = ${balance}, expected ${expected} (phase=${state.phase}, turn=${state.turn}, hasDrawn=${state.hasDrawn}, winner=${state.lastResult?.kind === 'win' ? state.lastResult.winner : 'n/a'}, robWindow=${inRobWindowAsGangSeat})`,
      };
    }
  }

  // [5] gangReplacementCount in [0, 4].
  if (state.gangReplacementCount < 0 || state.gangReplacementCount > 4) {
    return {
      invariant: 'gang-replacement-count-range',
      detail: `gangReplacementCount=${state.gangReplacementCount}`,
    };
  }

  // [6] Phase / lastDiscard coherence.
  if (state.phase === 'awaitingClaims') {
    if (!state.lastDiscard) {
      return {
        invariant: 'awaiting-claims-coherence',
        detail: 'phase=awaitingClaims but lastDiscard is undefined',
      };
    }
    if (!state.pendingClaims) {
      return {
        invariant: 'awaiting-claims-coherence',
        detail: 'phase=awaitingClaims but pendingClaims is undefined',
      };
    }
    if (
      state.pendingClaims.discard.from !== state.lastDiscard.from ||
      tileId(state.pendingClaims.discard.tile) !== tileId(state.lastDiscard.tile)
    ) {
      return {
        invariant: 'awaiting-claims-coherence',
        detail: 'pendingClaims.discard does not match lastDiscard',
      };
    }
  }

  // [7] Pending promoted gang.
  if (state.pendingPromotedGang) {
    if (state.phase !== 'awaitingClaims') {
      return {
        invariant: 'pending-promoted-gang',
        detail: `pendingPromotedGang set but phase=${state.phase}`,
      };
    }
    if (state.lastDiscard?.from !== state.pendingPromotedGang.seat) {
      return {
        invariant: 'pending-promoted-gang',
        detail: 'lastDiscard.from does not match pendingPromotedGang.seat',
      };
    }
  }

  // [8] Win → resolved + lastResult shape sane.
  if (state.phase === 'resolved' && state.lastResult?.kind === 'win') {
    const r = state.lastResult;
    if (r.faan < 0) {
      return { invariant: 'win-result-shape', detail: `negative faan: ${r.faan}` };
    }
    if (r.breakdown.reduce((acc, b) => acc + b.faan, 0) !== r.faan) {
      return {
        invariant: 'win-result-shape',
        detail: 'breakdown faan sum does not match total faan',
      };
    }
  }

  // [9] Wall / dead wall lengths non-negative.
  if (state.wall.length < 0 || state.deadWall.length < 0) {
    return {
      invariant: 'wall-non-negative',
      detail: `wall=${state.wall.length}, deadWall=${state.deadWall.length}`,
    };
  }

  // [10] Meld `from` consistency.
  for (const seat of SEATS) {
    for (const m of state.melds[seat]) {
      if (m.kind === 'gang-concealed') {
        if (m.from !== undefined) {
          return {
            invariant: 'meld-from-consistency',
            detail: `gang-concealed on seat ${seat} has from=${m.from}`,
          };
        }
      } else {
        if (m.from === undefined) {
          return {
            invariant: 'meld-from-consistency',
            detail: `${m.kind} on seat ${seat} has from=undefined`,
          };
        }
        if (m.from === seat) {
          return {
            invariant: 'meld-from-consistency',
            detail: `${m.kind} on seat ${seat} has from=seat (self-claim)`,
          };
        }
      }
    }
  }

  return null;
}

export function snapshotEqual(a: GameState, b: GameState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
