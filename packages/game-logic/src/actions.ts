import { applyClaim, resolveClaims } from './claims.js';
import type { Meld } from './hand.js';
import { meldSize } from './hand.js';
import { shuffle } from './rng.js';
import { scoreHand } from './scoring.js';
import { isWinning } from './shanten.js';
import type { Claim, GameState, RuleConfig, Seat } from './state.js';
import { DEFAULT_RULES, SEATS, emptyState, nextSeat } from './state.js';
import { sameFace, sameTile } from './tiles.js';
import type { Tile } from './tiles.js';
import { buildWall } from './tiles.js';

export type Action =
  | { t: 'startHand'; seed: number; dealer?: Seat }
  | { t: 'setRules'; rules: Partial<RuleConfig> }
  | { t: 'draw'; seat: Seat } // server-issued automatically at turn boundaries
  | { t: 'discard'; seat: Seat; tile: Tile }
  | { t: 'declareClaim'; seat: Seat; claim: Claim }
  | { t: 'resolveClaims'; nowMs: number } // server-issued (deadline reached or all submitted)
  | { t: 'declareKongConcealed'; seat: Seat; tile: Tile } // 4 of a kind in hand
  | { t: 'declareKongPromoted'; seat: Seat; tile: Tile } // adding to existing peng
  | { t: 'declareWin'; seat: Seat; selfDraw: boolean };

export type Event =
  | { t: 'handStarted'; seed: number }
  | { t: 'rulesChanged'; rules: RuleConfig }
  | { t: 'drew'; seat: Seat; tile: Tile }
  | { t: 'discarded'; seat: Seat; tile: Tile }
  | { t: 'claimsOpened'; deadlineMs: number }
  | { t: 'claimsResolved'; result: ReturnType<typeof resolveClaims> }
  | { t: 'kongDeclared'; seat: Seat; kind: 'concealed' | 'promoted' | 'exposed' }
  | {
      t: 'won';
      seat: Seat;
      from: Seat;
      tile: Tile;
      selfDraw: boolean;
      faan: number;
      reasons: string[];
    }
  | { t: 'drawn-game'; reason: 'wall-empty' };

export class IllegalActionError extends Error {
  constructor(
    public readonly code: string,
    msg: string,
  ) {
    super(`[${code}] ${msg}`);
    this.name = 'IllegalActionError';
  }
}

/**
 * Pure reducer: takes a state and an action, returns a new state plus a list
 * of events to broadcast. Throws IllegalActionError on invalid input — the
 * server is expected to catch this and emit a typed error response.
 */
export function reduce(state: GameState, action: Action): { state: GameState; events: Event[] } {
  switch (action.t) {
    case 'startHand':
      return startHand(state, action.seed, action.dealer ?? state.dealer);
    case 'setRules':
      return setRules(state, action.rules);
    case 'draw':
      return drawTile(state, action.seat);
    case 'discard':
      return discard(state, action.seat, action.tile);
    case 'declareClaim':
      return declareClaim(state, action.seat, action.claim);
    case 'resolveClaims':
      return resolveAndApply(state, action.nowMs);
    case 'declareKongConcealed':
      return declareKongConcealed(state, action.seat, action.tile);
    case 'declareKongPromoted':
      return declareKongPromoted(state, action.seat, action.tile);
    case 'declareWin':
      return declareWin(state, action.seat, action.selfDraw);
  }
}

function setRules(
  state: GameState,
  patch: Partial<RuleConfig>,
): { state: GameState; events: Event[] } {
  if (state.phase !== 'waiting' && state.phase !== 'resolved') {
    throw new IllegalActionError('PHASE', 'rules can only change between hands');
  }
  const merged: RuleConfig = { ...state.rules, ...patch };
  if (rulesEqual(merged, state.rules)) {
    return { state, events: [] };
  }
  return {
    state: { ...state, rules: merged },
    events: [{ t: 'rulesChanged', rules: merged }],
  };
}

function rulesEqual(a: RuleConfig, b: RuleConfig): boolean {
  return (
    a.faanMin === b.faanMin &&
    a.allowSevenPairs === b.allowSevenPairs &&
    a.allowThirteenOrphans === b.allowThirteenOrphans &&
    a.turnTimeoutMs === b.turnTimeoutMs &&
    a.claimWindowMs === b.claimWindowMs
  );
}

function startHand(
  prev: GameState,
  seed: number,
  dealer: Seat,
): { state: GameState; events: Event[] } {
  const rules: RuleConfig = prev.rules ?? DEFAULT_RULES;
  const fresh = emptyState(rules);
  const wall = shuffle(buildWall(), seed);
  // Last 14 tiles are the dead wall (kong replacements).
  const deadWall = wall.splice(wall.length - 14, 14);

  const hands: Record<Seat, Tile[]> = { 0: [], 1: [], 2: [], 3: [] };
  // Deal 13 tiles per player; dealer gets 14 (will discard first without drawing).
  for (let round = 0; round < 13; round++) {
    for (const seat of SEATS) hands[seat].push(wall.pop()!);
  }
  hands[dealer].push(wall.pop()!);

  const state: GameState = {
    ...fresh,
    seed,
    dealer,
    turn: dealer,
    hasDrawn: true, // dealer effectively just drew their 14th tile
    phase: 'turn',
    wall,
    deadWall,
    hands,
    scoreboard: prev.scoreboard,
    prevailingWind: prev.prevailingWind,
  };
  return { state, events: [{ t: 'handStarted', seed }] };
}

function drawTile(state: GameState, seat: Seat): { state: GameState; events: Event[] } {
  if (state.phase !== 'turn') throw new IllegalActionError('PHASE', 'draw outside turn phase');
  if (state.turn !== seat) throw new IllegalActionError('SEAT', 'not your turn');
  if (state.hasDrawn) throw new IllegalActionError('STATE', 'already drew this turn');
  if (state.wall.length === 0) {
    return {
      state: { ...state, phase: 'resolved', lastResult: { kind: 'draw', reason: 'wall-empty' } },
      events: [{ t: 'drawn-game', reason: 'wall-empty' }],
    };
  }
  const wall = [...state.wall];
  const tile = wall.pop()!;
  const hands = { ...state.hands, [seat]: [...state.hands[seat], tile] };
  return {
    state: { ...state, wall, hands, hasDrawn: true },
    events: [{ t: 'drew', seat, tile }],
  };
}

function discard(state: GameState, seat: Seat, tile: Tile): { state: GameState; events: Event[] } {
  if (state.phase !== 'turn') throw new IllegalActionError('PHASE', 'discard outside turn phase');
  if (state.turn !== seat) throw new IllegalActionError('SEAT', 'not your turn');
  if (!state.hasDrawn) throw new IllegalActionError('STATE', 'must draw before discard');
  const idx = state.hands[seat].findIndex((t) => sameTile(t, tile));
  if (idx < 0) throw new IllegalActionError('TILE', 'tile not in hand');

  const newHand = [...state.hands[seat]];
  newHand.splice(idx, 1);
  const hands = { ...state.hands, [seat]: newHand };
  const discards = { ...state.discards, [seat]: [...state.discards[seat], tile] };

  const deadlineMs = Date.now() + state.rules.claimWindowMs;
  return {
    state: {
      ...state,
      phase: 'awaitingClaims',
      hands,
      discards,
      hasDrawn: false,
      lastDiscard: { tile, from: seat },
      pendingClaims: { discard: { tile, from: seat }, deadlineMs, submitted: {} },
    },
    events: [
      { t: 'discarded', seat, tile },
      { t: 'claimsOpened', deadlineMs },
    ],
  };
}

function declareClaim(
  state: GameState,
  seat: Seat,
  claim: Claim,
): { state: GameState; events: Event[] } {
  if (state.phase !== 'awaitingClaims' || !state.pendingClaims) {
    throw new IllegalActionError('PHASE', 'no claim window open');
  }
  if (state.lastDiscard?.from === seat) {
    throw new IllegalActionError('SEAT', 'discarder cannot claim own discard');
  }
  return {
    state: {
      ...state,
      pendingClaims: {
        ...state.pendingClaims,
        submitted: { ...state.pendingClaims.submitted, [seat]: claim },
      },
    },
    events: [],
  };
}

function resolveAndApply(state: GameState, nowMs: number): { state: GameState; events: Event[] } {
  if (state.phase !== 'awaitingClaims' || !state.pendingClaims) {
    return { state, events: [] }; // idempotent no-op
  }
  // Pad missing seats with a pass so resolveClaims has full info.
  const filled = { ...state.pendingClaims.submitted };
  for (const seat of SEATS) {
    if (seat === state.pendingClaims.discard.from) continue;
    if (!filled[seat]) filled[seat] = { kind: 'pass' };
  }
  const resolution = resolveClaims({ ...state.pendingClaims, submitted: filled });
  const events: Event[] = [{ t: 'claimsResolved', result: resolution }];
  void nowMs;

  if (resolution.kind === 'pass') {
    // Advance to next seat for a draw.
    const next = nextSeat(state.pendingClaims.discard.from);
    return {
      state: {
        ...state,
        phase: 'turn',
        pendingClaims: undefined,
        turn: next,
        hasDrawn: false,
      },
      events,
    };
  }
  // Claim wins. For hu, the caller will issue declareWin next.
  const newState = applyClaim(state, resolution);
  return { state: newState, events };
}

function declareKongConcealed(
  state: GameState,
  seat: Seat,
  tile: Tile,
): { state: GameState; events: Event[] } {
  if (state.phase !== 'turn') throw new IllegalActionError('PHASE', 'wrong phase for kong');
  if (state.turn !== seat) throw new IllegalActionError('SEAT', 'not your turn');
  const matching = state.hands[seat].filter((t) => sameFace(t, tile));
  if (matching.length < 4) throw new IllegalActionError('TILE', 'not 4 in hand');
  const newHand = state.hands[seat].filter((t) => !sameFace(t, tile));
  const meld: Meld = { kind: 'kong-concealed', tiles: matching };
  const melds = { ...state.melds, [seat]: [...state.melds[seat], meld] };
  // Replacement draw from the dead wall.
  const deadWall = [...state.deadWall];
  const replacement = deadWall.shift();
  if (replacement) newHand.push(replacement);

  return {
    state: {
      ...state,
      hands: { ...state.hands, [seat]: newHand },
      melds,
      deadWall,
    },
    events: [{ t: 'kongDeclared', seat, kind: 'concealed' }],
  };
}

function declareKongPromoted(
  state: GameState,
  seat: Seat,
  tile: Tile,
): { state: GameState; events: Event[] } {
  if (state.phase !== 'turn') throw new IllegalActionError('PHASE', 'wrong phase for kong');
  if (state.turn !== seat) throw new IllegalActionError('SEAT', 'not your turn');
  const meldIdx = state.melds[seat].findIndex(
    (m) => m.kind === 'peng' && m.tiles.some((t) => sameFace(t, tile)),
  );
  if (meldIdx < 0) throw new IllegalActionError('MELD', 'no matching peng to promote');
  const handIdx = state.hands[seat].findIndex((t) => sameFace(t, tile));
  if (handIdx < 0) throw new IllegalActionError('TILE', 'no matching tile in hand');

  const newHand = [...state.hands[seat]];
  const promoted = newHand.splice(handIdx, 1)[0]!;
  const oldMeld = state.melds[seat][meldIdx]!;
  const newMeld: Meld = {
    kind: 'kong-promoted',
    tiles: [...oldMeld.tiles, promoted],
    ...(oldMeld.from !== undefined ? { from: oldMeld.from } : {}),
  };
  const newMelds = state.melds[seat].slice();
  newMelds[meldIdx] = newMeld;
  const deadWall = [...state.deadWall];
  const replacement = deadWall.shift();
  if (replacement) newHand.push(replacement);

  return {
    state: {
      ...state,
      hands: { ...state.hands, [seat]: newHand },
      melds: { ...state.melds, [seat]: newMelds },
      deadWall,
    },
    events: [{ t: 'kongDeclared', seat, kind: 'promoted' }],
  };
}

function declareWin(
  state: GameState,
  seat: Seat,
  selfDraw: boolean,
): { state: GameState; events: Event[] } {
  let winningTile: Tile;
  if (selfDraw) {
    if (state.phase !== 'turn' || state.turn !== seat || !state.hasDrawn) {
      throw new IllegalActionError('PHASE', 'self-draw win needs turn+drawn');
    }
    winningTile = state.hands[seat][state.hands[seat].length - 1]!;
  } else {
    if (!state.lastDiscard) throw new IllegalActionError('STATE', 'no discard to win on');
    winningTile = state.lastDiscard.tile;
  }
  const concealed = selfDraw ? state.hands[seat] : [...state.hands[seat], winningTile];
  const exposedMelds = countExposedGroups(state.melds[seat]);
  const winning = isWinning({
    hand: concealed,
    exposedMelds,
    allowSpecial: state.rules.allowSevenPairs || state.rules.allowThirteenOrphans,
  });
  if (!winning) throw new IllegalActionError('SHAPE', 'hand is not winning');

  const score = scoreHand({ state, winner: seat, winningTile, selfDraw });
  if (score.faan < state.rules.faanMin) {
    throw new IllegalActionError(
      'FAAN',
      `below faan minimum (${score.faan} < ${state.rules.faanMin})`,
    );
  }
  const fromSeat: Seat = selfDraw ? seat : state.lastDiscard!.from;
  return {
    state: {
      ...state,
      phase: 'resolved',
      lastResult: {
        kind: 'win',
        winner: seat,
        from: fromSeat,
        tile: winningTile,
        selfDraw,
        faan: score.faan,
        reasons: score.reasons,
      },
      scoreboard: { ...state.scoreboard, [seat]: state.scoreboard[seat] + score.faan },
    },
    events: [
      {
        t: 'won',
        seat,
        from: fromSeat,
        tile: winningTile,
        selfDraw,
        faan: score.faan,
        reasons: score.reasons,
      },
    ],
  };
}

function countExposedGroups(melds: readonly Meld[]): number {
  // Each meld counts as one group for shanten purposes.
  return melds.length;
}

/** Convenience invariant assertion used by tests. */
export function assertTileConservation(state: GameState): void {
  let total = state.wall.length + state.deadWall.length;
  for (const seat of SEATS) {
    total += state.hands[seat].length;
    total += state.discards[seat].length;
    for (const m of state.melds[seat]) total += meldSize(m);
  }
  if (total !== 136) {
    throw new Error(`tile conservation broken: ${total} != 136`);
  }
}
