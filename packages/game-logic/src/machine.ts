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
import type { Claim, GameState, Phase, RuleConfig, Seat } from './state.js';
import type { Tile } from './tiles.js';

/**
 * XState v5 machine for the engine. Built with the canonical
 * `setup({...}).createMachine(...)` pattern; driven via the stateless
 * `transition()` function in `./reduce.ts` so the engine stays a pure
 * reducer.
 *
 * Each event has its own `assign` action that calls the matching helper
 * in `./actions.ts` — no opaque `dispatch` indirection. The machine
 * diagram is a faithful map of "which event runs which helper".
 *
 * Per-state `always` rules re-route the machine value to whatever phase
 * the helper landed on (e.g. `discard()` may auto-resolve to `turn` in
 * solo, and `declareClaim` with a hu chains straight to `resolved` via
 * `resolveAndApply`). `awaitingClaims` is a parent state with two
 * children — `normal` (chi/peng/gang/hu/pass) and `robWindow` (hu/pass
 * only, 搶槓) — picked by `pendingPromotedGang` on context.
 *
 * `Action` (the wire payload) uses `t:` as its discriminator; XState
 * needs `type:`. The wrapper in `./reduce.ts` rebadges actions to
 * MachineEvent at the boundary so the wire format stays unchanged.
 */
interface MachineContext {
  state: GameState;
  pendingEvents: Event[];
}

type MachineEvent =
  | { type: 'startHand'; seed: number; dealer?: Seat }
  | { type: 'setRules'; rules: Partial<RuleConfig> }
  | { type: 'draw'; seat: Seat }
  | { type: 'discard'; seat: Seat; tile: Tile }
  | { type: 'declareClaim'; seat: Seat; claim: Claim }
  | { type: 'resolveClaims'; nowMs: number }
  | { type: 'declareGangConcealed'; seat: Seat; tile: Tile }
  | { type: 'declareGangPromoted'; seat: Seat; tile: Tile }
  | { type: 'declareWin'; seat: Seat; selfDraw: boolean };

/** State-node names mirror `Phase` minus the unused `dealing` value. */
type MachineState = Exclude<Phase, 'dealing'>;

/** Fold a per-helper `{state, events}` result into the machine context.
 *  All per-event `assign` actions below pass their helper's return
 *  value through this so the bookkeeping (replace state, append events
 *  to `pendingEvents`) stays in one place. */
function fold(
  context: MachineContext,
  result: { state: GameState; events: Event[] },
): MachineContext {
  return { state: result.state, pendingEvents: [...context.pendingEvents, ...result.events] };
}

export const mahjongMachine = setup({
  types: {
    context: {} as MachineContext,
    events: {} as MachineEvent,
    input: {} as { state: GameState },
  },
  actions: {
    setRules: assign(({ context, event }) => {
      const e = event as Extract<MachineEvent, { type: 'setRules' }>;
      return fold(context, setRules(context.state, e.rules));
    }),
    startHand: assign(({ context, event }) => {
      const e = event as Extract<MachineEvent, { type: 'startHand' }>;
      return fold(context, startHand(context.state, e.seed, e.dealer));
    }),
    draw: assign(({ context, event }) => {
      const e = event as Extract<MachineEvent, { type: 'draw' }>;
      return fold(context, drawTile(context.state, e.seat));
    }),
    discard: assign(({ context, event }) => {
      const e = event as Extract<MachineEvent, { type: 'discard' }>;
      return fold(context, discard(context.state, e.seat, e.tile));
    }),
    declareClaim: assign(({ context, event }) => {
      const e = event as Extract<MachineEvent, { type: 'declareClaim' }>;
      return fold(context, declareClaim(context.state, e.seat, e.claim));
    }),
    resolveClaims: assign(({ context, event }) => {
      const e = event as Extract<MachineEvent, { type: 'resolveClaims' }>;
      return fold(context, resolveAndApply(context.state, e.nowMs));
    }),
    declareGangConcealed: assign(({ context, event }) => {
      const e = event as Extract<MachineEvent, { type: 'declareGangConcealed' }>;
      return fold(context, declareGangConcealed(context.state, e.seat, e.tile));
    }),
    declareGangPromoted: assign(({ context, event }) => {
      const e = event as Extract<MachineEvent, { type: 'declareGangPromoted' }>;
      return fold(context, declareGangPromoted(context.state, e.seat, e.tile));
    }),
    declareWin: assign(({ context, event }) => {
      const e = event as Extract<MachineEvent, { type: 'declareWin' }>;
      return fold(context, declareWin(context.state, e.seat, e.selfDraw));
    }),
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
      always: [
        { guard: ({ context }) => context.state.phase === 'turn', target: 'turn' },
        {
          guard: ({ context }) => context.state.phase === 'awaitingClaims',
          target: 'awaitingClaims',
        },
        { guard: ({ context }) => context.state.phase === 'resolved', target: 'resolved' },
      ],
    },
    turn: {
      always: [
        { guard: ({ context }) => context.state.phase === 'waiting', target: 'waiting' },
        {
          guard: ({ context }) => context.state.phase === 'awaitingClaims',
          target: 'awaitingClaims',
        },
        { guard: ({ context }) => context.state.phase === 'resolved', target: 'resolved' },
      ],
    },
    awaitingClaims: {
      initial: 'normal',
      always: [
        { guard: ({ context }) => context.state.phase === 'waiting', target: 'waiting' },
        { guard: ({ context }) => context.state.phase === 'turn', target: 'turn' },
        { guard: ({ context }) => context.state.phase === 'resolved', target: 'resolved' },
      ],
      states: {
        // The standard claim window — chi / peng / gang / hu / pass are
        // all on the table for non-discarder seats.
        normal: {
          always: [
            {
              guard: ({ context }) => context.state.pendingPromotedGang !== undefined,
              target: 'robWindow',
            },
          ],
        },
        // 搶槓 (Robbing the Kong): a non-gang seat with a winning shape
        // on the promotion tile may declare hu before the gang completes.
        // Only `pass` and `hu` are legal here — `legalClaimsFor` still
        // reads `pendingPromotedGang` to project this narrowing for
        // consumers (UI, bots) that don't have access to the machine
        // value.
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
      always: [
        { guard: ({ context }) => context.state.phase === 'waiting', target: 'waiting' },
        { guard: ({ context }) => context.state.phase === 'turn', target: 'turn' },
        {
          guard: ({ context }) => context.state.phase === 'awaitingClaims',
          target: 'awaitingClaims',
        },
      ],
    },
  },
});

void ({} as MachineState); // keep the type alive for documentation; not used at runtime

export function machineEventFor(action: Action): MachineEvent {
  const { t, ...rest } = action;
  return { type: t, ...rest } as MachineEvent;
}
