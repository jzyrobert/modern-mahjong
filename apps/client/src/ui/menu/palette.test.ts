import { describe, expect, test } from 'vitest';
import { CLASSIC_PAGE_BG, MENU, pageChrome, pageSurface } from './palette';

describe('page chrome', () => {
  test('the lobby and the replay routes are the menu surface; the match is its own', () => {
    expect(pageSurface('/')).toBe('menu');
    expect(pageSurface('/replays')).toBe('menu');
    expect(pageSurface('/replays/abc-123')).toBe('menu');
    expect(pageSurface('/match')).toBe('match');
    expect(pageSurface('/match?solo=1')).toBe('match');
    expect(pageSurface(null)).toBe('menu');
    expect(pageSurface(undefined)).toBe('menu');
  });

  test('the menu surface paints the void behind the app root under both renderers', () => {
    const voidChrome = { background: MENU.void0, statusBar: 'light' };
    expect(pageChrome('menu', '3d')).toEqual(voidChrome);
    expect(pageChrome('menu', 'classic')).toEqual(voidChrome);
    expect(pageChrome('match', '3d')).toEqual(voidChrome);
  });

  test('only the classic match keeps its cream with a dark status bar', () => {
    expect(pageChrome('match', 'classic')).toEqual({
      background: CLASSIC_PAGE_BG,
      statusBar: 'dark',
    });
    expect(CLASSIC_PAGE_BG).toBe('#f1eadc');
  });
});
