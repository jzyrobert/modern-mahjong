import { assign, setup } from 'xstate';
import {
  type Action,
  type Event,
  declareClaim,
  declareGangConcealed,
  declareGangPromoted,
  declareWin,
  discard,
  drawTile,
  resolveAndApply,
  setRules,
  startHand,
} from './actions.js';
import type { GameState } from './state.js';

/**
 * XState v5 machine for the engine. Built with the canonical
 * `setup({...}).createMachine(...)` pattern; driven via the stateless
 * `transition()` function in `./reduce.ts`.
 *
 * Each event has its own `assign` action that calls the matching helper
 * in `./actions.ts`. Per-state `always` rules re-route the machine value
 * to whatever phase the helper landed on (e.g. `discard()` may
 * auto-resolve to `turn` in solo, and `declareClaim` with a hu chains
 * straight to `resolved` via `resolveAndApply`).
 *
 * `awaitingClaims` is a compound state with two children — `normal`
 * (chi/peng/gang/hu/pass) and `robWindow` (hu/pass only, 搶槓) —
 * picked by `pendingPromotedGang` on context.
 */

interface MachineContext {
  state: GameState;
  pendingEvents: Event[];
}

/** Mirror of `Action` with `t:` rebadged as XState's `type:`. Derived
 *  via mapped type so the two unions can't drift; the wire payload
 *  keeps `t:` (unchanged), the machine sees `type:`. */
type MachineEvent = {
  [A in Action as A['t']]: Omit<A, 't'> & { type: A['t'] };
}[Action['t']];

type EventOf<K extends MachineEvent['type']> = Extract<MachineEvent, { type: K }>;

/** Body shared by every per-event `assign` below. Runs the matching
 *  helper, narrows `event` to its `EventOf<K>` shape via the cast, and
 *  returns the new context. `pendingEvents` is a per-call accumulator
 *  drained by `./reduce.ts` — always `[]` on entry, so the helper's
 *  events become the events list directly with no spread. */
function applyOn<K extends MachineEvent['type']>(
  context: MachineContext,
  event: MachineEvent,
  fn: (state: GameState, event: EventOf<K>) => { state: GameState; events: Event[] },
): MachineContext {
  const r = fn(context.state, event as EventOf<K>);
  return { state: r.state, pendingEvents: r.events };
}

const PHASE_ROUTES = {
  waiting: {
    guard: ({ context }: { context: MachineContext }) => context.state.phase === 'waiting',
    target: 'waiting',
  },
  turn: {
    guard: ({ context }: { context: MachineContext }) => context.state.phase === 'turn',
    target: 'turn',
  },
  awaitingClaims: {
    guard: ({ context }: { context: MachineContext }) => context.state.phase === 'awaitingClaims',
    target: 'awaitingClaims',
  },
  resolved: {
    guard: ({ context }: { context: MachineContext }) => context.state.phase === 'resolved',
    target: 'resolved',
  },
} as const;

export const mahjongMachine = setup({
  types: {
    context: {} as MachineContext,
    events: {} as MachineEvent,
    input: {} as { state: GameState },
  },
  actions: {
    setRules: assign(({ context, event }) =>
      applyOn<'setRules'>(context, event, (s, e) => setRules(s, e.rules)),
    ),
    startHand: assign(({ context, event }) =>
      applyOn<'startHand'>(context, event, (s, e) => startHand(s, e.seed, e.dealer)),
    ),
    draw: assign(({ context, event }) =>
      applyOn<'draw'>(context, event, (s, e) => drawTile(s, e.seat)),
    ),
    discard: assign(({ context, event }) =>
      applyOn<'discard'>(context, event, (s, e) => discard(s, e.seat, e.tile)),
    ),
    declareClaim: assign(({ context, event }) =>
      applyOn<'declareClaim'>(context, event, (s, e) => declareClaim(s, e.seat, e.claim)),
    ),
    resolveClaims: assign(({ context, event }) =>
      applyOn<'resolveClaims'>(context, event, (s, e) => resolveAndApply(s, e.nowMs)),
    ),
    declareGangConcealed: assign(({ context, event }) =>
      applyOn<'declareGangConcealed'>(context, event, (s, e) =>
        declareGangConcealed(s, e.seat, e.tile),
      ),
    ),
    declareGangPromoted: assign(({ context, event }) =>
      applyOn<'declareGangPromoted'>(context, event, (s, e) =>
        declareGangPromoted(s, e.seat, e.tile),
      ),
    ),
    declareWin: assign(({ context, event }) =>
      applyOn<'declareWin'>(context, event, (s, e) => declareWin(s, e.seat, e.selfDraw)),
    ),
  },
}).createMachine({
  id: 'mahjong',
  initial: 'waiting',
  context: ({ input }) => ({ state: input.state, pendingEvents: [] }),
  on: {
    setRules: { actions: 'setRules', target: '.waiting', reenter: true },
    startHand: { actions: 'startHand', target: '.turn', reenter: true },
    draw: { actions: 'draw', target: '.turn', reenter: true },
    discard: { actions: 'discard', target: '.awaitingClaims', reenter: true },
    declareClaim: { actions: 'declareClaim', target: '.awaitingClaims', reenter: true },
    resolveClaims: { actions: 'resolveClaims', target: '.awaitingClaims', reenter: true },
    declareGangConcealed: { actions: 'declareGangConcealed', target: '.turn', reenter: true },
    declareGangPromoted: {
      actions: 'declareGangPromoted',
      target: '.awaitingClaims',
      reenter: true,
    },
    declareWin: { actions: 'declareWin', target: '.resolved', reenter: true },
  },
  states: {
    waiting: {
      always: [PHASE_ROUTES.turn, PHASE_ROUTES.awaitingClaims, PHASE_ROUTES.resolved],
    },
    turn: {
      always: [PHASE_ROUTES.waiting, PHASE_ROUTES.awaitingClaims, PHASE_ROUTES.resolved],
    },
    awaitingClaims: {
      initial: 'normal',
      always: [PHASE_ROUTES.waiting, PHASE_ROUTES.turn, PHASE_ROUTES.resolved],
      states: {
        // Standard claim window — chi / peng / gang / hu / pass.
        normal: {
          always: [
            {
              guard: ({ context }) => context.state.pendingPromotedGang !== undefined,
              target: 'robWindow',
            },
          ],
        },
        // 搶槓: a non-gang seat with a winning shape on the promotion
        // tile may declare hu before the gang completes. `legalClaimsFor`
        // (`./claims.ts`) reads `pendingPromotedGang` to project the
        // hu/pass-only narrowing for consumers without the machine value.
        robWindow: {
          always: [
            {
              guard: ({ context }) => context.state.pendingPromotedGang === undefined,
              target: 'normal',
            },
          ],
        },
      },
    },
    resolved: {
      always: [PHASE_ROUTES.waiting, PHASE_ROUTES.turn, PHASE_ROUTES.awaitingClaims],
    },
  },
});

/** Convert a wire `Action` (`t:`) into a `MachineEvent` (`type:`).
 *  Internal — only `./reduce.ts` uses it. */
export function machineEventFor(action: Action): MachineEvent {
  const { t, ...rest } = action;
  return { type: t, ...rest } as MachineEvent;
}
