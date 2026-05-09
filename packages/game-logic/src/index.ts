export * from './tiles.js';
export * from './rng.js';
export * from './hand.js';
export * from './state.js';
export * from './shanten.js';
export * from './scoring.js';
export * from './scoring-catalog.js';
export * from './claims.js';
// `./reduce.js` exports `reduce` (the XState-backed wrapper) — re-exported
// last so it shadows the legacy implementation in `./actions.js`. Metro's
// `unstable_enablePackageExports` + `module`-first conditions pin xstate
// to its pure ESM bundle so the multi-shim CJS↔ESM interop chain
// doesn't recurse at runtime.
export * from './actions.js';
export * from './reduce.js';
export * from './heuristic.js';
