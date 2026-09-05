import type { ResolvedRenderer } from '../../three/renderer';

/**
 * Dark "lacquered parlour" palette for the menu + replay library, plus
 * the page-chrome rule built on it. The match surfaces keep the cream
 * `ui/colors.ts` tokens; this module is the home-screen theme only (see
 * the visual language in the Three.js rewrite brief — void gradient,
 * glass panels, gold accent). Pure — no react-native import — so the
 * static HTML shell (`app/+html.tsx`) and vitest can read the tokens;
 * `theme.ts` re-exports everything here alongside the styled recipes.
 */
export const MENU = {
  void0: '#0b120f',
  void1: '#16241d',
  /** Mid-point of the void gradient — used as the flat fallback. */
  voidMid: '#101a15',
  text: 'rgba(255,255,255,0.92)',
  text2: 'rgba(255,255,255,0.62)',
  /** Quietest text that still carries meaning (hints, credits, meta) —
   *  ≥ 4.5:1 on the glass + void grounds. */
  text3: 'rgba(255,255,255,0.56)',
  /** Decorative only: chevrons, icon tints. */
  text4: 'rgba(255,255,255,0.42)',
  hairline: 'rgba(255,255,255,0.12)',
  hairlineSoft: 'rgba(255,255,255,0.07)',
  fill: 'rgba(255,255,255,0.06)',
  fillHi: 'rgba(255,255,255,0.1)',
  gold: '#d8a85a',
  goldHi: '#e7bc72',
  goldInk: '#2a2418',
  /** Gold for small meta text (lesson numerals) — ≥ 4.5:1 on glass. */
  goldMuted: 'rgba(216,168,90,0.78)',
  goldTint: 'rgba(216,168,90,0.14)',
  goldEdge: 'rgba(216,168,90,0.38)',
  red: '#b14d3a',
  redTint: 'rgba(177,77,58,0.16)',
  redEdge: 'rgba(177,77,58,0.45)',
  success: '#3aa066',
  successTint: 'rgba(58,160,102,0.16)',
  ivory: '#efe6d2',
  glassBg: 'rgba(14,20,17,0.62)',
  glassQuiet: 'rgba(14,20,17,0.42)',
  glassSolid: 'rgba(14,20,17,0.94)',
  shadow: '0px 12px 40px rgba(0,0,0,0.35)',
  shadowSoft: '0px 8px 24px rgba(0,0,0,0.28)',
} as const;

/** The classic shells' cream page ground (`ui/colors.ts` `cream`). */
export const CLASSIC_PAGE_BG = '#f1eadc';

export interface PageChrome {
  /** Colour painted behind the app root: html / body, the pre-hydration
   *  shell, the router's screen container, the theme-color meta. */
  background: string;
  /** Status-bar foreground that reads on `background`. */
  statusBar: 'light' | 'dark';
}

/**
 * Everything the browser paints *around* the app for a renderer: the
 * 3D flow is the parlour void end to end (menu, table, replays), so a
 * retracting URL bar or an overscroll on Android Chrome reveals more
 * void — never the classic cream (round-1 feedback: a cream band under
 * the lobby cards). The classic shells keep their cream.
 */
export function pageChrome(renderer: ResolvedRenderer): PageChrome {
  return renderer === '3d'
    ? { background: MENU.void0, statusBar: 'light' }
    : { background: CLASSIC_PAGE_BG, statusBar: 'dark' };
}
