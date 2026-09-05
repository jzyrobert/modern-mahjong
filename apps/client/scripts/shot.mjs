#!/usr/bin/env node
/**
 * Headless screenshot + telemetry verifier — the only accepted evidence
 * of a visual claim in this repo (ARCHITECTURE.md §6).
 *
 *   node scripts/shot.mjs --state match-my-turn [--state menu ...]
 *        [--all] [--owner table] [--renderer 3d|classic]
 *        [--viewport phone|phone-tall|phone-small|phone-landscape|tablet|desktop] [--dist dist]
 *        [--out shots/<label>] [--label round1] [--port 0]
 *        [--seed 5] [--headed]
 *   SHOT_TIMEOUT_SCALE=3 stretches every step timeout (shared / loaded CPU).
 *
 * For every state it writes `<out>/<state>.<viewport>.<renderer>.png`
 * and a sibling `.json` with console errors, page errors, perf
 * (`__MAHJONG_PERF__`), and a budget verdict. Exit code is 1 when any
 * state failed to drive, logged an error, or blew its budget — so it
 * can gate a CI job or an agent's "done".
 *
 * Runs on Playwright's bundled Chromium with SwiftShader GL. GPU frame
 * time there is not the phone number — the budget gates on CPU-side,
 * device-independent metrics (draw calls, triangles, programs, JS
 * frame time) and records fps for trend only.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { BUDGETS, DEFAULT_SEED, STATES, VIEWPORTS } from './shot-states.mjs';

/**
 * Multiplies every step timeout. The verifier runs on SwiftShader and,
 * in the agent sandboxes, on a CPU shared with sibling worktrees' e2e
 * runs: at a load average of 25 on four cores a `Start match` click can
 * outlive the recipes' 20 s budgets while nothing is wrong with the
 * page. `SHOT_TIMEOUT_SCALE=3 node scripts/shot.mjs …` stretches the
 * waits instead of failing the drive; the PNG + perf are unaffected.
 */
const TIMEOUT_SCALE = Math.max(1, Number(process.env.SHOT_TIMEOUT_SCALE ?? 1) || 1);
const scaled = (ms) => Math.round(ms * TIMEOUT_SCALE);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    states: [],
    renderer: '3d',
    viewport: 'phone',
    dist: 'dist',
    out: null,
    label: null,
    port: 0,
    seed: DEFAULT_SEED,
    headed: false,
    all: false,
    owner: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--state') out.states.push(next());
    else if (a === '--all') out.all = true;
    else if (a === '--owner') out.owner = next();
    else if (a === '--renderer') out.renderer = next();
    else if (a === '--viewport') out.viewport = next();
    else if (a === '--dist') out.dist = next();
    else if (a === '--out') out.out = next();
    else if (a === '--label') out.label = next();
    else if (a === '--port') out.port = Number(next());
    else if (a === '--seed') out.seed = Number(next());
    else if (a === '--headed') out.headed = true;
    else if (a === '--json') out.json = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        `states: ${Object.keys(STATES).join(', ')}\nviewports: ${Object.keys(VIEWPORTS).join(', ')}`,
      );
      process.exit(0);
    }
  }
  if (out.all) out.states = Object.keys(STATES).filter((k) => !STATES[k].optional);
  if (out.owner)
    out.states = Object.keys(STATES).filter(
      (k) => STATES[k].owner === out.owner && !STATES[k].optional,
    );
  if (out.states.length === 0)
    throw new Error('no --state given (use --all, --owner <name>, or --help)');
  out.out =
    out.out ??
    path.join(clientRoot, 'shots', out.label ?? new Date().toISOString().replace(/[:.]/g, '-'));
  return out;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function serveDist(distDir, port) {
  const distAbs = path.resolve(clientRoot, distDir);
  if (!existsSync(path.join(distAbs, 'index.html'))) {
    throw new Error(
      `no export at ${distAbs} — run \`npx expo export --platform web --output-dir ${distDir}\` first`,
    );
  }
  // Detached so the whole `npx → serve` process group can be killed at
  // teardown; otherwise the grandchild keeps the event loop alive.
  const child = spawn('npx', ['serve', distAbs, '-l', String(port), '-s', '-n'], {
    stdio: 'ignore',
    cwd: clientRoot,
    detached: true,
  });
  child.unref();
  const stderr = '';
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return { child, url };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  killTree(child);
  throw new Error(`static server never came up on ${url}\n${stderr}`);
}

function killTree(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

function chromiumExecutable() {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  const candidates = ['/opt/pw-browsers/chromium'];
  for (const c of candidates) if (existsSync(c)) return c;
  return undefined;
}

const PAGE_HELPERS = `
(() => {
  const g = globalThis;
  g.__MAHJONG_SHOT__ = {
    getState() { return g.__MAHJONG_TEST_GET_STATE__ ? g.__MAHJONG_TEST_GET_STATE__() : null; },
    setSettings(patch) {
      const s = this.getState();
      if (!s) throw new Error('store not ready');
      s.setSettings(patch);
    },
  };
})();
`;

async function runStep(page, step, ctx) {
  if (step.goto)
    return page.goto(step.goto.startsWith('http') ? step.goto : ctx.baseUrl + step.goto, {
      waitUntil: 'domcontentloaded',
    });
  if (step.click)
    return page
      .locator(step.click)
      .first()
      .click({ timeout: scaled(step.timeout ?? 10_000) });
  if (step.clickTestId)
    return page
      .getByTestId(step.clickTestId)
      .nth(step.nth ?? 0)
      .click({ timeout: scaled(step.timeout ?? 10_000) });
  if (step.dragTestId) {
    // Pointer drag between two targets sharing a test id: press on the
    // `from`-th, glide to the `to`-th's centre (offset by `dx` / `dy`
    // CSS px) and, with `hold`, leave the button down so the shot
    // captures the mid-drag frame (the lifted tile under the pointer,
    // the others re-flowed). Without `hold` the pointer is released.
    const targets = page.getByTestId(step.dragTestId);
    const a = await targets.nth(step.from ?? 0).boundingBox({ timeout: scaled(step.timeout ?? 10_000) });
    const b = await targets.nth(step.to ?? 0).boundingBox({ timeout: scaled(step.timeout ?? 10_000) });
    if (!a || !b) throw new Error(`dragTestId: ${step.dragTestId} target not visible`);
    const x0 = a.x + a.width / 2;
    const y0 = a.y + a.height / 2;
    const x1 = b.x + b.width / 2 + (step.dx ?? 0);
    const y1 = b.y + b.height / 2 + (step.dy ?? 0);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 8, y0, { steps: 2 });
    await page.mouse.move(x1, y1, { steps: step.steps ?? 12 });
    if (!step.hold) await page.mouse.up();
    return;
  }
  if (step.waitFor)
    return page
      .locator(step.waitFor)
      .first()
      .waitFor({ state: step.state ?? 'visible', timeout: scaled(step.timeout ?? 15_000) });
  if (step.waitForText)
    return page
      .getByText(step.waitForText, { exact: false })
      .first()
      .waitFor({ timeout: scaled(step.timeout ?? 15_000) });
  if (step.waitMs) return page.waitForTimeout(step.waitMs);
  if (step.evaluate) return page.evaluate(step.evaluate);
  if (step.waitForFunction)
    return page.waitForFunction(step.waitForFunction, null, {
      timeout: scaled(step.timeout ?? 15_000),
      polling: 100,
    });
  if (step.waitForSettled) {
    // Every element matching the selector has finished its CSS
    // animations / transitions and is fully opaque — i.e. an entrance
    // stagger (`Reveal`) is over. Passes trivially when nothing matches.
    return page.waitForFunction(
      (sel) => {
        const els = Array.from(document.querySelectorAll(sel));
        return els.every((el) => {
          const anims = typeof el.getAnimations === 'function' ? el.getAnimations() : [];
          const running = anims.some((a) => a.playState === 'running' || a.playState === 'pending');
          return !running && getComputedStyle(el).opacity === '1';
        });
      },
      step.waitForSettled,
      { timeout: scaled(step.timeout ?? 15_000), polling: 100 },
    );
  }
  if (step.initScript) {
    // Runs before every navigation in this page — for globals the app
    // reads at boot (debug recipes, test seams). Order it before `goto`.
    return page.addInitScript(step.initScript);
  }
  if (step.setSettings) {
    // Settings must be in localStorage before the app boots so the
    // renderer + skins pick them up on first render.
    return page.addInitScript((patch) => {
      try {
        const key = 'mj.settings.v1';
        const cur = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(key, JSON.stringify({ ...cur, ...patch }));
      } catch {}
    }, step.setSettings);
  }
  if (step.dismissDice) {
    // The root-level DiceCeremony overlay covers the table after
    // `Start match`; tap it away so the shot shows the scene.
    // Tap the viewport rather than the hint element: the ceremony
    // auto-dismisses after a beat and a detached element makes
    // `locator.click` retry until it times out.
    // `isVisible` does not wait, so give the modal a moment to mount
    // (a software rasteriser can take seconds to paint the first frame
    // of the match) before deciding it is not there.
    const hint = page.getByText('Tap anywhere to dismiss', { exact: true });
    await hint.waitFor({ timeout: scaled(step.timeout ?? 6000) }).catch(() => {});
    if (await hint.isVisible().catch(() => false)) {
      const vp = page.viewportSize() ?? { width: 412, height: 700 };
      await page.mouse.click(vp.width / 2, vp.height / 2).catch(() => {});
      await hint.waitFor({ state: 'hidden', timeout: scaled(5000) }).catch(() => {});
    }
    return;
  }
  if (step.waitForOwnHand)
    return page
      .getByTestId('own-hand-tile')
      .first()
      .waitFor({ timeout: scaled(step.timeout ?? 20_000) });
  if (step.waitForDrawCue) {
    // Mirrors e2e/_helpers.ts waitForUserDrawCue: pass incidental claims.
    const start = Date.now();
    while (Date.now() - start < scaled(step.timeout ?? 30_000)) {
      if (
        await page
          .getByTestId('wall-draw-next')
          .first()
          .isVisible()
          .catch(() => false)
      )
        return;
      // An incidental claim window (any shell, any strip density): pass.
      const pass = page.getByRole('button', { name: 'Pass' }).first();
      if (await pass.isVisible().catch(() => false)) {
        await pass.click({ timeout: scaled(2000) }).catch(() => {});
      }
      await page.waitForTimeout(250);
    }
    throw new Error('draw cue never appeared');
  }
  if (step.playTurns) {
    for (let i = 0; i < step.playTurns; i++) {
      await runStep(page, { waitForDrawCue: true }, ctx).catch(() => {});
      await page
        .getByTestId('wall-draw-next')
        .first()
        .click({ timeout: scaled(5000) })
        .catch(() => {});
      await page.waitForTimeout(350);
      await page
        .getByTestId('own-hand-tile')
        .first()
        .click({ timeout: scaled(5000) })
        .catch(() => {});
      await page.waitForTimeout(350);
    }
    return;
  }
  if (step.openSettings) {
    // Every shell exposes `data-testid="open-settings"` — directly in
    // the 3D HUD, or inside the ☰ menu on the classic shells. Try the
    // direct entry first, then open the menu (aria-label "Open menu"
    // on the classic TopBar / MenuPill) and pick the row.
    const direct = page.locator('[data-testid="open-settings"]').first();
    if (await direct.isVisible().catch(() => false)) {
      await direct.click();
    } else {
      const menuTriggers = [
        '[data-testid="open-menu"]',
        '[aria-label="Open menu"]',
        'role=button[name="Open menu"]',
        '[data-testid="menu-pill"]',
      ];
      let opened = false;
      for (const sel of menuTriggers) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) {
          await loc.click();
          opened = true;
          break;
        }
      }
      if (!opened) throw new Error('no settings entry found');
      const row = page
        .locator('[data-testid="open-settings"]')
        .or(page.getByRole('button', { name: 'Settings' }))
        .first();
      await row.click({ timeout: scaled(step.timeout ?? 8000) });
    }
    // The panel is open once its title is on screen.
    return page
      .getByText('Settings', { exact: true })
      .first()
      .waitFor({ timeout: scaled(step.timeout ?? 8000) });
  }
  if (step.startTutorial) {
    return page.evaluate((id) => {
      const btn = [
        ...document.querySelectorAll('[data-testid^="lesson-"], button, [role="button"]'),
      ].find((el) => (el.getAttribute('data-testid') || '') === `lesson-${id}`);
      if (btn) {
        btn.click();
        return;
      }
      // Fallback: the lobby exposes the transport via the tutorial store hook.
      const t = globalThis.__MAHJONG_TEST_START_TUTORIAL__;
      if (!t) throw new Error(`no tutorial entry for ${id}`);
      t(id);
    }, step.startTutorial);
  }
  if (step.clickTutorialNext) {
    // The coach-mark CTA carries `tutorial-next`; fall back to the
    // accessible names for an overlay that predates the testID.
    const byId = page.getByTestId('tutorial-next').first();
    if (await byId.isVisible({ timeout: scaled(4000) }).catch(() => false))
      return byId.click({ timeout: scaled(8000) });
    return page
      .getByRole('button', { name: /^(Got it|Next|Done)$/ })
      .first()
      .click({ timeout: scaled(8000) });
  }
  if (step.waitForPerf) {
    // Resolves to 'stale' (recorded as `perfStale` in the log) instead
    // of silently continuing when the snapshot never advances — a
    // "sample: 1, renders: 0" snapshot must not pass as fresh telemetry.
    return page
      .waitForFunction(() => (globalThis.__MAHJONG_PERF__?.sample ?? 0) >= 2, null, {
        timeout: scaled(8000),
      })
      .then(() => 'fresh')
      .catch(() => 'stale');
  }
  throw new Error(`unknown step ${JSON.stringify(step)}`);
}

function judgeBudget(perf, budget, renderer, recipe) {
  const violations = [];
  if (renderer !== '3d')
    return { pass: true, violations, note: 'classic renderer — no WebGL budget' };
  if (recipe?.noScene || recipe?.scene === false)
    return {
      pass: true,
      violations,
      note: 'state renders no WebGL scene (classic DOM view) — budget not applicable',
    };
  if (!perf)
    return {
      pass: false,
      violations: ['__MAHJONG_PERF__ never published — is the 3D scene mounted?'],
    };
  if (perf.drawCalls > budget.drawCalls)
    violations.push(`drawCalls ${perf.drawCalls} > ${budget.drawCalls}`);
  if (perf.triangles > budget.triangles)
    violations.push(`triangles ${perf.triangles} > ${budget.triangles}`);
  if (perf.programs > budget.programs)
    violations.push(`programs ${perf.programs} > ${budget.programs}`);
  if (perf.textures > budget.textures)
    violations.push(`textures ${perf.textures} > ${budget.textures}`);
  if (perf.frameMsP95 > budget.frameMsP95 * 3)
    violations.push(
      `frameMsP95 ${perf.frameMsP95} > ${budget.frameMsP95 * 3} (SwiftShader-adjusted ×3)`,
    );
  return { pass: violations.length === 0, violations };
}

/** Orientation class of a named viewport: portrait phones interchange, so do landscape ones. */
function orientationClass(name) {
  const vp = VIEWPORTS[name];
  if (!vp) return name;
  if (!vp.mobile) return 'wide';
  return vp.width > vp.height ? 'phone-landscape' : 'phone-portrait';
}

async function shootState(browser, name, recipe, opts, ctx) {
  // A recipe may pin its own viewport (`viewport: 'phone-landscape'` or
  // `{ width, height, dpr }`) so orientation-specific states are checked
  // whichever CLI viewport the run uses.
  // A named pin only fixes the *orientation class*: a CLI viewport of the
  // same class (phone → phone-tall / phone-small) wins, so the portrait
  // recipes shoot at whichever phone size the run asks for.
  const pinned =
    typeof recipe.viewport === 'string' &&
    orientationClass(recipe.viewport) === orientationClass(opts.viewport)
      ? opts.viewport
      : recipe.viewport;
  const vpName = typeof pinned === 'string' ? pinned : pinned ? 'custom' : opts.viewport;
  const vp = typeof pinned === 'string' ? VIEWPORTS[pinned] : (pinned ?? VIEWPORTS[opts.viewport]);
  if (!vp) throw new Error(`unknown recipe viewport ${recipe.viewport}`);
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.addInitScript(
    ({ renderer, seed }) => {
      const g = globalThis;
      g.__MAHJONG_TEST_RENDERER__ = renderer;
      g.__MAHJONG_TEST_SEED__ = seed;
      g.__MAHJONG_TEST_BOT_PACE_MS__ = 120;
      g.__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = 0;
    },
    { renderer: opts.renderer, seed: opts.seed },
  );
  await page.addInitScript(PAGE_HELPERS);
  page.on('console', (m) => {
    const t = m.type();
    const text = m.text();
    if (t === 'error') consoleErrors.push(text);
    else if (t === 'warning') consoleWarnings.push(text);
  });
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)));
  page.on('requestfailed', (r) =>
    consoleErrors.push(`requestfailed ${r.url()} ${r.failure()?.errorText ?? ''}`),
  );

  const started = Date.now();
  let driveError = null;
  let perfStale = false;
  try {
    for (const step of recipe.steps) {
      if (opts.verbose) console.error(`  [${name}] ${JSON.stringify(step).slice(0, 80)}`);
      const r = await runStep(page, step, ctx);
      if (step.waitForPerf && r === 'stale') perfStale = true;
    }
    if (opts.renderer === '3d' && !recipe.noScene) {
      perfStale = (await runStep(page, { waitForPerf: true }, ctx)) === 'stale';
    }
  } catch (e) {
    driveError = String(e?.message || e).split('\n')[0];
  }
  const perf = await page.evaluate(() => globalThis.__MAHJONG_PERF__ ?? null).catch(() => null);
  const base = `${name}.${vpName}.${opts.renderer}`;
  const png = path.join(opts.out, `${base}.png`);
  await page
    .screenshot({ path: png, fullPage: false })
    .catch((e) => pageErrors.push(`screenshot failed: ${e.message}`));
  const budget = judgeBudget(
    perf,
    recipe.budget ?? BUDGETS[recipe.owner] ?? BUDGETS.table,
    opts.renderer,
    recipe,
  );
  const log = {
    state: name,
    owner: recipe.owner,
    renderer: opts.renderer,
    viewport: { ...vp, name: vpName },
    url: page.url(),
    driveMs: Date.now() - started,
    driveError,
    consoleErrors,
    consoleWarnings: consoleWarnings.slice(0, 20),
    pageErrors,
    perf,
    /** True when `__MAHJONG_PERF__` never advanced past its first sample. */
    perfStale,
    budget,
    pass: !driveError && consoleErrors.length === 0 && pageErrors.length === 0 && budget.pass,
    png: path.relative(clientRoot, png),
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(opts.out, `${base}.json`), JSON.stringify(log, null, 2));
  await context.close();
  return log;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!VIEWPORTS[opts.viewport]) throw new Error(`unknown viewport ${opts.viewport}`);
  mkdirSync(opts.out, { recursive: true });
  const port = opts.port || (await freePort());
  const server = await serveDist(opts.dist, port);
  const browser = await chromium.launch({
    headless: !opts.headed,
    executablePath: chromiumExecutable(),
    args: [
      '--no-sandbox',
      // Dev containers route egress through an agent proxy via env vars;
      // Chrome must talk to the local static server directly.
      '--proxy-server=direct://',
      '--proxy-bypass-list=*',
      '--disable-background-networking',
      '--no-first-run',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
    ],
  });
  const results = [];
  try {
    for (const name of opts.states) {
      const recipe = STATES[name];
      if (!recipe) {
        console.error(`unknown state ${name}`);
        process.exitCode = 1;
        continue;
      }
      const log = await shootState(browser, name, recipe, opts, { baseUrl: server.url });
      results.push(log);
      const flag = log.pass ? 'PASS' : 'FAIL';
      const perf = log.perf
        ? `calls=${log.perf.drawCalls} tris=${log.perf.triangles} prog=${log.perf.programs} p95=${log.perf.frameMsP95}ms fps=${log.perf.fps}`
        : 'perf=n/a';
      console.log(
        `${flag} ${name} [${opts.viewport}/${opts.renderer}] ${perf} errors=${log.consoleErrors.length + log.pageErrors.length}${log.driveError ? ` drive: ${log.driveError}` : ''}${log.budget.violations.length ? ` budget: ${log.budget.violations.join('; ')}` : ''} → ${log.png}`,
      );
    }
  } finally {
    await browser.close();
    killTree(server.child);
  }
  const summary = {
    label: opts.label,
    renderer: opts.renderer,
    viewport: opts.viewport,
    dist: opts.dist,
    results: results.map((r) => ({
      state: r.state,
      pass: r.pass,
      png: r.png,
      errors: r.consoleErrors.length + r.pageErrors.length,
      driveError: r.driveError,
      perf: r.perf && {
        drawCalls: r.perf.drawCalls,
        triangles: r.perf.triangles,
        programs: r.perf.programs,
        frameMsP95: r.perf.frameMsP95,
        fps: r.perf.fps,
      },
      violations: r.budget.violations,
    })),
  };
  writeFileSync(path.join(opts.out, 'summary.json'), JSON.stringify(summary, null, 2));
  if (opts.json) console.log(JSON.stringify(summary));
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
