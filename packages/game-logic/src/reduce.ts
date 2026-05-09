import { createActor } from 'xstate';
import type { Action, Event } from './actions.js';
import { machineEventFor, mahjongMachine, phaseToMachineState } from './machine.js';
import type { GameState } from './state.js';

/**
 * Public engine entry point. Drives the XState machine in `./machine.ts`
 * to apply one action and returns `{state, events}` matching the legacy
 * reducer signature so consumers don't change.
 *
 * Implementation notes:
 *  - The machine is interpreted via `createActor` once per call; XState
 *    v5's stateless `transition()` exists but doesn't run `assign`
 *    actions in a way that surfaces context updates cleanly. Spinning
 *    up a fresh actor + sending one event + reading the snapshot is the
 *    documented pattern for "use a machine as a pure transition function".
 *  - `getInitialSnapshot` produces a snapshot at the machine's initial
 *    state node; we then run the actor's reroute `always` rules to land
 *    on whichever node matches the incoming `state.phase` before
 *    dispatching the actual event.
 *  - The wire payload `Action` keeps its `t:` discriminator; we rebadge
 *    to XState's `type:` at this boundary via `machineEventFor`.
 */
export function reduce(state: GameState, action: Action): { state: GameState; events: Event[] } {
  const actor = createActor(mahjongMachine, { input: { state } });
  let actorError: unknown;
  // XState catches throws inside `assign` and surfaces them on the
  // actor's snapshot as `status: 'error'`. The legacy reducer signature
  // expects a synchronous throw, so subscribe to the error stream and
  // re-throw after the send.
  const sub = actor.subscribe({
    error: (err) => {
      actorError = err;
    },
  });
  actor.start();
  // The machine's `initial: 'waiting'` plus reroute `always` rules will
  // settle the value on whichever node matches `state.phase` before any
  // event is processed. From there, dispatch the action.
  void phaseToMachineState; // referenced for clarity; the always-rules do the work
  actor.send(machineEventFor(action));
  const snapshot = actor.getSnapshot();
  sub.unsubscribe();
  actor.stop();
  if (actorError) throw actorError;
  if (snapshot.status === 'error' && snapshot.error) throw snapshot.error;
  return {
    state: snapshot.context.state,
    events: snapshot.context.pendingEvents,
  };
}
