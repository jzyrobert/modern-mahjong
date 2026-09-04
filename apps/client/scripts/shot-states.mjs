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
   { clickLastOwnTile: true }             taps the rightmost own-hand tile (the honour singleton the lessons ask for)
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

const CLAIM_TOAST_INIT = `
globalThis.__MAHJONG_TEST_SEED__ = 9;
globalThis.__MAHJONG_TEST_BOT_SCRIPTS__ = { 1: {}, 2: {}, 3: {} };
globalThis.__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = 300;
`;

/**
 * Bot-claim setup (`match-claim-toast`): find a face the user holds one
 * of and seat 1 holds two of, script seat 1 to peng it (the scripted
 * bots accept a `claims` list to issue when legal) and discard
 * it from the user's hand.
 */
const BOT_PENG_SETUP = `
(() => {
  const s = globalThis.__MAHJONG_TEST_GET_STATE__();
  if (!s.state || s.you === null) throw new Error('no state');
  const key = (t) => (t.kind === 'suit' ? 's:' + t.suit + ':' + t.rank : 'h:' + t.honor);
  const mine = s.state.hands[s.you];
  const botCounts = new Map();
  for (const t of s.state.hands[1]) botCounts.set(key(t), (botCounts.get(key(t)) ?? 0) + 1);
  const target = mine.find((t) => (botCounts.get(key(t)) ?? 0) >= 2);
  if (!target) throw new Error('no bot-peng-able face in the dealt hand');
  globalThis.__MAHJONG_TEST_BOT_SCRIPTS__[1] = { claims: [{ kind: 'peng' }] };
  const name = (t) => (t.kind === 'suit' ? t.rank + ' ' + t.suit : ({ E: 'East wind', S: 'South wind', W: 'West wind', N: 'North wind', Z: 'Red dragon', F: 'Green dragon', B: 'White dragon' })[t.honor]);
  const want = name(target);
  const btn = [...document.querySelectorAll('[data-testid="own-hand-tile"]')].find((b) => (b.getAttribute('aria-label') || '').startsWith(want));
  if (!btn) throw new Error('no hit-target for ' + want);
  btn.click();
})();
`;

/** Dismiss the tutorial completion prompt through the store hook. */
const DISMISS_TUTORIAL_PROMPT = `
(() => {
  const t = globalThis.__MAHJONG_TEST_GET_TUTORIAL__?.();
  if (t && typeof t.dismissCompletion === 'function') t.dismissCompletion();
})();
`;

/**
 * Drive the promoted-gang lesson (seed 6755) to the "Promote gang" CTA:
 * intro → discard the last tile (F) → seat 1 throws the third 7p →
 * Peng → discard the last tile (N) → bots play → draw (the fourth 7p).
 * Bots are paced fast; the lesson's own force-pass keeps them quiet.
 */
const PROMOTED_GANG_TO_CTA = [
  { initScript: 'globalThis.__MAHJONG_TEST_BOT_PACE_MS__ = 400;' },
  { goto: '/' },
  { waitForText: 'Modern Mahjong' },
  { startTutorial: 'promoted-gang' },
  { waitForOwnHand: true },
  { waitMs: 900 },
  { clickTutorialNext: true },
  { waitMs: 500 },
  { clickLastOwnTile: true },
  { waitFor: '[data-testid="claim-bar"]', timeout: 30000 },
  { waitMs: 400 },
  { click: 'role=button[name="Peng"]', timeout: 10000 },
  { waitFor: '[data-testid="claim-bar"]', state: 'hidden', timeout: 10000 },
  { waitMs: 900 },
  { clickLastOwnTile: true },
  { waitForDrawCue: true },
  { waitMs: 300 },
  { clickTestId: 'wall-draw-next', nth: 0 },
  { waitFor: 'role=button[name="Promote gang"]', timeout: 15000 },
];

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
 * The settle waits for the loop to report idle rather than a fixed
 * sleep: on SwiftShader the preview renders at 1–2 fps, so 900 ms of
 * wall clock could capture the re-tint mid-tween and skew any colour
 * measurement taken from the PNG.
 */
const RETINT_ROUNDTRIP = (away, back) => [
  { clickTestId: away },
  { waitMs: 350 },
  { clickTestId: back },
  { waitMs: 900 },
  { waitForFunction: 'globalThis.__MAHJONG_PERF__?.idle === true', timeout: 12000 },
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
    // Themed like the lobby; the only scene is the empty state's 3D
    // shelf (`ReplayShelf3D`, seven tiles, one draw call) — a fresh
    // context always has zero replays, so the menu budget applies.
    steps: [
      { goto: '/replays' },
      { waitForText: 'Replays' },
      { waitForSettled: '[data-reveal]' },
      { waitFor: '[data-testid="replay-shelf-3d"] canvas', timeout: 15000 },
      { waitMs: 900 },
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
  'tutorial-basics-4': {
    // `watch-bots` step: the shared discard pool is the target. The user's
    // first discard lands, then the bots start filling the pool — on the
    // 3D table the ring follows the projected river rect and every
    // discarded tile carries the gold spotlight. Bots are paced to 1.8 s
    // so the third discard (which completes the step and swaps the card)
    // lands well after the shot, perf wait included — a shot taken during
    // that swap catches the next card mid fade-in on SwiftShader.
    owner: 'tutorial',
    steps: [
      { initScript: 'globalThis.__MAHJONG_TEST_BOT_PACE_MS__ = 1800;' },
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'basics' },
      { waitMs: 800 },
      { clickTutorialNext: true },
      { waitMs: 400 },
      { clickTutorialNext: true },
      { waitMs: 400 },
      { clickTutorialNext: true },
      { waitForOwnHand: true },
      { waitMs: 600 },
      { clickTestId: 'own-hand-tile', nth: 0 },
      { waitMs: 3000 },
    ],
  },
  'tutorial-drawn-game-2': {
    // `watch` step of `drawn-game`: the wall-draw cue is the target while
    // the bots drain the last tiles. The 3D table registers the DOM cue
    // only on the user's own draw, so this checks the world-space half —
    // the next wall tile glows gold — and the card's fallback.
    owner: 'tutorial',
    steps: [
      { initScript: 'globalThis.__MAHJONG_TEST_BOT_PACE_MS__ = 1500;' },
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'drawn-game' },
      { waitMs: 800 },
      { clickTutorialNext: true },
      { waitForOwnHand: true },
      { waitMs: 600 },
      { clickTestId: 'own-hand-tile', nth: 0 },
      // The wall holds two tiles; the first bot draws one at once, so
      // shoot before its paced discard hands the last tile on.
      { waitMs: 350 },
    ],
  },
  'tutorial-scoring-0': {
    // Intro caption of `scoring-intro` (no target): the centred card must
    // stay horizontally centred and clear of the hand row / toggles.
    owner: 'tutorial',
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'scoring-intro' },
      { waitForOwnHand: true },
      { waitMs: 1200 },
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
  'match-late-hand': {
    owner: 'table',
    // Twelve of the user's turns in: every river holds two rows
    // (pinwheel, no corner collisions), the walls are drawn down to the
    // break, and on desktop / landscape the footer claim strip and the
    // chrome-row toasts must still sit clear of the user's own river.
    // The bots pass every claim window (the tutorial's force-pass seam)
    // so nobody melds or wins before the twelfth turn on any seed.
    steps: [
      {
        initScript:
          'globalThis.__MAHJONG_TEST_BOT_SCRIPTS__ = { 1: {}, 2: {}, 3: {} }; globalThis.__MAHJONG_TUTORIAL_FORCE_PASS__ = true;',
      },
      ...START_SOLO,
      { waitForOwnHand: true },
      { playTurns: 12 },
      { waitMs: 600 },
    ],
  },
  'match-discard-flight': {
    owner: 'table',
    // Motion still: the user's first discard caught mid-arc. Flights are
    // stretched 8× through the test seam (dispense untouched), bots are
    // paced out of the frame, and the shot lands ~0.25 of the way along
    // the 520 ms arc (≈ 130 ms at real speed): tile in the air with its
    // spin, the gold latest-discard pulse already on it, its shadow on
    // the felt, and the gap it left in the hand row closing behind it.
    steps: [
      {
        initScript:
          'globalThis.__MAHJONG_TEST_MOTION_SLOWMO__ = 8; globalThis.__MAHJONG_TEST_BOT_PACE_MS__ = 8000;',
      },
      ...START_SOLO,
      { waitForOwnHand: true },
      { waitMs: 1500 },
      { clickTestId: 'own-hand-tile', nth: 3 },
      { waitMs: 900 },
    ],
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
  'match-dealt-dead-left': {
    owner: 'table',
    // Seed 33 rolls dealer 0 with an 8 break, so the whole dead wall
    // (7 stacks) stands on the *left* wall (seat 3) from the user's
    // seat: the gold inlay on the dead stacks must read as a marked
    // segment beside the left rack — not as a stray line on the felt.
    steps: [
      { initScript: 'globalThis.__MAHJONG_TEST_SEED__ = 33;' },
      ...START_SOLO,
      { waitForOwnHand: true },
      { waitMs: 1500 },
    ],
  },
  'match-own-meld': {
    owner: 'table',
    // The user's peng landed (CLAIM_SETUP + a tap on the gold Peng
    // button): their meld stands upright in the hand row, faces to the
    // camera, the claimed tile a step toward the camera; the turn chip
    // under the hand reads DISCARD.
    steps: [
      { initScript: CLAIM_INIT },
      ...START_SOLO,
      { waitForOwnHand: true },
      { waitMs: 1600 },
      { evaluate: CLAIM_SETUP },
      { waitFor: '[data-testid="claim-bar"]', timeout: 20000 },
      { click: 'role=button[name="Peng"]', timeout: 10000 },
      { waitFor: '[data-testid="claim-bar"]', state: 'hidden', timeout: 10000 },
      { waitMs: 1400 },
    ],
  },
  'match-claim-toast': {
    owner: 'table',
    // A bot's peng: seed 9 deals the user (dealer) a 2-man that seat 1
    // holds two of; seat 1 is scripted to peng the user's first discard
    // (the setup below picks that face), so the glass claim toast — 碰
    // PENG, "<name> called" — is up when the shot lands.
    steps: [
      { initScript: CLAIM_TOAST_INIT },
      ...START_SOLO,
      { waitForOwnHand: true },
      { waitMs: 1600 },
      { evaluate: BOT_PENG_SETUP },
      { waitFor: '[data-testid="claim-toast-glyph"]', timeout: 20000 },
      { waitMs: 500 },
    ],
  },
  'match-win-celebration': {
    owner: 'table',
    // The `win` lesson deals a complete hand; declaring tsumo resolves
    // the hand and the glass result card lands with the gold 和 stamp
    // (the 3D renderer's celebration — the classic cream card is gated
    // off under it). The stamp animates in; `mj-hud-fade` runs 200 ms.
    steps: [
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'win' },
      { waitForOwnHand: true },
      { waitMs: 900 },
      { clickTutorialNext: true },
      { click: 'role=button[name=/Declare win/]', timeout: 15000 },
      { waitFor: '[data-testid="win-stamp"]', timeout: 15000 },
      // Finish the lesson (Done → completion prompt, dismissed through
      // the tutorial store hook) so the card is not under the caption.
      { waitMs: 400 },
      { clickTutorialNext: true },
      { waitMs: 400 },
      { evaluate: DISMISS_TUTORIAL_PROMPT },
      { waitMs: 900 },
    ],
  },
  'match-shuffle': {
    owner: 'table',
    // Mid-shuffle frame between hands: the `win` lesson's hand resolves
    // (tsumo), then "Start next hand" starts a fresh seed. Under the 3D
    // renderer the between-hand ceremony is the table's own slow
    // dispense plus the glass 洗牌 pill — no cream scrim, no token ring.
    // The lesson card is dismissed first (Done → completion prompt →
    // dismissed through the tutorial store hook) so the frame shows the
    // table, not the tutorial.
    steps: [
      // The ceremony is stretched to 12 s so the frame lands inside it
      // (the verifier's perf wait alone can outlast the app's 1.7 s).
      { initScript: 'globalThis.__MAHJONG_TEST_SHUFFLE_MS__ = 12000;' },
      { goto: '/' },
      { waitForText: 'Modern Mahjong' },
      { startTutorial: 'win' },
      { waitForOwnHand: true },
      { waitMs: 900 },
      { clickTutorialNext: true },
      { click: 'role=button[name=/Declare win/]', timeout: 15000 },
      { waitFor: '[data-testid="win-stamp"]', timeout: 15000 },
      { waitMs: 600 },
      { clickTutorialNext: true },
      { waitMs: 500 },
      { evaluate: DISMISS_TUTORIAL_PROMPT },
      { waitMs: 300 },
      { click: 'role=button[name="Start next hand"]', timeout: 10000 },
      { waitFor: '[data-testid="shuffle-pill"]', timeout: 10000 },
      { waitMs: 1200 },
    ],
  },
  'tutorial-promoted-gang-before': {
    owner: 'table',
    // The promoted-gang lesson at the moment before the promotion: the
    // user has peng'd 7p, drawn the fourth 7p and the "Promote gang" CTA
    // is up. Paired with `-after` to check the replacement draw leaves
    // the dead wall's far end and lands in the hand.
    steps: [...PROMOTED_GANG_TO_CTA, { waitMs: 800 }],
  },
  'tutorial-promoted-gang-after': {
    owner: 'table',
    steps: [
      ...PROMOTED_GANG_TO_CTA,
      { waitMs: 400 },
      { click: 'role=button[name="Promote gang"]', timeout: 10000 },
      { waitMs: 1600 },
    ],
  },
  'tutorial-promoted-gang-flight': {
    owner: 'table',
    // Same, caught mid-flight (draw flights stretched 8×): the tile in
    // the air is the one leaving the dead wall's far end.
    steps: [
      { initScript: 'globalThis.__MAHJONG_TEST_MOTION_SLOWMO__ = 8;' },
      ...PROMOTED_GANG_TO_CTA,
      { waitMs: 400 },
      { click: 'role=button[name="Promote gang"]', timeout: 10000 },
      { waitMs: 1500 },
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
    // Phone portrait: tapping the discards eases the camera into the
    // river block (~26 px tiles); the ✕ in the chrome row brings the
    // full table back. The region is inert on desktop (its rivers already
    // read at 38–40 px), so the recipe pins the phone viewport rather
    // than producing duplicate mid-hand evidence; the landscape variant
    // is `match-river-zoom-landscape`.
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
  'match-river-zoom-landscape': {
    owner: 'table',
    // Phone landscape: the same tap lifts the camera to 50° over the
    // river block, framed between the zoom header (glass across the
    // chrome row, the far wall behind it) and the footer (~28 px tiles,
    // ~21 px tall vs ~8 from the resting 31° camera). The zoom stays
    // through the player's own turn: the footer's hand rail shows the
    // hand as face thumbnails (tap → the table returns) and carries the
    // gold Draw pill while the player has to draw; the side seats' rows
    // leave the frame's edges. Shot at the user's draw cue, six turns in.
    viewport: 'phone-landscape',
    steps: [
      ...START_SOLO,
      { waitForOwnHand: true },
      { playTurns: 6 },
      { waitForDrawCue: true },
      { waitMs: 400 },
      { evaluate: `document.querySelector('[data-testid="shared-discards-region"]')?.click()` },
      { waitFor: '[data-testid="hand-rail"]', timeout: 10000 },
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
