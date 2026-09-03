/**
 * State recipes for `scripts/shot.mjs`. Each recipe is a list of steps
 * the verifier replays against a fresh page. Adding a state = adding
 * a recipe here. Keep recipes deterministic: pin seeds, zero bot
 * pacing, use test hooks (`__MAHJONG_TEST_*`) over wall-clock waits.
 *
 * Step kinds:
 *   { goto: '/path' }                      navigate (query params allowed)
 *   { click: 'role=button[name="…"]' }     any Playwright selector / locator string
 *   { clickTestId: 'own-hand-tile', nth: 0 }
 *   { waitFor: selector, state?: 'visible'|'hidden', timeout? }
 *   { waitForText: 'Lobby' }
 *   { waitMs: 400 }                        settle animations (use sparingly)
 *   { evaluate: 'js source' }              runs in page
 *   { setSettings: { felt: 'jade' } }      patches useGame.settings via the test hook
 *   { waitForPerf: true }                  waits until __MAHJONG_PERF__ published ≥ 2 samples
   { dismissDice: true }                  taps the opening-rolls overlay away if it is showing
   { waitForOwnHand: true }               waits for the first own-hand-tile hit target
   { waitForDrawCue: true }               waits for wall-draw-next, passing incidental claims
   { playTurns: n }                       draw + discard n times (bots respond in between)
   { openSettings: true }                 opens the in-match settings surface
   { startTutorial: 'basics' }            launches a lesson from the lobby
   { clickTutorialNext: true }            presses the caption card's CTA
 *   { viewport: { width, height, dpr } }   override the CLI viewport for this recipe
 *
 * `owner` is the subsystem the state belongs to (used by STATUS.json).
 * `budget` overrides the default per-subsystem perf budget.
 */

/**
 * Bot scripts that make seat 1 discard a face the user can peng on the
 * very first bot turn. Uses seed 5 (user is dealer, holds pair(s)).
 * Sets the hook before the match starts; `solo-transport` reads it.
 */
const CLAIM_SCRIPT = `
(() => {
  globalThis.__MAHJONG_TEST_SEED__ = 5;
  // Let the shot tool's post-start hook compute a peng-able face.
  globalThis.__MAHJONG_SHOT_WANT_CLAIM__ = true;
})();
`;

const START_SOLO = [
  { goto: '/' },
  { waitForText: 'Modern Mahjong' },
  { click: 'role=button[name="Play vs bots"]' },
  { waitForText: 'Lobby' },
  { click: 'role=button[name="Start match"]' },
  { dismissDice: true },
];

export const STATES = {
  // ── Menu ─────────────────────────────────────────────────────────────
  menu: {
    owner: 'menu',
    steps: [{ goto: '/' }, { waitForText: 'Modern Mahjong' }, { waitMs: 900 }],
  },
  'menu-tutorials': {
    owner: 'menu',
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { click: 'text=Tutorial' },
      { waitMs: 600 },
    ],
    optional: true,
  },
  'replay-library': {
    owner: 'menu',
    steps: [{ goto: '/replays' }, { waitMs: 600 }],
  },

  // ── Settings ─────────────────────────────────────────────────────────
  settings: {
    owner: 'settings',
    steps: [...START_SOLO, { waitForOwnHand: true }, { openSettings: true }, { waitMs: 700 }],
  },
  'settings-jade-plum': {
    owner: 'settings',
    steps: [
      { setSettings: { felt: 'jade', tileBack: 'plum' } },
      ...START_SOLO,
      { waitForOwnHand: true },
      { openSettings: true },
      { waitMs: 700 },
    ],
  },

  // ── Tutorial ─────────────────────────────────────────────────────────
  'tutorial-basics-0': {
    owner: 'tutorial',
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'basics' },
      { waitMs: 1200 },
    ],
  },
  'tutorial-basics-1': {
    owner: 'tutorial',
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'basics' },
      { waitMs: 800 },
      { clickTutorialNext: true },
      { waitMs: 800 },
    ],
  },
  'tutorial-claims-0': {
    owner: 'tutorial',
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'claims' },
      { waitMs: 1200 },
    ],
  },

  // ── In-game ──────────────────────────────────────────────────────────
  'match-dealt': {
    owner: 'table',
    steps: [...START_SOLO, { waitForOwnHand: true }, { waitMs: 1500 }],
  },
  'match-my-turn': {
    owner: 'table',
    steps: [
      ...START_SOLO,
      { waitForOwnHand: true },
      { waitMs: 1200 },
      { clickTestId: 'own-hand-tile', nth: 0 },
      { waitForDrawCue: true },
      { waitMs: 500 },
    ],
  },
  'match-mid-hand': {
    owner: 'table',
    steps: [...START_SOLO, { waitForOwnHand: true }, { playTurns: 6 }, { waitMs: 600 }],
  },
  'match-claim': {
    owner: 'table',
    steps: [
      { evaluate: CLAIM_SCRIPT },
      ...START_SOLO,
      { waitForOwnHand: true },
      { clickTestId: 'own-hand-tile', nth: 0 },
      { waitFor: '[data-testid="claim-bar"]', timeout: 20000 },
      { waitMs: 500 },
    ],
  },
  'match-result': {
    owner: 'table',
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'scoring-intro' },
      { waitMs: 1500 },
    ],
  },
  'match-lobby': {
    owner: 'table',
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { click: 'role=button[name="Play vs bots"]' },
      { waitForText: 'Lobby' },
      { waitMs: 600 },
    ],
  },
};

export const DEFAULT_SEED = 5;

/** Per-subsystem perf budgets (mid tier). See ARCHITECTURE.md §4. */
export const BUDGETS = {
  table: { drawCalls: 40, triangles: 150_000, programs: 12, frameMsP95: 8, textures: 12 },
  menu: { drawCalls: 20, triangles: 80_000, programs: 10, frameMsP95: 8, textures: 10 },
  settings: { drawCalls: 48, triangles: 160_000, programs: 14, frameMsP95: 8, textures: 14 },
  tutorial: { drawCalls: 48, triangles: 160_000, programs: 14, frameMsP95: 8, textures: 14 },
};

export const VIEWPORTS = {
  phone: { width: 412, height: 915, dpr: 2, mobile: true },
  'phone-landscape': { width: 915, height: 412, dpr: 2, mobile: true },
  tablet: { width: 834, height: 1194, dpr: 2, mobile: true },
  desktop: { width: 1440, height: 900, dpr: 1, mobile: false },
};
