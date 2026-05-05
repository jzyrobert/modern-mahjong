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

  test('three cards fit in a row at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    const ys = await Promise.all(
      [/^Online match$/, /^Practice vs bots$/, /^LAN \/ offline$/].map(async (name) => {
        const heading = page.getByText(name, { exact: true }).first();
        const box = await heading.boundingBox();
        if (!box) throw new Error(`No bounding box for "${name}"`);
        return box.y;
      }),
    );

    // All three card titles share (close to) the same baseline y.
    const [a, b, c] = ys;
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error('expected three card y-coordinates');
    }
    expect(Math.abs(a - b)).toBeLessThan(8);
    expect(Math.abs(b - c)).toBeLessThan(8);
  });
});
