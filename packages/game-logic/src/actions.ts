import { applyClaim, hasMeaningfulClaim, legalClaimsFor, resolveClaims } from './claims.js';
import type { Meld } from './hand.js';
import { meldSize, removeFirstFace } from './hand.js';
import { rollDice, shuffle } from './rng.js';
import { scoreHand } from './scoring.js';
import { isWinning } from './shanten.js';
import type {
  Claim,
  ClaimRound,
  DiePair,
  FaanBreakdown,
  GameState,
  OpeningRolls,
  RuleConfig,
  Seat,
} from './state.js';
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
  | { t: 'declareGangConcealed'; seat: Seat; tile: Tile } // 4 of a kind in hand
  | { t: 'declareGangPromoted'; seat: Seat; tile: Tile } // adding to existing peng
  | { t: 'declareWin'; seat: Seat; selfDraw: boolean };

export type Event =
  | { t: 'handStarted'; seed: number }
  | { t: 'opened'; rolls: OpeningRolls }
  | { t: 'rulesChanged'; rules: RuleConfig }
  | { t: 'drew'; seat: Seat; tile: Tile }
  | { t: 'discarded'; seat: Seat; tile: Tile }
  | { t: 'claimsOpened'; deadlineMs: number }
  | { t: 'claimsResolved'; result: ReturnType<typeof resolveClaims> }
  | { t: 'gangDeclared'; seat: Seat; kind: 'concealed' | 'promoted' | 'exposed' }
  | {
      t: 'won';
      seat: Seat;
      from: Seat;
      tile: Tile;
      selfDraw: boolean;
      faan: number;
      breakdown: FaanBreakdown[];
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
 *
 * The trickiest action here is `declareClaim` and the `awaitingClaims`
 * window it feeds into; for an end-to-end map of the discard / pre-pass /
 * declareClaim / canFinalizeHu / resolveClaims / applyClaim / declareWin
 * chain, see `docs/CLAIM_FLOW.md` in the repo root.
 */
export function reduce(state: GameState, action: Action): { state: GameState; events: Event[] } {
  switch (action.t) {
    case 'startHand':
      return startHand(state, action.seed, action.dealer);
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
    case 'declareGangConcealed':
      return declareGangConcealed(state, action.seat, action.tile);
    case 'declareGangPromoted':
      return declareGangPromoted(state, action.seat, action.tile);
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
    a.claimWindowMs === b.claimWindowMs &&
    a.claimSoftWindowMs === b.claimSoftWindowMs &&
    a.claimHardWindowMs === b.claimHardWindowMs
  );
}

function startHand(
  prev: GameState,
  seed: number,
  dealerInput: Seat | undefined,
): { state: GameState; events: Event[] } {
  const rules: RuleConfig = prev.rules ?? DEFAULT_RULES;
  const fresh = emptyState(rules);
  const openingRolls = computeOpeningRolls(prev, seed);
  // Dealer resolution:
  //   - explicit `dealerInput` always wins (used by `nextDealer` between
  //     hands so HK dealer-rotation rules apply)
  //   - else, on a full roll (first hand of a match), pick the seat with
  //     the highest dice sum — ties resolved by seat order (lowest index
  //     wins). This is the actual function the opening rolls have always
  //     been displayed for; previously the engine ignored them and
  //     defaulted to `state.dealer` (= 0 on first hand), so the user's
  //     seat was always dealer regardless of what the dice landed on.
  //   - else (partial roll, e.g. winner's re-roll), inherit `state.dealer`
  let dealer: Seat = dealerInput ?? prev.dealer;
  if (dealerInput === undefined && openingRolls.fullRoll) {
    let bestSum = -1;
    let bestSeat: Seat = prev.dealer;
    for (const s of SEATS) {
      const pair = openingRolls.dice[s];
      if (!pair) continue;
      const sum = pair[0] + pair[1];
      if (sum > bestSum) {
        bestSum = sum;
        bestSeat = s;
      }
    }
    dealer = bestSeat;
  }
  const wall = shuffle(buildWall(), seed);
  // Last 14 tiles are the dead wall (gang replacements).
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
    openingRolls,
  };
  return {
    state,
    events: [
      { t: 'handStarted', seed },
      { t: 'opened', rolls: openingRolls },
    ],
  };
}

/** Salt offset for the break-position roll, kept clear of seat-indexed salts (0..3). */
const BREAK_ROLL_SALT = 0xb1ea7;

function computeOpeningRolls(prev: GameState, seed: number): OpeningRolls {
  const fullRoll = !prev.lastResult || prev.lastResult.kind === 'draw';
  const dice: Partial<Record<Seat, DiePair>> = {};
  if (fullRoll) {
    for (const s of SEATS) dice[s] = rollDice(seed, s);
  } else if (prev.lastResult?.kind === 'win') {
    dice[prev.lastResult.winner] = rollDice(seed, prev.lastResult.winner);
  }
  const breakRoll = rollDice(seed, BREAK_ROLL_SALT);
  return { dice, breakPosition: breakRoll[0] + breakRoll[1], fullRoll };
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
  const discardOrder = [...state.discardOrder, { tile, from: seat }];

  const now = Date.now();
  const { deadlineMs, softExpiryMs, hardDeadlineMs } = computeClaimDeadlines(state.rules, now);

  // Pre-pass non-discarder seats that have no meaningful claim against
  // this tile. The hand resolves the moment every "interesting" seat
  // weighs in (often 0–1 humans in practice — bots react synchronously
  // and most discards aren't claimable by anyone).
  const stateAfterDiscard: GameState = {
    ...state,
    phase: 'awaitingClaims',
    hands,
    discards,
    discardOrder,
    hasDrawn: false,
    lastDiscard: { tile, from: seat },
    // A discard breaks any in-flight gang-replacement chain, so the
    // 槓上開花 / 槓上槓 scoring conditions are no longer satisfied
    // for whoever's turn comes next.
    gangReplacementCount: 0,
  };
  const submitted: Partial<Record<Seat, Claim>> = {};
  for (const s of SEATS) {
    if (s === seat) continue;
    if (!hasMeaningfulClaim(stateAfterDiscard, s, tile)) {
      submitted[s] = { kind: 'pass' };
    }
  }

  const pendingClaims: ClaimRound = {
    discard: { tile, from: seat },
    deadlineMs,
    submitted,
    ...(softExpiryMs !== undefined ? { softExpiryMs } : {}),
    ...(hardDeadlineMs !== undefined ? { hardDeadlineMs } : {}),
  };
  const baseState: GameState = {
    ...stateAfterDiscard,
    pendingClaims,
  };
  const events: Event[] = [
    { t: 'discarded', seat, tile },
    { t: 'claimsOpened', deadlineMs },
  ];
  // Solo case: when no fairness gate is set AND every non-discarder
  // seat was pre-passed, fold the resolution into this same reduce.
  // (Multiplayer keeps the soft floor — even an all-pre-passed window
  // pauses for `claimWindowMs` so the table doesn't visually flicker
  // through claims.)
  const allIn = SEATS.every((s) => s === seat || submitted[s]);
  const noFairnessGate = hardDeadlineMs === undefined;
  if (allIn && noFairnessGate) {
    const resolved = resolveAndApply(baseState, now);
    return { state: resolved.state, events: [...events, ...resolved.events] };
  }
  return { state: baseState, events };
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
  // Validate the claim shape against the seat's legal options. `pass`
  // is always legal; `hu` skips the kind check because
  // `legalClaimsFor` deliberately omits it (depends on shanten +
  // scoring), and the downstream `resolveAndApply` path runs
  // `canFinalizeHu` to enforce shape + faan together. For
  // `chi` / `peng` / `gang` we reject claims that the seat couldn't
  // actually make — chi from anyone other than the next seat after
  // the discarder, peng/gang without enough copies in hand, etc.
  // Pre-fix `resolveClaims` silently filtered invalid chi (the
  // resolution returned `kind: 'pass'` instead of throwing), which
  // hid client-side bugs and gave a malicious or buggy client no
  // feedback that its action wasn't honoured.
  if (claim.kind !== 'pass' && claim.kind !== 'hu') {
    const legal = legalClaimsFor(state, seat);
    if (!legal.includes(claim.kind)) {
      throw new IllegalActionError('CLAIM', `${claim.kind} is not legal for seat ${seat}`);
    }
  }
  const submitted = { ...state.pendingClaims.submitted, [seat]: claim };
  const newState: GameState = {
    ...state,
    pendingClaims: { ...state.pendingClaims, submitted },
  };
  // Auto-resolve when every non-discarder seat is in `submitted` and
  // either the soft floor has passed or the rules opt out of one
  // (solo: `hardDeadlineMs === undefined` ⇒ no minimum wait, since
  // there are no other humans to be fair to).
  const discardFrom = state.pendingClaims.discard.from;
  const allIn = SEATS.every((s) => s === discardFrom || submitted[s]);
  const now = Date.now();
  const pastSoftFloor = now >= state.pendingClaims.deadlineMs;
  const noFairnessGate = state.pendingClaims.hardDeadlineMs === undefined;
  if (allIn && (pastSoftFloor || noFairnessGate)) {
    return resolveAndApply(newState, now);
  }
  return { state: newState, events: [] };
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
  // Demote any hu submission that wouldn't actually finalize as a
  // win — typically a structurally-winning hand that scores below the
  // configured `faanMin` floor. Without this guard a low-faan hu would
  // win priority over a valid peng/gang/chi on the same discard, and
  // then the chained declareWin below would throw FAAN and leave the
  // caller with a half-applied state. The bot's `pickClaim` and the
  // ClaimBar's Win button both use `isWinning` (shape only) for
  // legality, so demotion is also a defence-in-depth for any client
  // that doesn't pre-score the hand.
  for (const seat of SEATS) {
    const c = filled[seat];
    if (c?.kind !== 'hu') continue;
    if (!canFinalizeHu(state, seat)) {
      filled[seat] = { kind: 'pass' };
    }
  }
  const resolution = resolveClaims({ ...state.pendingClaims, submitted: filled });
  const events: Event[] = [{ t: 'claimsResolved', result: resolution }];
  void nowMs;

  // Promoted-gang rob window — special handling. Either nobody robs
  // (gang finalizes as if no window had opened) or a robber wins the
  // hand off the promotion tile (+1 fan for 搶槓).
  if (state.pendingPromotedGang) {
    const gang = state.pendingPromotedGang;
    if (resolution.kind === 'pass') {
      // Nobody could / nobody did rob — finalize the gang.
      const finalized = finalizePromotion(state, gang.seat, gang.tile, gang.meldIdx);
      return {
        state: finalized,
        events: [...events, { t: 'gangDeclared', seat: gang.seat, kind: 'promoted' }],
      };
    }
    // resolution.kind === 'win'. The only legal claim during a rob
    // window is `hu` (legalClaimsFor restricts non-pass to hu). The
    // promotion tile is "robbed" out of the gang seat's hand and
    // becomes the winning tile; the peng stays a peng (the gang
    // never completed). `pendingPromotedGang` stays set on the
    // state so `declareWin` can detect the rob and add 搶槓 to the
    // breakdown.
    const robbedHand = removeFirstFace(state.hands[gang.seat], gang.tile);
    const stateAfterRob: GameState = {
      ...state,
      phase: 'turn',
      hands: { ...state.hands, [gang.seat]: robbedHand },
      pendingClaims: undefined,
      turn: resolution.seat,
      hasDrawn: false,
    };
    const finalized = declareWin(stateAfterRob, resolution.seat, false);
    return { state: finalized.state, events: [...events, ...finalized.events] };
  }

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
  // Claim wins. For hu, finalize the win in this same step — the
  // engine used to leave the state at phase: 'turn' with the winner as
  // the new turn-holder and rely on "the caller" issuing declareWin
  // next, but no caller (UI, server, solo transport, or bot driver)
  // ever did so. Result: clicking the ClaimBar's Win button on an
  // opponent's discard appeared to do nothing — the engine accepted
  // the hu claim, transitioned phase, and then sat there waiting for a
  // declareWin that never came. Chaining declareWin here closes the
  // gap and matches the existing chi/peng/gang path which already
  // returns a fully-applied state. The pre-filter above ensures
  // declareWin won't throw FAAN/SHAPE on the chained call.
  const stateAfterClaim = applyClaim(state, resolution);
  if (resolution.claim.kind === 'hu') {
    const finalized = declareWin(stateAfterClaim, resolution.seat, false);
    return { state: finalized.state, events: [...events, ...finalized.events] };
  }
  return { state: stateAfterClaim, events };
}

/** Whether a hu submission for `seat` would actually finalize as a
 *  scored win. Mirrors the checks in `declareWin(state, seat, false)`
 *  by trying it and catching the typed error — keeps the validation
 *  rules in exactly one place. */
function canFinalizeHu(state: GameState, seat: Seat): boolean {
  try {
    declareWin(state, seat, false);
    return true;
  } catch (e) {
    if (e instanceof IllegalActionError) return false;
    throw e;
  }
}

function declareGangConcealed(
  state: GameState,
  seat: Seat,
  tile: Tile,
): { state: GameState; events: Event[] } {
  if (state.phase !== 'turn') throw new IllegalActionError('PHASE', 'wrong phase for gang');
  if (state.turn !== seat) throw new IllegalActionError('SEAT', 'not your turn');
  const matching = state.hands[seat].filter((t) => sameFace(t, tile));
  if (matching.length < 4) throw new IllegalActionError('TILE', 'not 4 in hand');
  const newHand = state.hands[seat].filter((t) => !sameFace(t, tile));
  const meld: Meld = { kind: 'gang-concealed', tiles: matching };
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
      gangReplacementCount: state.gangReplacementCount + 1,
    },
    events: [{ t: 'gangDeclared', seat, kind: 'concealed' }],
  };
}

function declareGangPromoted(
  state: GameState,
  seat: Seat,
  tile: Tile,
): { state: GameState; events: Event[] } {
  if (state.phase !== 'turn') throw new IllegalActionError('PHASE', 'wrong phase for gang');
  if (state.turn !== seat) throw new IllegalActionError('SEAT', 'not your turn');
  const meldIdx = state.melds[seat].findIndex(
    (m) => m.kind === 'peng' && m.tiles.some((t) => sameFace(t, tile)),
  );
  if (meldIdx < 0) throw new IllegalActionError('MELD', 'no matching peng to promote');
  if (!state.hands[seat].some((t) => sameFace(t, tile))) {
    throw new IllegalActionError('TILE', 'no matching tile in hand');
  }

  // 搶槓 (Robbing the Kong): any non-gang seat whose concealed hand
  // is one tile from a winning shape — and that tile happens to be
  // the one being promoted — gets a window to declare hu before the
  // gang completes. We open a claim window only if at least one
  // opponent could rob; otherwise we skip the window entirely so
  // multiplayer doesn't add a needless 3s pause to the gang.
  const allowSpecial = state.rules.allowSevenPairs || state.rules.allowThirteenOrphans;
  const robbers: Seat[] = [];
  for (const s of SEATS) {
    if (s === seat) continue;
    if (
      isWinning({
        hand: [...state.hands[s], tile],
        exposedMelds: state.melds[s].length,
        allowSpecial,
      })
    ) {
      robbers.push(s);
    }
  }

  if (robbers.length === 0) {
    return {
      state: finalizePromotion(state, seat, tile, meldIdx),
      events: [{ t: 'gangDeclared', seat, kind: 'promoted' }],
    };
  }

  // Open the rob window. The promotion tile stays in the seat's
  // hand (we'll either pop it on a successful rob, or move it into
  // the meld on all-pass). Pre-pass every seat that *can't* rob so
  // the window auto-resolves the moment the eligible robbers weigh
  // in.
  const now = Date.now();
  const { deadlineMs, softExpiryMs, hardDeadlineMs } = computeClaimDeadlines(state.rules, now);
  const submitted: Partial<Record<Seat, Claim>> = {};
  for (const s of SEATS) {
    if (s === seat) continue;
    if (!robbers.includes(s)) submitted[s] = { kind: 'pass' };
  }
  const pendingClaims: ClaimRound = {
    discard: { tile, from: seat },
    deadlineMs,
    submitted,
    ...(softExpiryMs !== undefined ? { softExpiryMs } : {}),
    ...(hardDeadlineMs !== undefined ? { hardDeadlineMs } : {}),
  };
  const baseState: GameState = {
    ...state,
    phase: 'awaitingClaims',
    lastDiscard: { tile, from: seat },
    pendingClaims,
    pendingPromotedGang: { seat, tile, meldIdx },
  };
  const events: Event[] = [{ t: 'claimsOpened', deadlineMs }];

  // Solo: when no fairness gate is set AND every non-gang seat was
  // pre-passed (= no robbers, but we already short-circuited above
  // so this only fires when robbers exist *and* the rules opt out
  // of the soft floor — robbers must still submit). Mirrors the
  // discard reducer's auto-resolve fast path.
  const allIn = SEATS.every((s) => s === seat || submitted[s]);
  const noFairnessGate = hardDeadlineMs === undefined;
  if (allIn && noFairnessGate) {
    const resolved = resolveAndApply(baseState, now);
    return { state: resolved.state, events: [...events, ...resolved.events] };
  }
  return { state: baseState, events };
}

/**
 * Compute the three deadline timestamps for a claim window starting
 * at `now`. Used both by the discard reducer's claim window and the
 * promoted-gang rob window — the deadline shape is identical (one
 * soft floor + optional soft expiry + optional hard fallback) so the
 * two reducers share this helper instead of duplicating the offsets.
 */
function computeClaimDeadlines(
  rules: RuleConfig,
  now: number,
): { deadlineMs: number; softExpiryMs?: number; hardDeadlineMs?: number } {
  return {
    deadlineMs: now + rules.claimWindowMs,
    ...(rules.claimSoftWindowMs !== undefined
      ? { softExpiryMs: now + rules.claimSoftWindowMs }
      : {}),
    ...(rules.claimHardWindowMs !== undefined
      ? { hardDeadlineMs: now + rules.claimHardWindowMs }
      : {}),
  };
}

/** Finalize a promoted gang: move the tile from hand to meld, draw a
 *  replacement from the dead wall, bump the gang-replacement counter.
 *  Used both by the no-robbers fast path in `declareGangPromoted` and
 *  by the all-pass branch in `resolveAndApply` once the rob window
 *  closes. */
function finalizePromotion(state: GameState, seat: Seat, tile: Tile, meldIdx: number): GameState {
  const newHand = [...state.hands[seat]];
  const handIdx = newHand.findIndex((t) => sameFace(t, tile));
  if (handIdx < 0) throw new IllegalActionError('TILE', 'no matching tile in hand');
  const promoted = newHand.splice(handIdx, 1)[0]!;
  const oldMeld = state.melds[seat][meldIdx]!;
  const newMeld: Meld = {
    kind: 'gang-promoted',
    tiles: [...oldMeld.tiles, promoted],
    ...(oldMeld.from !== undefined ? { from: oldMeld.from } : {}),
  };
  const newMelds = state.melds[seat].slice();
  newMelds[meldIdx] = newMeld;
  const deadWall = [...state.deadWall];
  const replacement = deadWall.shift();
  if (replacement) newHand.push(replacement);
  return {
    ...state,
    phase: 'turn',
    turn: seat,
    hasDrawn: true,
    hands: { ...state.hands, [seat]: newHand },
    melds: { ...state.melds, [seat]: newMelds },
    deadWall,
    gangReplacementCount: state.gangReplacementCount + 1,
    pendingClaims: undefined,
    pendingPromotedGang: undefined,
    lastDiscard: undefined,
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

  // 搶槓 (Robbing the Kong): when `pendingPromotedGang` is still set
  // by the time we reach declareWin, the win came off a robbed
  // promotion tile (resolveAndApply leaves the field intact for this
  // exact detection). Self-draw can't be a rob — the gang seat
  // can't claim against their own promotion — so we gate on `!selfDraw`.
  const robbingKong = !selfDraw && state.pendingPromotedGang !== undefined;
  const score = scoreHand({ state, winner: seat, winningTile, selfDraw, robbingKong });
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
      pendingPromotedGang: undefined,
      lastResult: {
        kind: 'win',
        winner: seat,
        from: fromSeat,
        tile: winningTile,
        selfDraw,
        faan: score.faan,
        breakdown: score.breakdown,
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
        breakdown: score.breakdown,
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
