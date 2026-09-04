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
 *   { waitForSettled: '[data-reveal]' }    every match has finished its CSS animations and is opaque
 *   { waitForFunction: 'js expression' }   polls until the expression is truthy
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
 *
 * A recipe may also carry `viewport: 'phone-landscape' | { width, height, dpr }`
 * to pin its own viewport regardless of the CLI `--viewport`.
 *
 * `owner` is the subsystem the state belongs to (used by STATUS.json).
 * `budget` overrides the default per-subsystem perf budget.
 * `scene: false` marks a DOM-only state (no WebGL scene even under the
 * 3D renderer) so the budget check doesn't wait for `__MAHJONG_PERF__`.
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

/**
 * Menu settle: the card stagger (`Reveal`, CSS-driven) has finished and,
 * when the 3D backdrop is mounted, its intro tweens have too
 * (`MenuScene` flips `__MAHJONG_MENU_INTRO__` to 'settled'). Under the
 * classic renderer there is no scene, so only the DOM half applies.
 * Waiting on these instead of a fixed sleep means a cold-start stall
 * can't hand the verifier a half-faded frame.
 */
const MENU_INTRO_SETTLED = `(() => {
  if (!document.querySelector('[data-testid="lobby-backdrop-3d"]')) return true;
  return globalThis.__MAHJONG_MENU_INTRO__ === 'settled';
})()`;
const MENU_SETTLED = [
  { waitForSettled: '[data-reveal]' },
  { waitForFunction: MENU_INTRO_SETTLED },
  // One drift step + the canvas fade-in (400 ms) after the intro.
  { waitMs: 450 },
/** Scroll every scrolled container back to the top (the sheet's ScrollView). */
const SCROLL_TO_TOP = `
(() => {
  for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTop = 0;
})();
`;

/**
 * Tap one skin chip, then the original, let the tint tween settle, and
 * scroll the sheet back up (Playwright scrolls the chips into view).
 */
const RETINT_ROUNDTRIP = (away, back) => [
  { clickTestId: away },
  { waitMs: 350 },
  { clickTestId: back },
  { waitMs: 900 },
  { evaluate: SCROLL_TO_TOP },
  { waitMs: 250 },
];

export const STATES = {
  // ── Menu ─────────────────────────────────────────────────────────────
  menu: {
    owner: 'menu',
    steps: [{ goto: '/' }, { waitForText: 'Modern Mahjong' }, ...MENU_SETTLED],
  },
  'menu-tutorials': {
    owner: 'menu',
    // Phone: the Tutorial row expands into the lesson rail (portrait)
    // or a glass sheet (landscape). Desktop / tablet: the lesson grid
    // is always visible, the click is a no-op. Settle first so the tap
    // doesn't scroll a still-moving row into view.
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      ...MENU_SETTLED,
      { click: '[data-testid="mode-tutorial"]' },
      { waitFor: '[data-testid="lesson-basics"]' },
      { waitForSettled: '[data-reveal]' },
      { waitMs: 500 },
    ],
  },
  'menu-reduced-motion': {
    owner: 'menu',
    // `animations: false` → no intro, no drift, no parallax: the loop
    // must report idle (0 renders/s) once the first frame has painted.
    steps: [
      { setSettings: { animations: false } },
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      ...MENU_SETTLED,
      { waitMs: 800 },
    ],
    optional: true,
  },
  'replay-library': {
    owner: 'menu',
    // Themed like the lobby but with no 3D scene (ARCHITECTURE.md §0
    // non-goals) — `scene: false` tells the verifier not to expect
    // `__MAHJONG_PERF__` here.
    scene: false,
    steps: [
      { goto: '/replays' },
      { waitForText: 'Replays' },
      { waitForSettled: '[data-reveal]' },
      { waitMs: 300 },
    ],
  },
  'replay-import': {
    owner: 'menu',
    scene: false,
    steps: [
      { goto: '/replays' },
      { waitForText: 'Replays' },
      { waitForSettled: '[data-reveal]' },
      { click: 'role=button[name="Import replays"]' },
      { waitForText: 'Paste a JSON-encoded replay' },
      { waitMs: 700 },
    ],
    optional: true,
  },

  // ── Settings ─────────────────────────────────────────────────────────
  settings: {
    owner: 'settings',
    steps: [
      ...START_SOLO,
      { waitForOwnHand: true },
      { openSettings: true },
      { waitForPerf: true },
      // Round-trip a skin so the perf snapshot holds steady-state frames
      // from the live re-tint (the preview otherwise idles after its one
      // warm-up frame); the final look is the default sage / blue.
      ...RETINT_ROUNDTRIP('felt-jade', 'felt-sage'),
    ],
  },
  'settings-jade-plum': {
    owner: 'settings',
    steps: [
      { setSettings: { felt: 'jade', tileBack: 'plum' } },
      ...START_SOLO,
      { waitForOwnHand: true },
      { openSettings: true },
      { waitForPerf: true },
      ...RETINT_ROUNDTRIP('tileback-blue', 'tileback-plum'),
    ],
  },
  // Letterbox preview (~3.8:1 canvas) — pinned to phone landscape so the
  // rail framing is checked every round regardless of the CLI viewport.
  'settings-landscape': {
    owner: 'settings',
    viewport: 'phone-landscape',
    steps: [
      ...START_SOLO,
      { waitForOwnHand: true },
      { openSettings: true },
      { waitForPerf: true },
      ...RETINT_ROUNDTRIP('felt-jade', 'felt-sage'),
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
