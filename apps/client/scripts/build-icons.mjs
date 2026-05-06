// Rasterise the felt-tile app icon from `assets/icon-source.svg` into the
// PNGs Expo's `app.json` references:
//
//   - assets/icon.png            1024 × 1024 — iOS / fallback / web
//   - assets/adaptive-icon.png   1024 × 1024 — Android adaptive foreground
//                                              (tile + glyph only,
//                                              transparent background)
//   - assets/favicon.png         192 × 192   — web favicon
//   - assets/splash.png          1242 × 1242 — splash hero (uses cover)
//
// The source SVG uses `oklch()` colors which only render in modern
// Chromium. We launch the bundled Playwright Chromium, navigate to a
// data: URL containing each variant, and screenshot at 1× device scale.
// Re-run with `node apps/client/scripts/build-icons.mjs` whenever
// `assets/icon-source.svg` changes.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = fileURLToPath(new URL('.', import.meta.url));
const ASSETS = resolve(here, '..', 'assets');
const SOURCE = resolve(ASSETS, 'icon-source.svg');

const fullSvg = readFileSync(SOURCE, 'utf8');

// Adaptive icon foreground = original SVG minus the felt background
// rect + gold ring (the ring at r=380 lies outside the 432-radius safe
// zone, so any device mask would clip it inconsistently). The tile +
// glyph fits inside the 66% safe area as designed.
const fgSvg = fullSvg
  .replace(/<rect[^>]*fill="url\(#bg\)"[^>]*><\/rect>/, '')
  .replace(/<circle[^>]*stroke="oklch\(0\.78[^>]*><\/circle>/, '');

async function rasterise(svg, { width, height, out }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  // Strip any pre-existing `width` / `height` attributes on the root
  // <svg> so our target size sticks (the source SVG hardcodes
  // `width="1024" height="1024"` for handoff convenience). Duplicate
  // attrs make the first declaration win in HTML, so without this
  // strip the screenshot caps out at 1024 and the favicon would only
  // capture the top-left 192 px corner of an oversized canvas.
  const sized = svg.replace(/<svg([^>]*?)>/, (_, attrs) => {
    const cleaned = attrs.replace(/\s(?:width|height)="[^"]*"/g, '');
    return `<svg${cleaned} width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet">`;
  });
  const html = `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style></head><body>${sized}</body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  // Give CJK font fallback time to settle.
  await page.waitForTimeout(200);
  const buf = await page.screenshot({ type: 'png', omitBackground: true });
  writeFileSync(out, buf);
  await browser.close();
  console.log('wrote', out);
}

await rasterise(fullSvg, { width: 1024, height: 1024, out: resolve(ASSETS, 'icon.png') });
await rasterise(fgSvg, { width: 1024, height: 1024, out: resolve(ASSETS, 'adaptive-icon.png') });
await rasterise(fullSvg, { width: 192, height: 192, out: resolve(ASSETS, 'favicon.png') });
await rasterise(fullSvg, { width: 1242, height: 1242, out: resolve(ASSETS, 'splash.png') });
