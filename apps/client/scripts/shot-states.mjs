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
   { initScript: 'js source' }            addInitScript — globals the app reads at boot
 *
 * A recipe may also carry `viewport: 'phone-landscape' | { width, height, dpr }`
 * to pin its own viewport regardless of the CLI `--viewport`.
 *
 * `owner` is the subsystem the state belongs to (used by STATUS.json).
 * `budget` overrides the default per-subsystem perf budget. `noScene`
 * (or `scene: false`) marks a state that renders a classic DOM view
 * even under the 3D renderer (pre-game lobby) so the WebGL budget isn't
 * applied and the budget check doesn't wait for `__MAHJONG_PERF__`.
 */

/**
 * Claim state: seed 30 deals the user (dealer, seat 0) a pair that bot 1
 * also holds one copy of. After the deal, read the hands, script bot 1
 * to discard that face on its first turn (`__MAHJONG_TEST_BOT_SCRIPTS__`,
 * the same hook `e2e/claim-bar-options.spec.ts` uses) and discard a
 * *different* face from the user's hand so the peng stays legal.
 */
const CLAIM_INIT = `
globalThis.__MAHJONG_TEST_SEED__ = 30;
globalThis.__MAHJONG_TEST_BOT_SCRIPTS__ = { 1: {}, 2: {}, 3: {} };
`;
const CLAIM_SETUP = `
(() => {
  const s = globalThis.__MAHJONG_TEST_GET_STATE__();
  if (!s.state || s.you === null) throw new Error('no state');
  const key = (t) => (t.kind === 'suit' ? 's:' + t.suit + ':' + t.rank : 'h:' + t.honor);
  const mine = s.state.hands[s.you];
  const counts = new Map();
  for (const t of mine) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
  const botFaces = new Set(s.state.hands[1].map(key));
  const target = mine.find((t) => counts.get(key(t)) >= 2 && botFaces.has(key(t)));
  if (!target) throw new Error('no peng-able face in dealt hand');
  globalThis.__MAHJONG_TEST_BOT_SCRIPTS__[1] = { discards: [target] };
  // Discard a tile of another face via its projected hit-target (the
  // buttons' accessible names start with the tile name, e.g. "5 pin").
  const name = (t) => (t.kind === 'suit' ? t.rank + ' ' + t.suit : ({ E: 'East wind', S: 'South wind', W: 'West wind', N: 'North wind', Z: 'Red dragon', F: 'Green dragon', B: 'White dragon' })[t.honor]);
  const avoid = name(target);
  const buttons = [...document.querySelectorAll('[data-testid="own-hand-tile"]')];
  const btn = buttons.find((b) => !(b.getAttribute('aria-label') || '').startsWith(avoid));
  if (!btn) throw new Error('no discardable hit-target');
  btn.click();
})();
`;

const START_SOLO = [
  { goto: '/' },
  { waitForText: 'Modern Mahjong' },
  // Generous click timeouts: the menu's 3D backdrop renders at a few
  // fps on SwiftShader and Playwright's actionability checks wait on
  // animation frames.
  { click: 'role=button[name="Play vs bots"]', timeout: 20000 },
  { waitForText: 'Lobby' },
  { click: 'role=button[name="Start match"]', timeout: 20000 },
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
];

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
  'tutorial-basics-2': {
    // `own-hand` step — the marquee coach-mark: halo on the hand row,
    // card docked above it with the pointer notch.
    owner: 'tutorial',
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'basics' },
      { waitMs: 800 },
      { clickTutorialNext: true },
      { waitMs: 500 },
      { clickTutorialNext: true },
      { waitMs: 900 },
    ],
  },
  'tutorial-scoring-1': {
    // First staged example of `scoring-intro`: the result panel is the
    // target, so the card side-docks (desktop / landscape) or overlaps
    // the panel's bottom edge (portrait phone).
    owner: 'tutorial',
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'scoring-intro' },
      { waitMs: 800 },
      { clickTutorialNext: true },
      { waitMs: 1200 },
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
  'match-dice': {
    owner: 'table',
    // The opening-rolls modal as every match opens with it: START_SOLO
    // minus the dismiss tap, so the shot shows the glass dice panel over
    // the freshly dealt table.
    steps: [
      { initScript: 'globalThis.__MAHJONG_TEST_HOLD_DICE__ = true;' },
      ...START_SOLO.filter((s) => !s.dismissDice),
      { waitForText: 'Tap anywhere to dismiss', timeout: 20000 },
      { waitFor: '[data-testid="table-3d-scene"]', timeout: 20000 },
      { waitMs: 1400 },
    ],
  },
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
      { initScript: CLAIM_INIT },
      ...START_SOLO,
      { waitForOwnHand: true },
      { waitMs: 1600 },
      { evaluate: CLAIM_SETUP },
      { waitFor: '[data-testid="claim-bar"]', timeout: 20000 },
      { waitMs: 700 },
    ],
  },
  'match-result': {
    owner: 'table',
    // Step 0 of the scoring lesson is an intro caption; the first
    // "Got it" stages `phase: 'resolved'` with a rigged winning hand,
    // so the shot shows the reveal + result panel.
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'scoring-intro' },
      { waitForOwnHand: true },
      { waitMs: 900 },
      { clickTutorialNext: true },
      { waitFor: '[data-testid="winning-hand"]', timeout: 15000 },
      { waitMs: 1400 },
    ],
  },
  'match-lobby': {
    owner: 'table',
    // The glass waiting room sits over the waiting table (walls built,
    // `LobbyTableBackdrop`) — the in-game budget applies.
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { click: 'role=button[name="Play vs bots"]', timeout: 20000 },
      { waitForText: 'Lobby' },
      { waitFor: '[data-testid="lobby-table-3d"]', timeout: 20000 },
      { waitMs: 1500 },
    ],
  },
  'match-river-zoom': {
    owner: 'table',
    // Portrait only: tapping the discards eases the camera into the
    // river block (~26 px tiles); the ✕ in the chrome row brings the
    // full table back. The region is inert on the wide viewports (their
    // rivers already read at 29–40 px), so the recipe pins the phone
    // viewport rather than producing duplicate mid-hand evidence.
    viewport: 'phone',
    steps: [
      ...START_SOLO,
      { waitForOwnHand: true },
      { playTurns: 6 },
      { waitMs: 400 },
      // JS click so the step is a no-op where the region is inert.
      {
        evaluate: `document.querySelector('[data-testid="shared-discards-region"]')?.click()`,
      },
      { waitMs: 1400 },
    ],
  },
  'match-dealt-jade-plum': {
    owner: 'table',
    // Skin coverage: jade felt + plum tile backs (the scene re-tints the
    // felt colour uniform + back gradient live, no rebuild).
    steps: [
      { setSettings: { felt: 'jade', tileBack: 'plum' } },
      ...START_SOLO,
      { waitForOwnHand: true },
      { waitMs: 1500 },
    ],
  },
  'tile-sheet': {
    owner: 'table',
    // Debug: every distinct face standing in rows for glyph inspection.
    steps: [
      { initScript: 'globalThis.__MAHJONG_DEBUG_TILE_SHEET__ = true;' },
      ...START_SOLO,
      { waitFor: '[data-testid="table-3d-scene"]', timeout: 20000 },
      { waitMs: 1200 },
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
