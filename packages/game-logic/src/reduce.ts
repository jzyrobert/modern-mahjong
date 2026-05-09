import { initialTransition, transition } from 'xstate';
import type { Action, Event } from './actions.js';
import { machineEventFor, mahjongMachine } from './machine.js';
import type { GameState } from './state.js';

/**
 * Public engine entry point. Drives the XState machine via the
 * canonical stateless `initialTransition` + `transition` pair (no
 * actor, no subscriptions). Errors thrown by `assign` actions land on
 * `next.error` and are re-thrown so the legacy reducer's synchronous
 * `IllegalActionError` contract is preserved.
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
