import { assign, setup } from 'xstate';
import { type Action, type Event, applyAction } from './actions.js';
import type { GameState, Phase } from './state.js';

/**
 * XState machine view of the engine. The machine is the canonical state
 * graph for visualisation + transition legality checks; the existing
 * per-action helper functions in `./actions.ts` (dispatched via
 * `applyAction`) still own the actual GameState mutation logic during
 * the migration. The two sides are reconciled by the `always` rules on
 * each state node, which re-route the machine value to whichever phase
 * the helper landed on (auto-resolve fast paths, chained `declareWin`,
 * wall-empty draws).
 *
 * `Action` (the wire payload) uses `t:` as its discriminator; XState
 * needs `type:`. The wrapper in `./reduce.ts` rebadges actions to
 * MachineEvent at the boundary so the wire format stays unchanged.
 *
 * Built with `setup()` (the canonical XState v5 pattern from
 * https://stately.ai/docs/machines) so the typed `actions` + `guards`
 * are bound at definition time. Driven via the stateless `transition()`
 * function in `./reduce.ts` rather than a long-lived actor — the engine
 * is a pure reducer and we don't need actor-level features (interpreter
 * lifecycle, subscriptions, scheduled events).
 */
interface MachineContext {
  state: GameState;
  pendingEvents: Event[];
}

type MachineEvent =
  | { type: 'startHand'; seed: number; dealer?: GameState['dealer'] }
  | { type: 'setRules'; rules: GameState['rules'] | Partial<GameState['rules']> }
  | { type: 'draw'; seat: GameState['turn'] }
  | { type: 'discard'; seat: GameState['turn']; tile: GameState['wall'][number] }
  | {
      type: 'declareClaim';
      seat: GameState['turn'];
      claim: NonNullable<GameState['pendingClaims']>['submitted'][GameState['turn']];
    }
  | { type: 'resolveClaims'; nowMs: number }
  | { type: 'declareGangConcealed'; seat: GameState['turn']; tile: GameState['wall'][number] }
  | { type: 'declareGangPromoted'; seat: GameState['turn']; tile: GameState['wall'][number] }
  | { type: 'declareWin'; seat: GameState['turn']; selfDraw: boolean };

/** Convert a MachineEvent back into an `Action` so the existing helpers
 *  (which switch on `t:`) can run unmodified. The two shapes carry the
 *  same payload; only the discriminator key differs. */
function eventToAction(event: MachineEvent): Action {
  const { type, ...rest } = event;
  return { t: type, ...rest } as Action;
}

/** State-node names mirror `Phase` minus the unused `dealing` value.
 *  Each node carries an `always` rule set that re-routes the machine
 *  value to whatever phase the helper landed on — necessary because
 *  `discard()` can auto-resolve to `turn` in solo, and `declareClaim`
 *  with a hu can chain straight to `resolved` via `resolveAndApply`. */
type MachineState = Exclude<Phase, 'dealing'>;

export const mahjongMachine = setup({
  types: {
    context: {} as MachineContext,
    events: {} as MachineEvent,
    input: {} as { state: GameState },
  },
  actions: {
    dispatch: assign(({ context, event }) => {
      const { state, events } = applyAction(context.state, eventToAction(event));
      return { state, pendingEvents: [...context.pendingEvents, ...events] };
    }),
  },
  guards: {
    isWaiting: ({ context }) => context.state.phase === 'waiting',
    isTurn: ({ context }) => context.state.phase === 'turn',
    isAwaitingClaims: ({ context }) => context.state.phase === 'awaitingClaims',
    isResolved: ({ context }) => context.state.phase === 'resolved',
  },
}).createMachine({
  id: 'mahjong',
  initial: 'waiting',
  context: ({ input }) => ({ state: input.state, pendingEvents: [] }),
  // Root-level event handling: every action goes through `dispatch`,
  // which delegates to the matching helper in `./actions.ts`. The
  // helper enforces phase legality and throws `IllegalActionError` for
  // illegal action × phase combinations — `./reduce.ts` re-throws from
  // the resulting error snapshot.
  //
  // We force re-entry on the destination state (`reenter: true`) so
  // the per-state `always` rules re-evaluate after every dispatch and
  // route the machine value to whichever phase the helper landed on
  // (handles auto-resolve fast paths + chained `declareWin` cases).
  on: {
    setRules: { actions: 'dispatch', target: '.waiting', reenter: true },
    startHand: { actions: 'dispatch', target: '.turn', reenter: true },
    draw: { actions: 'dispatch', target: '.turn', reenter: true },
    discard: { actions: 'dispatch', target: '.awaitingClaims', reenter: true },
    declareClaim: { actions: 'dispatch', target: '.awaitingClaims', reenter: true },
    resolveClaims: { actions: 'dispatch', target: '.awaitingClaims', reenter: true },
    declareGangConcealed: { actions: 'dispatch', target: '.turn', reenter: true },
    declareGangPromoted: { actions: 'dispatch', target: '.awaitingClaims', reenter: true },
    declareWin: { actions: 'dispatch', target: '.resolved', reenter: true },
  },
  states: {
    waiting: {
      always: [
        { guard: 'isTurn', target: 'turn' },
        { guard: 'isAwaitingClaims', target: 'awaitingClaims' },
        { guard: 'isResolved', target: 'resolved' },
      ],
    },
    turn: {
      always: [
        { guard: 'isWaiting', target: 'waiting' },
        { guard: 'isAwaitingClaims', target: 'awaitingClaims' },
        { guard: 'isResolved', target: 'resolved' },
      ],
    },
    awaitingClaims: {
      always: [
        { guard: 'isWaiting', target: 'waiting' },
        { guard: 'isTurn', target: 'turn' },
        { guard: 'isResolved', target: 'resolved' },
      ],
    },
    resolved: {
      always: [
        { guard: 'isWaiting', target: 'waiting' },
        { guard: 'isTurn', target: 'turn' },
        { guard: 'isAwaitingClaims', target: 'awaitingClaims' },
      ],
    },
  },
});

void ({} as MachineState); // keep the type alive for documentation; not used at runtime

export function machineEventFor(action: Action): MachineEvent {
  const { t, ...rest } = action;
  return { type: t, ...rest } as MachineEvent;
}
