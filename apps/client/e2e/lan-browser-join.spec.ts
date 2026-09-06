import { chromium } from '@playwright/test';
import { expect, legacyInitScript, test } from './_helpers';

/** The static server's port — the same `PW_PORT` override
 *  playwright.config.ts honours, so a checkout running the suite on a
 *  non-default port still maps the fake LAN host onto its own server. */
const PW_PORT = Number(process.env.PW_PORT ?? 4173);

/**
 * End-to-end check for the "browser guest opens the host's URL"
 * flow added in PR #289. Validates the bundle-side inference logic
 * (`apps/client/app/match.tsx` → `joinLan(window.location.origin, …)`)
 * without needing a real second device: we launch a fresh chromium
 * with `--host-rules` so the browser sees a LAN-private hostname
 * while TCP-connecting to the dev `serve` running on 127.0.0.1:4173.
 *
 * When a guest paste the host-shared URL into their browser on the
 * same Wi-Fi, three things must happen:
 *
 *  1. The host's NanoHTTPD serves `/match?code=…` and falls back to
 *     `match.html` (or `index.html`) so the SPA shell loads. The
 *     dev `serve -s` mirrors that fallback, so navigating to a
 *     `/match?code=…` URL renders the Expo Router shell here.
 *  2. The SPA mounts `MatchRoute`, reads `params.code`, sees no
 *     `params.host`, detects we're on `web` from a LAN-private
 *     origin (`isLanOrigin()`), and calls
 *     `transport.joinLan(window.location.origin, params.code)`.
 *  3. The LAN transport opens a WebSocket to
 *     `ws://<lan-origin>/ws?matchCode=…&playerId=…&name=…`.
 *
 * We assert on the WS URL (step 3) — that's the strongest signal
 * the inference picked the LAN branch rather than the `joinOnline`
 * fallback (which would aim at the production Worker host).
 *
 * The connection will fail to upgrade (the dev `serve` doesn't
 * proxy `/ws` to anything), but the `websocket` event fires before
 * the handshake completes, so the URL we want is captured the
 * moment the bundle constructs the `WebSocket`.
 */
test('LAN-origin browser at /match?code=… infers host and opens LAN WS', async () => {
  // Fake LAN hostname matched by `isLanOrigin` (`^192\.168\.`). The
  // `--host-rules` chromium flag rewrites the TCP target to
  // 127.0.0.1:<PW_PORT> (the Playwright webServer) without changing what
  // `window.location.hostname` reports to the page — so the bundle
  // believes it's running from a real LAN host.
  const fakeLanHost = '192.168.42.99';
  const port = PW_PORT;

  const browser = await chromium.launch({
    args: [`--host-rules=MAP ${fakeLanHost}:${port} 127.0.0.1:${port}`],
  });

  try {
    const page = await browser.newPage();
    await page.addInitScript(legacyInitScript);

    const wsUrlPromise = new Promise<string>((resolve, reject) => {
      page.once('websocket', (ws) => resolve(ws.url()));
      setTimeout(() => reject(new Error('no websocket opened within 10s')), 10_000);
    });

    await page.goto(`http://${fakeLanHost}:${port}/match?code=TEST1`);

    const wsUrl = await wsUrlPromise;

    // The LAN transport (`createLanTransport`) upgrades the host
    // URL to ws:// and appends `/ws?matchCode=…&playerId=…&name=…`.
    // We assert on the origin (proves the inference chose
    // `joinLan(window.location.origin, …)` rather than the online
    // fallback) and the match-code query param (proves the URL's
    // `?code=` made it through).
    expect(wsUrl).toContain(`ws://${fakeLanHost}:${port}/ws`);
    expect(wsUrl).toContain('matchCode=TEST1');
  } finally {
    await browser.close();
  }
});

/**
 * Companion negative: a LAN-private hostname *without* `?code=` should
 * stay on the stranded "No active match" recovery screen — the
 * inference only kicks in when there's a real code in the URL. We
 * don't want a browser guest who accidentally visits the host's root
 * URL to be silently auto-joined to a non-existent match.
 */
test('LAN-origin browser at bare /match with no code shows the stranded screen', async () => {
  const fakeLanHost = '192.168.42.99';
  const port = PW_PORT;

  const browser = await chromium.launch({
    args: [`--host-rules=MAP ${fakeLanHost}:${port} 127.0.0.1:${port}`],
  });

  try {
    const page = await browser.newPage();
    await page.addInitScript(legacyInitScript);
    await page.goto(`http://${fakeLanHost}:${port}/match`);
    await expect(page.getByRole('heading', { name: 'No active match' })).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await browser.close();
  }
});
