import { describe, expect, test } from 'vitest';
import { CLASSIC_PAGE_BG, MENU, pageChrome } from './palette';

describe('page chrome', () => {
  test('the 3D flow paints the void behind the app root with a light status bar', () => {
    expect(pageChrome('3d')).toEqual({ background: MENU.void0, statusBar: 'light' });
  });

  test('the classic shells keep their cream with a dark status bar', () => {
    expect(pageChrome('classic')).toEqual({ background: CLASSIC_PAGE_BG, statusBar: 'dark' });
    expect(CLASSIC_PAGE_BG).toBe('#f1eadc');
  });
});
