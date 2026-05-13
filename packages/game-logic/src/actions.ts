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
import { DEFAULT_RULES, SEATS, computeTurnDeadline, emptyState, nextSeat } from './state.js';
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
 * Per-action dispatcher: takes a state and an action, returns a new
 * state plus a list of events to broadcast. Throws IllegalActionError on
 * invalid input — the server catches and emits a typed error response.
 *
 * The public engine entry point is the XState-backed `reduce` in
 * `./reduce.ts`. This stays as the canonical source of per-action
 * logic; the machine's `assign` actions in `./machine.ts` call into the
 * individual helpers below, and `reduce.ts`'s parity test compares the
 * XState path against `applyAction` (the alias that points here) on
 * random sequences to guard against drift.
 *
 * The trickiest action here is `declareClaim` and the `awaitingClaims`
 * window it feeds into; for an end-to-end map of the discard / pre-pass /
 * declareClaim / canFinalizeHu / resolveClaims / applyClaim / declareWin
 * chain, see `docs/CLAIM_FLOW.md` in the repo root.
 */
function legacyReduce(state: GameState, action: Action): { state: GameState; events: Event[] } {
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

/** Anchor name for the per-action dispatcher above. The XState-backed
 *  `reduce()` in `./reduce.ts` is the user-facing wrapper; this alias is
 *  what the parity test compares against to guard against drift between
 *  the two entry points. */
export const applyAction = legacyReduce;

export function setRules(
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

export function startHand(
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
    drewThisTurn: true,
    phase: 'turn',
    wall,
    deadWall,
    hands,
    scoreboard: prev.scoreboard,
    prevailingWind: prev.prevailingWind,
    openingRolls,
    turnDeadlineMs: computeTurnDeadline(prev.rules),
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

export function drawTile(state: GameState, seat: Seat): { state: GameState; events: Event[] } {
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
    state: { ...state, wall, hands, hasDrawn: true, drewThisTurn: true },
    events: [{ t: 'drew', seat, tile }],
  };
}

export function discard(
  state: GameState,
  seat: Seat,
  tile: Tile,
): { state: GameState; events: Event[] } {
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
    drewThisTurn: false,
    lastDiscard: { tile, from: seat },
    // A discard breaks any in-flight gang-replacement chain, so the
    // 槓上開花 / 槓上槓 scoring conditions are no longer satisfied
    // for whoever's turn comes next.
    gangReplacementCount: 0,
    // Phase leaves `turn` — drop the now-stale turn deadline. The
    // next phase=turn entry (claim resolution, gang-replacement
    // finalize, etc.) re-arms it.
    turnDeadlineMs: undefined,
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
  // When every non-discarder seat was pre-passed (= literally nobody
  // has a meaningful claim against this tile), fold the resolution
  // into this same reduce regardless of whether a fairness gate is
  // armed. The soft floor exists to give *humans with options* time
  // to think; an all-pre-passed window has no human option to wait
  // on, so the 3s pause is pure dead air. Solo never armed the gate
  // in the first place; multiplayer used to wait the floor here on
  // the theory that the felt would otherwise "flicker through" the
  // claim UI — but the claim UI never renders when every seat has
  // already auto-passed, so there's nothing to flicker through.
  const allIn = SEATS.every((s) => s === seat || submitted[s]);
  if (allIn) {
    const resolved = resolveAndApply(baseState, now);
    return { state: resolved.state, events: [...events, ...resolved.events] };
  }
  return { state: baseState, events };
}

export function declareClaim(
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
  // Auto-resolve the moment every non-discarder seat is in
  // `submitted`. The soft floor existed to give humans with options
  // time to react, but `allIn` already proves every seat (human and
  // bot) has weighed in — there's nothing left for the floor to
  // protect, so resolve right now instead of parking the table at
  // `phase: 'awaitingClaims'` for `claimWindowMs` of dead air. (The
  // floor still gates the *alarm* path in `MatchSession.fireAlarm`,
  // which is where it matters: a human who hasn't clicked yet
  // shouldn't be auto-passed before the soft floor.)
  const discardFrom = state.pendingClaims.discard.from;
  const allIn = SEATS.every((s) => s === discardFrom || submitted[s]);
  const now = Date.now();
  if (allIn) {
    return resolveAndApply(newState, now);
  }
  return { state: newState, events: [] };
}

export function resolveAndApply(
  state: GameState,
  nowMs: number,
): { state: GameState; events: Event[] } {
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
      drewThisTurn: false,
      // declareWin chains immediately and clears phase to 'resolved',
      // so this deadline is transient — set it anyway so the field
      // stays consistent for any caller that observes the
      // intermediate state.
      turnDeadlineMs: computeTurnDeadline(state.rules, nowMs),
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
        drewThisTurn: false,
        turnDeadlineMs: computeTurnDeadline(state.rules, nowMs),
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

export function declareGangConcealed(
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
      // Concealed gang only fires on the seat's own turn after a real
      // draw (`PHASE` guard above), so `hasDrawn` is already true. The
      // replacement draw from the dead wall keeps `drewThisTurn` true
      // — the gang-replacement tile is the new "self-drawn" tile for
      // any subsequent tsumo, scored under 槓上開花.
      drewThisTurn: true,
      gangReplacementCount: state.gangReplacementCount + 1,
    },
    events: [{ t: 'gangDeclared', seat, kind: 'concealed' }],
  };
}

export function declareGangPromoted(
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

  // Mirror the `discard` reducer's auto-resolve fast path. The
  // `robbers.length === 0` early-return above already covers the
  // "nobody could rob" case, so in practice this branch only fires
  // if some future rules tweak pre-passes every robber up front;
  // keep the symmetry with the discard reducer so the two stay
  // aligned if the pre-pass shape changes.
  const allIn = SEATS.every((s) => s === seat || submitted[s]);
  if (allIn) {
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
    // Promoted gang pulls a replacement from the dead wall, so the
    // seat is back in "just drew" state for any subsequent tsumo
    // (scored under 槓上開花).
    drewThisTurn: true,
    hands: { ...state.hands, [seat]: newHand },
    melds: { ...state.melds, [seat]: newMelds },
    deadWall,
    gangReplacementCount: state.gangReplacementCount + 1,
    pendingClaims: undefined,
    pendingPromotedGang: undefined,
    lastDiscard: undefined,
    turnDeadlineMs: computeTurnDeadline(state.rules),
  };
}

export function declareWin(
  state: GameState,
  seat: Seat,
  selfDraw: boolean,
): { state: GameState; events: Event[] } {
  let winningTile: Tile;
  if (selfDraw) {
    if (state.phase !== 'turn' || state.turn !== seat || !state.hasDrawn) {
      throw new IllegalActionError('PHASE', 'self-draw win needs turn+drawn');
    }
    // Block tsumo when `hasDrawn` was set by a chi/peng claim rather
    // than a wall draw. Otherwise the user can pass on a low-faan hu,
    // chi/peng the same tile, and re-declare the resulting shape as a
    // self-draw — picking up the 自摸 +1 faan bonus on a win that
    // wasn't actually self-drawn. Gang replacements DO count as draws
    // (see `declareGangConcealed` / `finalizePromotion` / the gang-
    // exposed branch in `applyClaim`).
    if (!state.drewThisTurn) {
      throw new IllegalActionError('STATE', 'self-draw win requires a real draw, not a claim');
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
  // Move the winning tile into the winner's concealed hand so the
  // resolved-phase view shows the full 14-tile shape rather than the
  // 13-tile pre-win one. Self-draw already has the tile in hand
  // (it was the last drawn tile); ron / 搶槓 need the explicit push.
  // For ron we also pop the tile back off the discarder's pile —
  // mirrors `applyClaim`'s pop on chi/peng/gang and keeps
  // `assertTileConservation` happy.
  const wasRobbed = state.pendingPromotedGang !== undefined;
  let winnerHand = state.hands[seat];
  let newDiscards = state.discards;
  let newDiscardOrder = state.discardOrder;
  if (!selfDraw) {
    winnerHand = [...winnerHand, winningTile];
    if (!wasRobbed) {
      // Pop the just-claimed tile back off the discarder's pile (it
      // now lives in the winner's hand instead). For 搶槓 the tile
      // never went into a discard pile in the first place — it was
      // robbed straight out of the gang seat's hand by resolveAndApply.
      const fromPile = [...state.discards[fromSeat]];
      spliceLastMatch(fromPile, (t) => sameFace(t, winningTile));
      newDiscards = { ...state.discards, [fromSeat]: fromPile };
      const orderCopy = [...state.discardOrder];
      spliceLastMatch(orderCopy, (e) => e.from === fromSeat && sameFace(e.tile, winningTile));
      newDiscardOrder = orderCopy;
    }
  }
  return {
    state: {
      ...state,
      phase: 'resolved',
      pendingPromotedGang: undefined,
      hands: { ...state.hands, [seat]: winnerHand },
      discards: newDiscards,
      discardOrder: newDiscardOrder,
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

/** Remove the last element matching `pred` in-place. No-op if no match. */
function spliceLastMatch<T>(arr: T[], pred: (t: T) => boolean): void {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i]!)) {
      arr.splice(i, 1);
      return;
    }
  }
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
