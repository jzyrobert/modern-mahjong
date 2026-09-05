import { expect, test } from './_helpers';

/**
 * Three.js menu backdrop (`src/three/menu/`). Pins the 3D renderer,
 * loads the lobby at phone + desktop, and asserts the contract from
 * ARCHITECTURE.md §8: zero console / page errors, `__MAHJONG_PERF__`
 * (the page total over both menu canvases) published within the menu
 * budget (≤ 20 draw calls, ≤ 80 k triangles, ≤ 10 programs), the
 * scenes idle / throttle once the intro has settled, and every DOM hit
 * target the legacy lobby specs rely on still exists over the canvas.
 *
 * Two canvases draw the menu: the drift field in the fixed backdrop
 * (`menu-3d`) and the hero rack + dice inside the lobby's hero band
 * (`menu-3d-hero`), which is ScrollView content — the rack scrolls
 * with the title on the compositor, so no scroll handler re-aims a
 * camera (`viewOffsetApplies` must not move across a scroll).
 */

interface PerfSnapshot {
  drawCalls: number;
  triangles: number;
  programs: number;
  textures: number;
  fps: number;
  idle: boolean;
  renders: number;
  sample: number;
}

const MENU_BUDGET = { drawCalls: 20, triangles: 80_000, programs: 10, textures: 10 };

interface MenuDebug {
  occluders: number;
  reseeded: boolean;
  visible: number;
  parked: number;
  fades: number[];
  tiles: { x: number; y: number; r: number; fade: number }[];
  dice: number[];
  diceRects: { x: number; y: number; r: number }[];
  rack: { x: number; y: number; w: number; h: number };
  band: { x: number; y: number; w: number; h: number } | null;
  rackGoal: { x: number; y: number; w: number; h: number } | null;
  /** Hero camera `setViewOffset` re-applies since build (resize only). */
  viewOffsetApplies: number;
  /** Hero scenes built on the page (1 = never remounted). */
  heroBuilds: number;
}

type Rect = { x: number; y: number; w: number; h: number };
type Box = { x: number; y: number; width: number; height: number };

function intersects(r: Rect, b: Box): boolean {
  return r.x < b.x + b.width && r.x + r.w > b.x && r.y < b.y + b.height && r.y + r.h > b.y;
}

/** The title block's heading + tagline boxes (the tagline is absent on
 *  landscape phones) and the lowest edge of the two. */
async function titleBoxes(
  page: import('@playwright/test').Page,
): Promise<{ heading: Box; tagline: Box | null; bottom: number }> {
  const heading = await page.getByRole('heading', { name: 'Modern Mahjong' }).boundingBox();
  if (!heading) throw new Error('missing heading box');
  const taglineLoc = page.getByText(/^136 tiles/);
  const tagline = (await taglineLoc.count()) > 0 ? await taglineLoc.first().boundingBox() : null;
  const bottom = Math.max(heading.y + heading.height, tagline ? tagline.y + tagline.height : 0);
  return { heading, tagline, bottom };
}

/** The 3D flow's page ground (`MENU.void0`, #0b120f) as CSS reports it. */
const VOID_RGB = 'rgb(11, 18, 15)';
const CREAM_RGB = 'rgb(241, 234, 220)';

async function pageGround(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
  }));
}

/**
 * Sample a viewport strip: every pixel is classed as cream-ish (warm,
 * light, r − b ≥ 10 — the #f1eadc family; white copy and the gold
 * accent both fall outside), plus the mean luminance and the largest
 * channel value seen. With `hideCanvas` (the default) the WebGL canvas
 * is hidden for the capture so the *DOM* ground is what is measured —
 * a drifting ivory tile face is the same hue as the cream this guards
 * against; the app-bar probe keeps it visible on purpose.
 */
async function sampleStrip(
  page: import('@playwright/test').Page,
  clip: Box,
  { hideCanvas = true }: { hideCanvas?: boolean } = {},
): Promise<{ total: number; cream: number; meanLum: number; maxChannel: number }> {
  if (hideCanvas)
    await page.evaluate(() => {
      for (const c of Array.from(document.querySelectorAll('canvas')))
        c.style.visibility = 'hidden';
    });
  const png = await page.screenshot({ clip, type: 'png' });
  const out = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let cream = 0;
    let lum = 0;
    let maxChannel = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] ?? 0;
      const g = d[i + 1] ?? 0;
      const b = d[i + 2] ?? 0;
      lum += (r + g + b) / 3;
      maxChannel = Math.max(maxChannel, r, g, b);
      if (r >= 225 && g >= 215 && b >= 200 && b <= 240 && r - b >= 10) cream++;
    }
    return { total: d.length / 4, cream, meanLum: lum / (d.length / 4), maxChannel };
  }, png.toString('base64'));
  if (hideCanvas)
    await page.evaluate(() => {
      for (const c of Array.from(document.querySelectorAll('canvas'))) c.style.visibility = '';
    });
  return out;
}

/**
 * The app bar's own ground from one capture of the bar (canvas visible):
 * the padding rows above the identity pill and below it, i.e. rows
 * 2..6 and h−7..h−3 of the clip. Returns the largest channel value and
 * the cream-ish count across both row bands.
 */
async function sampleBarGround(
  page: import('@playwright/test').Page,
  clip: Box,
): Promise<{ maxChannel: number; cream: number }> {
  const png = await page.screenshot({ clip, type: 'png' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let maxChannel = 0;
    let cream = 0;
    const rows: [number, number][] = [
      [2, 6],
      [c.height - 7, c.height - 3],
    ];
    for (const [y0, y1] of rows) {
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          const r = d[i] ?? 0;
          const g = d[i + 1] ?? 0;
          const b = d[i + 2] ?? 0;
          maxChannel = Math.max(maxChannel, r, g, b);
          if (r >= 225 && g >= 215 && b >= 200 && b <= 240 && r - b >= 10) cream++;
        }
      }
    }
    return { maxChannel, cream };
  }, png.toString('base64'));
}

/** Scroll the lobby's ScrollView (the tallest scrollable element) to `top`. */
async function scrollLobbyTo(page: import('@playwright/test').Page, top: number): Promise<void> {
  await page.evaluate((y) => {
    let best: Element | null = null;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(cs.overflowY)) {
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
    }
    if (best) best.scrollTop = y;
  }, top);
}

/**
 * Where the two menu canvases live in the DOM: `scroller` is the
 * lobby's ScrollView element; `heroInScroller` / `driftInScroller` say
 * whether each canvas is a descendant of it (the hero must be — that is
 * what makes the compositor move it with the title; the drift field
 * must not — a fixed field behind a scrolling page is depth, one that
 * follows scroll is jitter).
 */
async function canvasAncestry(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    let best: Element | null = null;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(cs.overflowY)) {
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
    }
    const hero = document.querySelector('[data-testid="menu-3d-hero"] canvas');
    const drift = document.querySelector('[data-testid="menu-3d"] canvas');
    const band = document.querySelector('[data-testid="hero-band"]');
    return {
      scroller: best !== null,
      heroInScroller: !!(best && hero && best.contains(hero)),
      heroInBand: !!(band && hero && band.contains(hero)),
      driftInScroller: !!(best && drift && best.contains(drift)),
    };
  });
}

/**
 * Set the lobby's `scrollTop` and read the hero canvas's client top in
 * the *same* synchronous evaluate — no rAF, no paint in between. A
 * canvas that is scroll content moves by exactly the scroll delta
 * right there; one that a scroll listener re-aims would still read its
 * old position.
 */
async function scrollLobbyAndMeasure(
  page: import('@playwright/test').Page,
  top: number,
): Promise<{ scrollTop: number; heroTop: number }> {
  return page.evaluate((y) => {
    let best: Element | null = null;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(cs.overflowY)) {
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
    }
    if (!best) throw new Error('no lobby scroller');
    best.scrollTop = y;
    const hero = document.querySelector('[data-testid="menu-3d-hero"] canvas');
    if (!hero) throw new Error('no hero canvas');
    return { scrollTop: best.scrollTop, heroTop: hero.getBoundingClientRect().top };
  }, top);
}

interface ShelfDebug {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
  settled: boolean;
}

function readShelfDebug(page: import('@playwright/test').Page): Promise<ShelfDebug | undefined> {
  return page.evaluate(
    () => (globalThis as { __MAHJONG_SHELF_DEBUG__?: ShelfDebug }).__MAHJONG_SHELF_DEBUG__,
  );
}

/** Drift tiles that are actually showing (fade > 0.05). */
function shownTiles(debug: MenuDebug): MenuDebug['tiles'] {
  return debug.tiles.filter((t) => t.fade > 0.05);
}

/** Discs (tiles or dice) whose visible area overlaps `box`. */
function discsOver(
  discs: readonly { x: number; y: number; r: number }[],
  box: { x: number; y: number; width: number; height: number },
  slack = 0,
): { x: number; y: number; r: number }[] {
  return discs.filter((t) => {
    const dx = Math.max(box.x - t.x, 0, t.x - (box.x + box.width));
    const dy = Math.max(box.y - t.y, 0, t.y - (box.y + box.height));
    return Math.hypot(dx, dy) < t.r + slack;
  });
}

function readMenuDebug(page: import('@playwright/test').Page): Promise<MenuDebug | undefined> {
  return page.evaluate(
    () => (globalThis as { __MAHJONG_MENU_DEBUG__?: MenuDebug }).__MAHJONG_MENU_DEBUG__,
  );
}

/** Drift tiles whose visible disc overlaps `box` (fade > 0.05 counts). */
function tilesOver(
  debug: MenuDebug,
  box: { x: number; y: number; width: number; height: number },
): MenuDebug['tiles'] {
  return debug.tiles.filter((t) => {
    if (t.fade <= 0.05) return false;
    const dx = Math.max(box.x - t.x, 0, t.x - (box.x + box.width));
    const dy = Math.max(box.y - t.y, 0, t.y - (box.y + box.height));
    return Math.hypot(dx, dy) < t.r;
  });
}

function collectErrors(page: import('@playwright/test').Page): () => string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    // three's shadow-map deprecation notice is a warning, not an error,
    // but the menu scene picks a supported filter so it must never fire.
    if (m.type() === 'warning' && /PCFSoftShadowMap/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return () => errors;
}

/** True once every `Reveal` wrapper has finished its CSS entrance. */
function allRevealsSettled(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-reveal]')).every((el) => {
      const running = el
        .getAnimations()
        .some((a) => a.playState !== 'finished' && a.playState !== 'idle');
      return !running && getComputedStyle(el).opacity === '1';
    }),
  );
}

async function readPerf(page: import('@playwright/test').Page): Promise<PerfSnapshot> {
  await page.waitForFunction(
    () =>
      ((globalThis as { __MAHJONG_PERF__?: { sample: number } }).__MAHJONG_PERF__?.sample ?? 0) >=
      2,
    null,
    { timeout: 15_000 },
  );
  return page.evaluate(
    () => (globalThis as { __MAHJONG_PERF__?: PerfSnapshot }).__MAHJONG_PERF__ as PerfSnapshot,
  );
}

// `_helpers` pins `classic` for the legacy suite; init scripts run in
// registration order, so this later assignment wins for these specs.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as { __MAHJONG_TEST_RENDERER__?: string }).__MAHJONG_TEST_RENDERER__ = '3d';
  });
});

test.describe('three: menu backdrop', () => {
  test('phone: scene mounts behind the lobby within budget and keeps the DOM contract', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    // The 3D backdrop is mounted (lazy) and both canvases are present:
    // the drift field behind the page, the hero inside the hero band.
    await expect(page.getByTestId('lobby-backdrop-3d')).toBeAttached();
    await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({ timeout: 15_000 });
    await expect(page.getByTestId('hero-band').locator('canvas')).toBeAttached({
      timeout: 15_000,
    });

    const perf = await readPerf(page);
    expect(perf.drawCalls).toBeLessThanOrEqual(MENU_BUDGET.drawCalls);
    expect(perf.triangles).toBeLessThanOrEqual(MENU_BUDGET.triangles);
    expect(perf.programs).toBeLessThanOrEqual(MENU_BUDGET.programs);
    expect(perf.textures).toBeLessThanOrEqual(MENU_BUDGET.textures);

    // Legacy hit targets over the canvas.
    await expect(page.getByLabel('Match code')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join match' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play vs bots' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit display name' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tutorial' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replays' })).toBeVisible();

    // Card stagger is CSS-driven and finishes within ~0.7 s of the
    // heading painting, even with three loading in the background.
    await expect.poll(() => allRevealsSettled(page), { timeout: 2500 }).toBe(true);

    // The scene publishes its intro state for the verifier and settles.
    await page.waitForFunction(
      () =>
        (globalThis as { __MAHJONG_MENU_INTRO__?: string }).__MAHJONG_MENU_INTRO__ === 'settled',
      null,
      { timeout: 6000 },
    );

    // The lobby's glass cards, title, footer, match-code field and
    // primary CTAs register as occluders and the drift field has been
    // re-seeded around them, so no tile straddles a card edge, crosses
    // the credits, or ghosts inside the form (round-2 critic: a 索 face
    // sat beside the ABCDE placeholder and a back crossed "Join match").
    await page.waitForTimeout(300);
    const debug = await readMenuDebug(page);
    if (!debug) throw new Error('menu debug never published');
    expect(debug.occluders).toBeGreaterThanOrEqual(8);
    expect(debug.reseeded).toBe(true);
    const input = await page.getByLabel('Match code').boundingBox();
    const join = await page.getByRole('button', { name: 'Join match' }).boundingBox();
    const play = await page.getByRole('button', { name: 'Play vs bots' }).boundingBox();
    if (!input || !join || !play) throw new Error('missing form boxes');
    expect(tilesOver(debug, input)).toEqual([]);
    expect(tilesOver(debug, join)).toEqual([]);
    expect(tilesOver(debug, play)).toEqual([]);
    // On phones the field stays out of the card column entirely.
    const online = await page.getByTestId('mode-online').boundingBox();
    if (!online) throw new Error('missing online card box');
    expect(tilesOver(debug, online)).toEqual([]);
    // The dice pair clears every glass edge too.
    for (const f of debug.dice) expect(f).toBeGreaterThanOrEqual(0.9);
    // No drift disc touches the hero rack's footprint (a far back used to
    // poke out from under the bottom-right 中 and read as debris).
    expect(
      discsOver(shownTiles(debug), {
        x: debug.rack.x,
        y: debug.rack.y,
        width: debug.rack.w,
        height: debug.rack.h,
      }),
    ).toEqual([]);

    // Tutorial row expands into the lesson rail with the testIDs the
    // verifier's `startTutorial` step uses.
    await page.getByRole('button', { name: 'Tutorial' }).click();
    await expect(page.getByTestId('lesson-basics')).toBeVisible();
    await expect(page.getByLabel('Start Basics: a guided hand')).toBeVisible();

    expect(errors()).toEqual([]);
  });

  test('landscape phone: the card stack clears the hero column and the top-right chip strip', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({ timeout: 15_000 });
    await expect.poll(() => allRevealsSettled(page), { timeout: 2500 }).toBe(true);

    // Cards start below the root FULLSCREEN / DISMISS chip (≈ y 60) and
    // right of the title column where the 3D rack + dice render.
    const online = await page.getByTestId('mode-online').boundingBox();
    const practice = await page.getByTestId('mode-practice').boundingBox();
    const tutorial = await page.getByTestId('mode-tutorial').boundingBox();
    if (!online || !practice || !tutorial) throw new Error('missing card boxes');
    expect(online.y).toBeGreaterThanOrEqual(60);
    expect(practice.y).toBeGreaterThanOrEqual(60);
    expect(online.x).toBeGreaterThanOrEqual(915 * 0.31);
    expect(tutorial.x).toBeGreaterThanOrEqual(915 * 0.31);
    // The Replays row never ellipsises its landscape copy.
    await expect(page.getByText('No replays yet', { exact: true })).toBeVisible();
    // Footer credits sit bottom-right, clear of the card row.
    const credit = await page.getByText(/^Sound by/).boundingBox();
    if (!credit) throw new Error('missing footer credit');
    expect(credit.y).toBeGreaterThan(tutorial.y + tutorial.height);

    // Tutorial opens the glass sheet with the lesson rail.
    await page.getByRole('button', { name: 'Tutorial' }).click();
    await expect(page.getByTestId('lesson-basics')).toBeVisible();

    const perf = await readPerf(page);
    expect(perf.drawCalls).toBeLessThanOrEqual(MENU_BUDGET.drawCalls);
    expect(perf.triangles).toBeLessThanOrEqual(MENU_BUDGET.triangles);
    expect(errors()).toEqual([]);
  });

  test('desktop: after the intro the loop throttles to a slow drift and the pointer wakes it', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({ timeout: 15_000 });

    // Let the intro settle (~1.5 s), then sample a full second with the
    // pointer still: the drift cadence caps renders well below 60 fps.
    await page.waitForTimeout(2200);
    const before = await readPerf(page);
    await page.waitForFunction(
      (s) =>
        ((globalThis as { __MAHJONG_PERF__?: { sample: number } }).__MAHJONG_PERF__?.sample ?? 0) >
        s,
      before.sample,
      { timeout: 5000 },
    );
    const settled = await readPerf(page);
    expect(settled.fps).toBeLessThanOrEqual(20);
    expect(settled.drawCalls).toBeLessThanOrEqual(MENU_BUDGET.drawCalls);
    expect(settled.triangles).toBeLessThanOrEqual(MENU_BUDGET.triangles);

    // The hero dice never straddle a card edge (they used to sit on the
    // Tutorial card's top-right corner at 1440×900).
    const debug = await readMenuDebug(page);
    if (!debug) throw new Error('menu debug never published');
    for (const f of debug.dice) expect(f).toBeGreaterThanOrEqual(0.9);
    const tutorial = await page.getByTestId('mode-tutorial').boundingBox();
    const input = await page.getByLabel('Match code').boundingBox();
    if (!tutorial || !input) throw new Error('missing desktop boxes');
    expect(discsOver(debug.diceRects, tutorial)).toEqual([]);
    expect(tilesOver(debug, input)).toEqual([]);
    // No ghost tiles behind the desktop glass: at 40 % size under a 16 px
    // blur they read as smudges under the card copy, not as depth.
    expect(tilesOver(debug, tutorial)).toEqual([]);

    // Desktop lobby contract.
    await expect(page.getByRole('button', { name: 'Create new match' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Browse open lobbies' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join LAN match' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open library' })).toBeVisible();
    await expect(page.getByLabel('Start Basics: a guided hand')).toBeVisible();

    expect(errors()).toEqual([]);
  });

  test('reduced motion: the scene renders once and then idles completely', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      try {
        const key = 'mj.settings.v1';
        const cur = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(key, JSON.stringify({ ...cur, animations: false }));
      } catch {
        /* private mode */
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    const a = await readPerf(page);
    await page.waitForFunction(
      (s) =>
        ((globalThis as { __MAHJONG_PERF__?: { sample: number } }).__MAHJONG_PERF__?.sample ?? 0) >
        s,
      a.sample,
      { timeout: 5000 },
    );
    const b = await readPerf(page);
    expect(b.idle).toBe(true);
    expect(b.renders).toBe(a.renders);
    // The frozen frame is the only frame: the dice must have been run
    // through the keep-out in it (the deferred 450 ms pass never ran
    // once the loop idled, leaving a die on the Tutorial card's corner)…
    const debug = await readMenuDebug(page);
    if (!debug) throw new Error('menu debug never published');
    expect(debug.reseeded).toBe(true);
    for (const f of debug.dice) expect(f).toBeGreaterThanOrEqual(0.9);
    const tutorial = await page.getByTestId('mode-tutorial').boundingBox();
    if (!tutorial) throw new Error('missing tutorial box');
    expect(discsOver(debug.diceRects, tutorial)).toEqual([]);
    // …and every shown drift tile sits wholly inside the frame instead of
    // staying half-cut by the edge forever.
    for (const t of shownTiles(debug)) {
      expect(t.x - t.r).toBeGreaterThanOrEqual(-1);
      expect(t.x + t.r).toBeLessThanOrEqual(1441);
      expect(t.y - t.r).toBeGreaterThanOrEqual(-1);
      expect(t.y + t.r).toBeLessThanOrEqual(901);
    }
    expect(shownTiles(debug).length).toBeGreaterThanOrEqual(12);
    expect(errors()).toEqual([]);
  });

  test('reduced motion, portrait: the frozen field still shows tiles in the hero band', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      try {
        const key = 'mj.settings.v1';
        const cur = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(key, JSON.stringify({ ...cur, animations: false }));
      } catch {
        /* private mode */
      }
    });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/');
    await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({ timeout: 15_000 });
    await expect.poll(() => allRevealsSettled(page), { timeout: 2500 }).toBe(true);
    await page.waitForTimeout(800);
    const debug = await readMenuDebug(page);
    if (!debug) throw new Error('menu debug never published');
    expect(debug.reseeded).toBe(true);
    // The frozen portrait field is whatever fits whole in the hero band's
    // side margins, clear of the rack and every card — and nothing else:
    // a tile that could only show as a half-cut disc at the frame edge or
    // a sliver under the rack is parked (round-3 critic), which on a
    // 412 px phone usually means the frame shows the rack alone.
    const shown = shownTiles(debug);
    const online = await page.getByTestId('mode-online').boundingBox();
    if (!online) throw new Error('missing online card box');
    for (const t of shown) {
      expect(t.fade).toBeGreaterThanOrEqual(0.75);
      expect(t.y).toBeLessThan(online.y);
      // ≥ 70 % of the disc inside the frame (the disc over-bounds the tile).
      expect(t.x - 0.4 * t.r).toBeGreaterThanOrEqual(0);
      expect(t.x + 0.4 * t.r).toBeLessThanOrEqual(412);
    }
    expect(
      discsOver(shown, {
        x: debug.rack.x,
        y: debug.rack.y,
        width: debug.rack.w,
        height: debug.rack.h,
      }),
    ).toEqual([]);
    expect(shown.length + debug.parked).toBe(debug.visible);
    expect(errors()).toEqual([]);
  });

  for (const vp of [
    { name: 'phone', width: 412, height: 915 },
    { name: 'phone landscape', width: 915, height: 412 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    test(`replay shelf @ ${vp.name}: the tiles sit inside the canvas with air above and below`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/replays');
      await expect(page.getByTestId('replay-shelf-3d').locator('canvas')).toBeAttached({
        timeout: 15_000,
      });
      await page.waitForFunction(
        () =>
          (globalThis as { __MAHJONG_SHELF_DEBUG__?: ShelfDebug }).__MAHJONG_SHELF_DEBUG__
            ?.settled === true,
        null,
        { timeout: 15_000 },
      );
      const shelf = await readShelfDebug(page);
      if (!shelf) throw new Error('shelf debug never published');
      // Round-1 critic: the tile tops started on the very first canvas
      // row (the 東 glyph sliced) and the canvas was a 92 px strip. The
      // frame is now derived from the leaning tile's projected height.
      expect(shelf.top).toBeGreaterThanOrEqual(8);
      expect(shelf.bottom).toBeLessThanOrEqual(shelf.height - 8);
      expect(shelf.left).toBeGreaterThanOrEqual(4);
      expect(shelf.right).toBeLessThanOrEqual(shelf.width - 4);
      // Faces read square-on: the tiles are taller than they are wide.
      const tileH = shelf.bottom - shelf.top;
      const tileW = (shelf.right - shelf.left) / 7;
      expect(tileH).toBeGreaterThan(tileW * 1.05);
      expect(shelf.height).toBeGreaterThanOrEqual(100);
      // The card is a focal object, not a full-height slab: where the
      // page fits the viewport (portrait phone, desktop) the parlour
      // gradient shows under it. (Landscape phones scroll.)
      const card = await page.getByText('Nothing on the shelf yet').locator('..').boundingBox();
      if (!card) throw new Error('missing empty-state card');
      if (vp.height >= 600) expect(card.y + card.height).toBeLessThan(vp.height - 40);
      expect(errors()).toEqual([]);
    });
  }

  test('replay library: 3D shelf in the empty state, landscape header aligned to the chip', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.goto('/replays');
    await expect(page.getByRole('heading', { name: 'Replays' })).toBeVisible();
    // Empty state renders the tiles as a real scene, not classic art.
    await expect(page.getByTestId('replay-shelf-3d').locator('canvas')).toBeAttached({
      timeout: 15_000,
    });
    await expect(page.getByText('Nothing on the shelf yet')).toBeVisible();
    const perf = await readPerf(page);
    expect(perf.drawCalls).toBeLessThanOrEqual(MENU_BUDGET.drawCalls);
    expect(perf.triangles).toBeLessThan(10_000);
    // Import sits 12 px left of the FULLSCREEN chip instead of floating
    // mid-header (round-2 critic: a 145 px void).
    const imp = await page.getByRole('button', { name: 'Import replays' }).boundingBox();
    const chip = await page.getByRole('button', { name: 'Enter fullscreen' }).boundingBox();
    if (!imp || !chip) throw new Error('missing header boxes');
    const gap = chip.x - (imp.x + imp.width);
    expect(gap).toBeGreaterThanOrEqual(6);
    expect(gap).toBeLessThanOrEqual(28);
    // The lobby's landscape lesson sheet fades its trailing edge.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.getByRole('button', { name: 'Tutorial' }).click();
    await expect(page.getByTestId('lesson-basics')).toBeVisible();
    const mask = await page.getByTestId('lesson-rail').evaluate((el) => {
      const cs = getComputedStyle(el);
      return cs.maskImage || cs.webkitMaskImage || '';
    });
    expect(mask).toContain('linear-gradient');
    expect(errors()).toEqual([]);
  });

  test('page chrome: everything behind the app root is the void, including the strip a retracting URL bar exposes', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 412, height: 700 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({ timeout: 15_000 });

    // html / body and the theme-color meta are the void, not the cream
    // the classic shells paint (round-1 feedback: a cream band under the
    // lobby cards once Android Chrome's URL bar had retracted).
    const ground = await pageGround(page);
    expect(ground.html).toBe(VOID_RGB);
    expect(ground.body).toBe(VOID_RGB);
    expect(ground.themeColor?.toLowerCase()).not.toBe('#f1eadc');
    expect(ground.themeColor?.toLowerCase()).toBe('#0b120f');
    // The backdrop's gradient overshoots the root so a taller visual
    // viewport shows more void, not an edge.
    const backdrop = await page.getByTestId('lobby-backdrop-3d').boundingBox();
    if (!backdrop) throw new Error('missing backdrop box');
    expect(backdrop.y + backdrop.height).toBeGreaterThanOrEqual(700 + 100);

    // The URL bar retracts: the viewport grows by 100 px without a
    // reload. Every pixel along the new bottom 60 px is dark ground —
    // at the top of the page and scrolled to the very end.
    await page.setViewportSize({ width: 412, height: 800 });
    await page.waitForTimeout(600);
    const strip = { x: 0, y: 740, width: 412, height: 60 };
    const top = await sampleStrip(page, strip);
    expect(top.cream).toBe(0);
    expect(top.meanLum).toBeLessThan(70);
    await scrollLobbyTo(page, 10_000);
    await page.waitForTimeout(400);
    // The credits sit on the void in their own colour, above the strip.
    const credit = await page.getByText(/^Sound by/).boundingBox();
    if (!credit) throw new Error('missing footer credit');
    expect(credit.y + credit.height).toBeLessThanOrEqual(800);
    const bottom = await sampleStrip(page, strip);
    expect(bottom.cream).toBe(0);
    expect(bottom.meanLum).toBeLessThan(70);
    // The rack scrolled away with the title it is anchored to — it is
    // not sitting behind the glass cards that now fill the viewport
    // (round-1 feedback: an ivory ghost under the Online card's form).
    const scrolled = await readMenuDebug(page);
    const online = await page.getByTestId('mode-online').boundingBox();
    if (!scrolled?.band || !online) throw new Error('missing scrolled boxes');
    const bandNow = await page.getByTestId('hero-band').boundingBox();
    const heroCanvas = await page.getByTestId('menu-3d-hero').locator('canvas').boundingBox();
    if (!bandNow || !heroCanvas) throw new Error('missing hero band / canvas');
    expect(Math.abs(scrolled.band.y - bandNow.y)).toBeLessThan(1.5);
    expect(scrolled.rack.y + scrolled.rack.h).toBeLessThanOrEqual(online.y + 1.5);
    // The hero canvas itself is the band: it went with the title.
    expect(Math.abs(heroCanvas.y - bandNow.y)).toBeLessThan(1.5);
    expect(heroCanvas.y + heroCanvas.height).toBeLessThanOrEqual(online.y + 1.5);
    // The ground stays the void after the resize + scroll.
    expect((await pageGround(page)).body).toBe(VOID_RGB);
    expect(errors()).toEqual([]);
  });

  for (const vp of [
    { name: 'phone', width: 412, height: 700 },
    { name: 'phone-small', width: 360, height: 640 },
  ]) {
    test(`menu-scrolled @ ${vp.name}: the sticky app bar stays in the void while the rack scrolls under it`, async ({
      page,
    }) => {
      // Six scroll stops, one SwiftShader capture each (~1.5 s a piece).
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
      await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({
        timeout: 15_000,
      });
      await page.waitForFunction(
        () =>
          (globalThis as { __MAHJONG_MENU_INTRO__?: string }).__MAHJONG_MENU_INTRO__ === 'settled',
        null,
        { timeout: 8000 },
      );
      await expect(page.getByTestId('menu-3d-hero').locator('canvas')).toBeAttached({
        timeout: 15_000,
      });
      const bar = await page.getByTestId('lobby-app-bar').boundingBox();
      const chip = await page.getByText('麻', { exact: true }).boundingBox();
      if (!bar || !chip) throw new Error('missing app bar boxes');

      // The hero canvas is ScrollView content inside the hero band; the
      // drift field's canvas is not (it stays fixed behind the page).
      const where = await canvasAncestry(page);
      expect(where).toEqual({
        scroller: true,
        heroInScroller: true,
        heroInBand: true,
        driftInScroller: false,
      });
      const before = await readMenuDebug(page);
      if (!before) throw new Error('menu debug never published');
      expect(before.heroBuilds).toBe(1);
      const heroTop0 = (await scrollLobbyAndMeasure(page, 0)).heroTop;

      // The bar left of the brand chip (the chip is ivory by design);
      // `sampleBarGround` reads the padding rows above / below the pill.
      // Sampled with the canvas visible — this is the rack passing under
      // the bar's blur that turned it khaki (round-2 critic).
      const clip = { x: 0, y: bar.y, width: chip.x - 4, height: bar.height };
      let rackUnderBar = false;
      const seen: string[] = [];
      for (const offset of [0, 40, 80, 120, 160, 240]) {
        // Scroll and read back in one synchronous evaluate: the canvas
        // has already moved by exactly the scroll delta — no listener,
        // no rAF, no frame behind (round-3 feedback: the rack jittering
        // against the title on Android Chrome).
        const moved = await scrollLobbyAndMeasure(page, offset);
        // (The last stop may clamp at the end of a short lobby — the
        // delta the canvas must have moved by is the scroll achieved.)
        expect(moved.scrollTop).toBeGreaterThanOrEqual(Math.min(offset, 160));
        expect(moved.scrollTop).toBeLessThanOrEqual(offset);
        expect(Math.abs(heroTop0 - moved.heroTop - moved.scrollTop)).toBeLessThanOrEqual(0.5);
        // The debug seam reads the rack where the canvas now is.
        const d = await readMenuDebug(page);
        const slot = await page.getByTestId('hero-band').boundingBox();
        if (!d?.band || !d.rackGoal || !slot) throw new Error('missing scrolled rack boxes');
        expect(Math.abs(d.band.y - slot.y)).toBeLessThan(2);
        expect(Math.abs(d.rack.y - d.rackGoal.y)).toBeLessThan(2);
        if (d.rack.y < bar.y + bar.height && d.rack.y + d.rack.h > bar.y) rackUnderBar = true;
        const s = await sampleBarGround(page, clip);
        seen.push(`${offset}:${s.maxChannel}`);
        expect(
          s.maxChannel,
          `app bar ground at scroll ${offset} left the void: max channel ${s.maxChannel}`,
        ).toBeLessThanOrEqual(40);
        expect(s.cream).toBe(0);
      }
      // The probe means something: the rack really did pass under the bar.
      expect(rackUnderBar, `rack never reached the bar (${seen.join(' ')})`).toBe(true);
      test.info().annotations.push({ type: 'app-bar-probe', description: seen.join(' ') });
      // No scroll handler re-aimed the hero camera and nothing remounted
      // the scene: the view offset was applied at build + first size only.
      await page.waitForTimeout(300);
      const after = await readMenuDebug(page);
      if (!after) throw new Error('menu debug never published');
      expect(after.viewOffsetApplies).toBe(before.viewOffsetApplies);
      expect(after.viewOffsetApplies).toBeLessThanOrEqual(2);
      expect(after.heroBuilds).toBe(1);
      expect(errors()).toEqual([]);
    });
  }

  for (const vp of [
    { name: 'phone', width: 412, height: 700 },
    { name: 'phone-small', width: 360, height: 640 },
    { name: 'phone-tall', width: 412, height: 915 },
    { name: 'phone landscape', width: 915, height: 412 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    test(`hero @ ${vp.name}: the rack sits in the measured band under the title, clear of the copy and the first card`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
      await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({
        timeout: 15_000,
      });
      await page.waitForFunction(
        () =>
          (globalThis as { __MAHJONG_MENU_INTRO__?: string }).__MAHJONG_MENU_INTRO__ === 'settled',
        null,
        { timeout: 8000 },
      );
      // The scene fitted its layout to the DOM's hero band — which is
      // the hero canvas's own box…
      const bandBox = await page.getByTestId('hero-band').boundingBox();
      const canvasBox = await page.getByTestId('menu-3d-hero').locator('canvas').boundingBox();
      if (!bandBox || !canvasBox) throw new Error('missing hero band / canvas');
      expect(Math.abs(canvasBox.x - bandBox.x)).toBeLessThan(1.5);
      expect(Math.abs(canvasBox.y - bandBox.y)).toBeLessThan(1.5);
      expect(Math.abs(canvasBox.width - bandBox.width)).toBeLessThan(1.5);
      expect(Math.abs(canvasBox.height - bandBox.height)).toBeLessThan(1.5);
      // …and the live rack has eased onto the pure prediction (a late
      // font reflow re-fits it once more, so poll rather than read once).
      await expect
        .poll(
          async () => {
            const d = await readMenuDebug(page);
            if (!d?.band || !d.rackGoal) return Number.POSITIVE_INFINITY;
            return Math.max(
              Math.abs(d.rack.x - d.rackGoal.x),
              Math.abs(d.rack.y - d.rackGoal.y),
              Math.abs(d.rack.x + d.rack.w - (d.rackGoal.x + d.rackGoal.w)),
              Math.abs(d.rack.y + d.rack.h - (d.rackGoal.y + d.rackGoal.h)),
            );
          },
          { timeout: 6000 },
        )
        .toBeLessThan(3);
      const debug = await readMenuDebug(page);
      if (!debug?.band) throw new Error('menu debug never published a band');
      expect(Math.abs(debug.band.x - bandBox.x)).toBeLessThan(1.5);
      expect(Math.abs(debug.band.y - bandBox.y)).toBeLessThan(1.5);
      expect(Math.abs(debug.band.w - bandBox.width)).toBeLessThan(1.5);
      expect(Math.abs(debug.band.h - bandBox.height)).toBeLessThan(1.5);

      const rack = debug.rack;
      const title = await titleBoxes(page);
      // ≥ 16 px under the title block's last line and off every glyph.
      expect(rack.y).toBeGreaterThanOrEqual(title.bottom + 16 - 1.5);
      expect(intersects(rack, title.heading)).toBe(false);
      if (title.tagline) expect(intersects(rack, title.tagline)).toBe(false);
      // Inside the band the lobby reserved (8 px above its end).
      expect(rack.y + rack.h).toBeLessThanOrEqual(bandBox.y + bandBox.height - 8 + 1.5);
      expect(rack.x).toBeGreaterThanOrEqual(bandBox.x - 1.5);
      expect(rack.x + rack.w).toBeLessThanOrEqual(bandBox.x + bandBox.width + 1.5);
      // Clear of the first card: below the rack on portrait / desktop,
      // right of it on landscape phones.
      const online = await page.getByTestId('mode-online').boundingBox();
      if (!online) throw new Error('missing online card box');
      if (vp.width > vp.height && vp.height <= 480) {
        expect(rack.x + rack.w).toBeLessThanOrEqual(online.x + 1.5);
      } else {
        expect(rack.y + rack.h).toBeLessThanOrEqual(online.y + 1.5);
      }
      // Still a hero, not a thumbnail: the rack fills most of the band.
      expect(rack.h).toBeGreaterThan((bandBox.height - 24) * 0.6);
      expect(errors()).toEqual([]);
    });
  }

  test('classic renderer keeps the restyled lobby without a canvas', async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as { __MAHJONG_TEST_RENDERER__?: string }).__MAHJONG_TEST_RENDERER__ = 'classic';
    });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await expect(page.getByTestId('lobby-backdrop-classic')).toBeAttached();
    await expect(page.locator('canvas')).toHaveCount(0);
    // The DOM hero fan fills the band the 3D scene would otherwise own…
    await expect(page.getByTestId('hero-fan')).toBeAttached();
    // …and the page ground behind the dark lobby is the void under the
    // classic renderer too (the classic lobby is the same backdrop with
    // a DOM fan — cream would show at the URL-bar strip there as well).
    const ground = await pageGround(page);
    expect(ground.body).toBe(VOID_RGB);
    expect(ground.html).toBe(VOID_RGB);
    expect(ground.themeColor?.toLowerCase()).toBe('#0b120f');
    // The fan is centred in the same measured band as the 3D rack, so
    // it never runs under the title copy either.
    const title = await titleBoxes(page);
    const bandBox = await page.getByTestId('hero-band').boundingBox();
    if (!bandBox) throw new Error('missing hero band');
    const tiles = await page.getByTestId('hero-fan').evaluate((fan) =>
      Array.from(fan.children)
        .filter((c) => c.children.length > 0)
        .map((c) => {
          const r = (c.children[0] as HTMLElement).getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        }),
    );
    expect(tiles.length).toBeGreaterThanOrEqual(7);
    for (const t of tiles) {
      expect(t.y).toBeGreaterThanOrEqual(title.bottom + 8);
      expect(intersects(t, title.heading)).toBe(false);
      if (title.tagline) expect(intersects(t, title.tagline)).toBe(false);
      expect(t.y + t.h).toBeLessThanOrEqual(bandBox.y + bandBox.height);
    }
    // Only the classic match keeps its cream: the `/match` route (the
    // pre-game waiting room here) repaints html / body + theme-color.
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await expect(page.getByRole('button', { name: 'Start match' })).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(async () => (await pageGround(page)).body).toBe(CREAM_RGB);
    const match = await pageGround(page);
    expect(match.html).toBe(CREAM_RGB);
    expect(match.themeColor?.toLowerCase()).toBe('#f1eadc');
  });
});
