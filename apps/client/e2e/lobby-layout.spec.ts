import { expect, test } from './_helpers';

/**
 * The classic hero fan (`ScatteredTiles`) is centred in the hero band
 * the lobby measures under its title block (`HeroBandSlot`), so no
 * tile may reach the heading or the tagline (round-1 feedback: the
 * tagline ran across the tile tops on a phone).
 */
async function expectFanClearOfTitle(page: import('@playwright/test').Page): Promise<void> {
  const heading = await page.getByRole('heading', { name: 'Modern Mahjong' }).boundingBox();
  const tagline = await page.getByText(/^136 tiles/).boundingBox();
  if (!heading || !tagline) throw new Error('missing title boxes');
  const titleBottom = Math.max(heading.y + heading.height, tagline.y + tagline.height);
  await expect(page.getByTestId('hero-fan')).toBeAttached();
  const tiles = await page.getByTestId('hero-fan').evaluate((fan) =>
    Array.from(fan.children)
      .filter((c) => c.children.length > 0)
      .map((c) => (c.children[0] as HTMLElement).getBoundingClientRect().top),
  );
  expect(tiles.length).toBeGreaterThanOrEqual(7);
  for (const top of tiles) expect(top).toBeGreaterThanOrEqual(titleBottom + 8);
}

// Phone-width lobby uses `MobileLobby`'s app-bar + collapsed-row
// layout (see `apps/client/src/ui/menu/MobileLobby.tsx`). At this
// width Online + Practice are full-width primary cards and
// Tutorial / LAN / Replays render as tappable secondary rows. The
// regression here is just "no overlap, every row gets the full
// content width" — the old #85 column-direction overlap bug stays
// covered, the new app-bar-led structure is what we're asserting.
test.describe('Lobby mode cards', () => {
  test('phone-width lobby stacks every row without overlap', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    // Every visible row in the mobile lobby (two primary cards +
    // three secondary rows). `Practice vs bots` is a primary card
    // even though the subtitle is shorter than its desktop sibling.
    const rowNames = [
      /^Online match$/,
      /^Practice vs bots$/,
      /^Tutorial$/,
      /^LAN \/ offline$/,
      /^Replays$/,
    ] as const;
    const rows = await Promise.all(
      rowNames.map(async (name) => {
        const heading = page.getByText(name, { exact: true }).first();
        await expect(heading).toBeVisible();
        // Walk up to the nearest ancestor with a 12px border radius
        // — that's the PrimaryModeCard / SecondaryRow chrome on
        // mobile. (Desktop uses 16px; selecting 12px guarantees we
        // grab the mobile lobby's wrapper.)
        const handle = await heading
          .locator(
            'xpath=ancestor::*[contains(@style, "border-radius: 12px") or contains(@style, "border-radius:12px")][1]',
          )
          .first()
          .boundingBox();
        if (!handle) throw new Error(`No bounding box for row "${name}"`);
        return { name: name.source, ...handle };
      }),
    );

    // Stack order: each row begins at-or-below the previous row's
    // bottom edge. A column-direction overlap bug would surface as
    // a strict negative gap here.
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      if (!prev || !curr) throw new Error('rows array unexpectedly sparse');
      expect(
        curr.y,
        `Row "${curr.name}" (y=${curr.y}) overlaps row "${prev.name}" (bottom=${prev.y + prev.height})`,
      ).toBeGreaterThanOrEqual(prev.y + prev.height - 1);
    }

    // Each row spans (close to) the full content column. The mobile
    // page padding is 12 px on each side, leaving 388 px of content
    // width at viewport 412. A column-direction overlap bug would
    // shrink rows well below this.
    for (const row of rows) {
      expect(row.width, `Row "${row.name}" too narrow (${row.width}px)`).toBeGreaterThan(320);
    }

    await expectFanClearOfTitle(page);
  });

  test('cards lay out in rows at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    // The five cards (Online / Practice / Tutorial / LAN / Replays)
    // wrap into multiple rows on a 1280-wide viewport — `ModeGrid`
    // caps at maxWidth: 1080 with 28px side padding, leaving ~1024px
    // of content row, and each card's min-width is 280 + 14 gap, so
    // three cards fit per row. We assert the responsive contract
    // qualitatively: every card has a positive bounding box, and
    // the first three (Online / Practice / Tutorial) share the same
    // top row.
    const ys = await Promise.all(
      [/^Online match$/, /^Practice vs bots$/, /^Tutorial$/, /^LAN \/ offline$/, /^Replays$/].map(
        async (name) => {
          const heading = page.getByText(name, { exact: true }).first();
          const box = await heading.boundingBox();
          if (!box) throw new Error(`No bounding box for "${name}"`);
          return box.y;
        },
      ),
    );

    const [online, practice, tutorial] = ys;
    if (online === undefined || practice === undefined || tutorial === undefined) {
      throw new Error('expected card y-coordinates for the first row');
    }
    // Top row of three cards shares (close to) the same baseline y.
    expect(Math.abs(online - practice)).toBeLessThan(8);
    expect(Math.abs(practice - tutorial)).toBeLessThan(8);

    await expectFanClearOfTitle(page);
  });
});
