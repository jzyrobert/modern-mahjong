# Claim flow — the engine's state machine for discards and claims

The single most subtle part of the engine is the `awaitingClaims` window:
the period between one seat's discard and the next seat's draw, during which
any non-discarder seat can interrupt with chi / peng / gang / hu. Several
things have to happen in a strict order — pre-pass for seats with nothing
to claim, gather submissions from active seats, demote claims that aren't
actually finalisable, pick a winner by priority, apply the claim, and (for
hu) chain `declareWin` so the hand resolves in the same engine step.

This doc maps that flow end-to-end so the next person reading
`packages/game-logic/src/actions.ts` and `packages/game-logic/src/claims.ts`
doesn't have to reverse-engineer the order from comments alone.

## Phases

```
waiting  →  dealing  →  turn  ⇄  awaitingClaims  →  resolved
                            │                          ↑
                            └─── self-draw win  ───────┘
```

- **`waiting`** — lobby is gathering players; rules can still change.
- **`dealing`** — opening dice rolls (`startHand`); transient, replaced by
  `turn` once tiles are dealt.
- **`turn`** — one seat is the active turn-holder. They `draw` (if
  `!hasDrawn`), then either `declareWin` self-draw, declare a concealed /
  promoted gang, or `discard`.
- **`awaitingClaims`** — entered the moment a `discard` action commits.
  Any non-discarder seat may submit a `declareClaim`. Window resolves
  either when every non-discarder seat is `submitted` AND the soft floor
  has elapsed, or when the hard fallback fires (server alarm in
  multiplayer; `claimHardWindowMs` is unset in solo so the window is
  effectively infinite).
- **`resolved`** — `lastResult` is populated with `kind: 'win' | 'draw'`.
  Between hands the host issues `startHand` to advance.

There is also a second flavour of `awaitingClaims` window, opened by
`declareGangPromoted` instead of `discard`: see "Promoted gang +
搶槓 (Robbing the Kong)" below.

## The claim window in detail

### 1. `discard` opens the window

`actions.ts:discard` does three things atomically:
- Moves the tile from `state.hands[seat]` into `state.discards[seat]` and
  appends it to `state.discardOrder` (chronological, drives the mobile
  shared discard pool).
- Transitions phase to `awaitingClaims` and sets `lastDiscard`.
- **Pre-passes** every seat that has no meaningful claim against the
  discard — see step 2.

### 2. Pre-pass: free wins for "nothing to do" seats

`hasMeaningfulClaim` (in `claims.ts`) returns `true` for a seat iff:
- It has a non-pass entry in `legalClaimsFor` (chi / peng / gang), OR
- It has a structurally-winning hand on this discard (`isWinning` against
  `[...hand, discard]`).

The `discard` reducer pre-fills `pendingClaims.submitted[s] = { kind:
'pass' }` for every seat where this returns `false`. In practice that's
~2–3 of the 3 non-discarder seats on most discards, so the round resolves
the moment the one "interesting" seat (or zero) weighs in.

Solo intentionally strips `claimSoftWindowMs` and `claimHardWindowMs` so
when **every** non-discarder seat is pre-passed, `discard` folds the
resolution into the same reducer call: see the `allIn && noFairnessGate`
branch.

### 3. `declareClaim` — players + bots submit

`actions.ts:declareClaim` validates the claim shape:
- Phase must be `awaitingClaims`.
- The discarder cannot claim their own discard.
- The `kind` must appear in `legalClaimsFor(state, seat)` for `chi` /
  `peng` / `gang`. `hu` skips the kind gate (legality depends on shanten +
  scoring, both checked downstream); `pass` is always allowed.

When validation passes, the claim is recorded in
`pendingClaims.submitted` and the reducer checks the auto-resolve
condition (every non-discarder seat in, soft floor elapsed OR no fairness
gate). If both hold, control falls into `resolveAndApply` immediately;
otherwise the engine waits for either more submissions or an explicit
`{ t: 'resolveClaims' }` action (the server's alarm fires this on
expiry).

### 4. `resolveAndApply` — pick a winner, apply, finalise

This is the engine's most layered function. In order:

1. **Pad missing seats** with `{ kind: 'pass' }` so `resolveClaims` has
   a complete map.
2. **Demote invalid hu** — for every submission `{ kind: 'hu' }`, run
   `canFinalizeHu(state, seat)` (which try/catches `declareWin(state,
   seat, false)`). If it would throw FAAN / SHAPE, the submission is
   rewritten to `{ kind: 'pass' }`. This protects against bots' over-eager
   `pickClaim` and clients that gate the Win button on shape only — the
   alternative is letting the chained `declareWin` below throw and
   leaving the caller with a half-applied state.
3. **`resolveClaims`** picks the priority winner: `hu` > `peng`/`gang` >
   `chi` (next seat only). Multiple `hu` submissions are tie-broken by
   closest counter-clockwise distance from the discarder.
4. Emit one `claimsResolved` event regardless of outcome.
5. **Apply the resolution:**
   - `kind: 'pass'` → advance phase to `turn`, set `turn = nextSeat
     (discarder)`, clear `pendingClaims`, `hasDrawn = false`.
   - `kind: 'win'` with chi / peng / gang → `applyClaim` builds the meld,
     pops the just-claimed tile back off the discarder's pile, hands the
     turn to the claimer, sets `hasDrawn = true` (claimer must discard
     next, no draw needed).
   - `kind: 'win'` with hu → `applyClaim` returns a transient `phase:
     'turn'` state, then `resolveAndApply` immediately chains
     `declareWin(state, seat, false)` to finalise the win in the same
     engine step. The intermediate state is never observed by callers.

The hu-chain is what makes "click Win on opponent discard" actually win.
Pre-#157 the comment in `applyClaim` claimed the *caller* would issue
`declareWin` next, but no caller ever did, so the engine accepted the
hu and silently sat in `phase: 'turn'` waiting forever.

## What runs where

| Step                          | Source                                                |
| ----------------------------- | ----------------------------------------------------- |
| `discard` reducer             | `actions.ts:discard`                                  |
| `hasMeaningfulClaim` pre-pass | `claims.ts:hasMeaningfulClaim`                        |
| `declareClaim` validation     | `actions.ts:declareClaim`                             |
| `legalClaimsFor`              | `claims.ts:legalClaimsFor`                            |
| `canFinalizeHu` demotion      | `actions.ts:canFinalizeHu` (calls `declareWin` & catches) |
| `resolveClaims` priority      | `claims.ts:resolveClaims`                             |
| `applyClaim`                  | `claims.ts:applyClaim`                                |
| `declareWin` (selfDraw=false) | `actions.ts:declareWin`                               |
| `scoreHand` (faan + breakdown)| `scoring.ts:scoreHand`                                |

## Promoted gang + 搶槓 (Robbing the Kong)

When a seat declares `declareGangPromoted` — adding a 4th tile from hand
to an existing exposed peng — the engine doesn't finalise the gang
immediately. Instead it opens a second flavour of `awaitingClaims`
window where **only `hu` is legal** (chi/peng/gang on a tile destined
for someone else's gang is never legal in HK rules).

Mechanically:

- `declareGangPromoted` first scans every non-gang seat for a winning
  shape on the promotion tile (`isWinning(hand + tile)`). If no seat
  qualifies, the window is **skipped** and the gang finalises in one
  step exactly like the pre-搶槓 engine — same single `gangDeclared`
  event, same replacement-draw, same `gangReplacementCount++`.
- If at least one seat *can* rob, the engine sets
  `state.pendingPromotedGang = { seat, tile, meldIdx }`, transitions to
  `phase: 'awaitingClaims'`, and emits `claimsOpened`. `lastDiscard`
  carries the promotion tile + the gang seat as `from`. The promotion
  tile **stays in the gang seat's hand** during the window — neither
  the meld nor the dead wall has been touched yet.
- `legalClaimsFor` returns `['pass']` for non-gang seats during a
  promoted-gang window so `declareClaim` rejects any peng/chi/gang
  attempt. `hu` (left to caller) is still allowed.
- `resolveAndApply` branches on `state.pendingPromotedGang`:
  - **All-pass** → `finalizePromotion` runs (move tile, draw
    replacement, bump count), and a `gangDeclared` event is emitted
    *now* (the gang only completed once the window closed cleanly).
  - **`hu`** → the promotion tile is removed from the gang seat's
    hand (it was robbed), `pendingClaims` is cleared but
    `pendingPromotedGang` is **left set** so the chained
    `declareWin(state, robber, false)` can detect the rob and add
    `搶槓` (+1 fan) to the breakdown. The peng stays a peng — the
    gang never completed. `declareWin` clears
    `pendingPromotedGang` on its way to `phase: 'resolved'`.

`scoreHand` adds `搶槓` (+1 fan) when its `robbingKong` input is true.
The engine drives this off `state.pendingPromotedGang !== undefined &&
!selfDraw` inside `declareWin`, so non-engine callers (tests,
hypothetical replay tools) default to false unless they pass it
explicitly.

Concealed gang (`declareGangConcealed`) is **not** wrapped in a rob
window — only the promoted-from-peng case is robbable in HK rules.

## Solo's quirks (recap)

`apps/client/src/net/solo-transport.ts` patches `DEFAULT_RULES` to remove
`claimSoftWindowMs` and `claimHardWindowMs`. With both unset:

- `noFairnessGate === true`, so the discard reducer can fold-resolve when
  every seat is pre-passed.
- `declareClaim` auto-resolves the moment every non-discarder seat is
  `submitted` (ignores the soft floor since there's no hard fallback to
  protect humans from racing each other).
- The user is functionally given infinite time to claim; bots react
  synchronously, so the round either resolves the moment the user clicks
  pass / claim, or sits open until they do.

This patching is local to the solo transport — the engine itself is
agnostic.

## When things go wrong

- **"My Win button does nothing"** — pre-#157 bug; check `resolveAndApply`
  chains `declareWin` for hu. Or post-fix: hand scores below
  `rules.faanMin`, the demotion path runs, the engine treats it as a
  pass. The ClaimBar's Win button (`apps/client/src/ui/ClaimBar.tsx`)
  pre-scores via `scoreHand` so this case is now hidden upstream — the
  button doesn't appear when the win wouldn't actually finalise.
- **"Bot claimed but the turn didn't advance"** — usually means the
  claim went through but the next seat's `draw` wasn't dispatched. In
  multiplayer this is the server's job (`MatchSession.runBotTurns`); in
  solo it's `solo-transport.ts:runBots`.
- **"Engine threw FAAN / SHAPE on a hu claim"** — should be impossible
  post-#157 thanks to `canFinalizeHu`. If it happens, look for a code
  path that bypasses `declareClaim` and submits a hu directly into
  `pendingClaims.submitted`.
