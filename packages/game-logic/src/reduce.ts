import { initialTransition, transition } from 'xstate';
import type { Action, Event } from './actions.js';
import { machineEventFor, mahjongMachine } from './machine.js';
import type { GameState } from './state.js';

/**
 * Public engine entry point. Drives the XState machine in `./machine.ts`
 * via XState v5's stateless `transition()` function so the engine stays
 * a pure reducer (no actor lifecycle, no scheduled events, no
 * subscriptions) and `{state, events}` keep the legacy reducer's
 * synchronous shape.
 *
 * `initialTransition(machine, input)` produces the first snapshot,
 * which `always` rules immediately settle on whichever node matches
 * `state.phase`. The dispatch event is then transitioned in a single
 * `transition(machine, snapshot, event)` call. Errors thrown inside
 * `assign` actions land on `next.error` with `next.status === 'error'`
 * and are re-thrown to preserve the legacy reducer's behaviour.
 *
 * Wire payload `Action` keeps its `t:` discriminator; we rebadge to
 * XState's `type:` at this boundary via `machineEventFor`.
 */
export function reduce(state: GameState, action: Action): { state: GameState; events: Event[] } {
  const [initial] = initialTransition(mahjongMachine, { state });
  const [next] = transition(mahjongMachine, initial, machineEventFor(action));
  if (next.status === 'error' && next.error) {
    throw next.error;
  }
  return {
    state: next.context.state,
    events: next.context.pendingEvents,
  };
}
