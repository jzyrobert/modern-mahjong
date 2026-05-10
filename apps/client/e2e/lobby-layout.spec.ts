import { expect, test } from '@playwright/test';

// Regression for the portrait-mobile lobby. The original `ModeGrid`
// switched to `flex-direction: column` while keeping `flex-wrap: wrap`
// + `flex-basis: 0` + `min-width: 280` on each card, which produced
// overlapping cards on narrow viewports — the headers stacked at the
// top and the bodies stacked below them, with the buttons floating
// over each other (#85 follow-up). The layout now uses row+wrap with
// each card growing to fill the row, so on a phone-width viewport
// every card is its own full-width row.
test.describe('Lobby mode cards', () => {
  test('do not overlap at portrait phone width', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    const cards = await Promise.all(
      [/^Online match$/, /^Practice vs bots$/, /^LAN \/ offline$/].map(async (name) => {
        const heading = page.getByText(name, { exact: true }).first();
        await expect(heading).toBeVisible();
        // Each "card" is the View ancestor with the cream background +
        // rounded corners. Walk up four levels to reach the ModeCard
        // wrapper; that's deep enough to clear the title-row containers.
        // The exact ancestor depth doesn't matter for the assertion —
        // we only need a stable rectangle that bounds the whole card.
        const handle = await heading
          .locator(
            'xpath=ancestor::*[contains(@style, "border-radius: 16px") or contains(@style, "border-radius:16px")][1]',
          )
          .first()
          .boundingBox();
        if (!handle) throw new Error(`No bounding box for card "${name}"`);
        return { name: name.source, ...handle };
      }),
    );

    // Stack order: y values strictly increase, and each card starts
    // at-or-below the previous card's bottom edge (no overlap).
    for (let i = 1; i < cards.length; i++) {
      const prev = cards[i - 1];
      const curr = cards[i];
      if (!prev || !curr) throw new Error('cards array unexpectedly sparse');
      expect(
        curr.y,
        `Card "${curr.name}" (y=${curr.y}) overlaps card "${prev.name}" (bottom=${prev.y + prev.height})`,
      ).toBeGreaterThanOrEqual(prev.y + prev.height - 1);
    }

    // Each card spans (close to) the full content column. Container is
    // 412px viewport - 28*2 padding = 356; cards should be at least 320
    // wide. A column-direction overlap bug shrinks them well below this.
    for (const card of cards) {
      expect(card.width, `Card "${card.name}" too narrow (${card.width}px)`).toBeGreaterThan(320);
    }
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
  });
});
