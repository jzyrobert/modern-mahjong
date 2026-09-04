import { describe, expect, test } from 'vitest';
import {
  CHROME_MAX_HEIGHT,
  OVERLAY_ATTR,
  TARGET_ATTR,
  chromeSignature,
  collectChromeRects,
  findFocusRect,
  isChromeCandidate,
} from './chromeRects';

const phone = { width: 412, height: 915 };

describe('isChromeCandidate', () => {
  const rect = { left: 20, top: 780, width: 140, height: 26 };

  test('controls of chrome size count', () => {
    expect(isChromeCandidate({ rect, control: true, text: null }, phone)).toBe(true);
  });

  test('regions taller than a control row or nearly full-width are not chrome', () => {
    expect(
      isChromeCandidate(
        { rect: { ...rect, height: CHROME_MAX_HEIGHT + 1 }, control: true, text: null },
        phone,
      ),
    ).toBe(false);
    expect(
      isChromeCandidate({ rect: { ...rect, width: 400 }, control: true, text: null }, phone),
    ).toBe(false);
  });

  test('text leaves count only for Latin / digit labels (tile glyphs are not chrome)', () => {
    expect(isChromeCandidate({ rect, control: false, text: 'YOUR TURN · DISCARD' }, phone)).toBe(
      true,
    );
    expect(isChromeCandidate({ rect, control: false, text: '69 left' }, phone)).toBe(true);
    expect(isChromeCandidate({ rect, control: false, text: '六' }, phone)).toBe(false);
    expect(isChromeCandidate({ rect, control: false, text: '' }, phone)).toBe(false);
    expect(isChromeCandidate({ rect, control: false, text: null }, phone)).toBe(false);
  });

  test('off-screen and degenerate rects are dropped', () => {
    expect(
      isChromeCandidate({ rect: { ...rect, top: 950 }, control: true, text: null }, phone),
    ).toBe(false);
    expect(
      isChromeCandidate({ rect: { ...rect, width: 4 }, control: true, text: null }, phone),
    ).toBe(false);
  });
});

describe('chromeSignature', () => {
  test('is stable under sub-pixel jitter and changes on real moves', () => {
    const a = [{ left: 10.2, top: 20.4, width: 100.1, height: 24 }];
    const b = [{ left: 10.4, top: 20.1, width: 99.9, height: 24 }];
    const c = [{ left: 30, top: 20, width: 100, height: 24 }];
    expect(chromeSignature(a)).toBe(chromeSignature(b));
    expect(chromeSignature(a)).not.toBe(chromeSignature(c));
    expect(chromeSignature([])).toBe('');
  });
});

describe('collectChromeRects (DOM walk)', () => {
  function el(
    tag: string,
    attrs: Record<string, string>,
    rect: { left: number; top: number; width: number; height: number },
    text?: string,
  ): HTMLElement {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    node.getBoundingClientRect = () =>
      ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) as DOMRect;
    return node;
  }

  test('skips the overlay, the active target subtree and tile glyphs; keeps controls and labels', () => {
    document.body.innerHTML = '';
    const sort = el('div', { role: 'button' }, { left: 240, top: 780, width: 60, height: 24 });
    const pill = el(
      'div',
      { dir: 'auto' },
      { left: 20, top: 780, width: 140, height: 24 },
      'YOUR TURN',
    );
    const overlay = el(
      'div',
      { [OVERLAY_ATTR]: '1' },
      { left: 0, top: 0, width: 412, height: 915 },
    );
    overlay.appendChild(
      el('div', { 'data-testid': 'tutorial-next' }, { left: 300, top: 600, width: 90, height: 44 }),
    );
    const target = el(
      'div',
      { [TARGET_ATTR]: 'own-hand' },
      { left: 12, top: 810, width: 388, height: 90 },
    );
    target.appendChild(
      el('div', { 'data-testid': 'own-hand-tile' }, { left: 20, top: 820, width: 30, height: 40 }),
    );
    const glyph = el('div', { dir: 'auto' }, { left: 100, top: 500, width: 20, height: 20 }, '萬');
    const pool = el(
      'div',
      { 'data-testid': 'discard-pool' },
      { left: 12, top: 120, width: 388, height: 400 },
    );
    for (const n of [sort, pill, overlay, target, glyph, pool]) document.body.appendChild(n);

    const rects = collectChromeRects({
      doc: document,
      origin: { x: 0, y: 0 },
      viewport: phone,
      activeTargetId: 'own-hand',
    });
    expect(rects).toEqual([
      { left: 240, top: 780, width: 60, height: 24 },
      { left: 20, top: 780, width: 140, height: 24 },
    ]);
  });

  test('offsets rects by the overlay origin', () => {
    document.body.innerHTML = '';
    document.body.appendChild(
      el('div', { role: 'button' }, { left: 240, top: 780, width: 60, height: 24 }),
    );
    const rects = collectChromeRects({
      doc: document,
      origin: { x: 40, y: 100 },
      viewport: phone,
      activeTargetId: null,
    });
    expect(rects).toEqual([{ left: 200, top: 680, width: 60, height: 24 }]);
  });
});

describe('findFocusRect', () => {
  function stubRect(
    el: HTMLElement,
    r: { left: number; top: number; width: number; height: number },
  ) {
    el.getBoundingClientRect = () =>
      ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }) as DOMRect;
  }
  function panel() {
    document.body.innerHTML = `
      <div ${TARGET_ATTR}="result-panel">
        <div dir="auto">Seat 0 wins!</div>
        <div data-testid="winning-hand"></div>
        <div role="button"><div dir="auto">View breakdown</div></div>
        <div role="button"><div dir="auto">Start next hand</div></div>
      </div>`;
    const root = document.querySelector<HTMLElement>(`[${TARGET_ATTR}]`)!;
    stubRect(root.querySelector('[data-testid="winning-hand"]')!, {
      left: 40,
      top: 300,
      width: 300,
      height: 60,
    });
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('[role="button"]'));
    stubRect(buttons[0]!, { left: 40, top: 380, width: 120, height: 36 });
    stubRect(buttons[1]!, { left: 40, top: 700, width: 140, height: 44 });
  }

  test('matches a button by its exact label, in overlay coordinates', () => {
    panel();
    const r = findFocusRect(
      document,
      'result-panel',
      { through: [{ text: 'View breakdown' }, { testId: 'winning-hand' }] },
      { x: 10, y: 20 },
    );
    // `from` is the target's first child; jsdom gives it no layout here.
    expect(r).toEqual({ through: { left: 30, top: 360, width: 120, height: 36 }, from: null });
  });

  test('falls through the candidate list; null only for a missing target', () => {
    panel();
    expect(
      findFocusRect(
        document,
        'result-panel',
        { through: [{ text: 'Nope' }, { testId: 'winning-hand' }] },
        { x: 0, y: 0 },
      ),
    ).toEqual({ through: { left: 40, top: 300, width: 300, height: 60 }, from: null });
    expect(
      findFocusRect(document, 'result-panel', { through: [{ text: 'Nope' }] }, { x: 0, y: 0 }),
    ).toEqual({ through: null, from: null });
    expect(
      findFocusRect(
        document,
        'own-hand',
        { through: [{ testId: 'winning-hand' }] },
        { x: 0, y: 0 },
      ),
    ).toBeNull();
  });
});
