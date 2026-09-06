import type { Seat } from '@mahjong/game-logic';
import { COLORS } from '../colors';
import { type Position, SEAT_COLOR } from './seatColor';

/**
 * Chrome theme for the in-match sheets (☰ menu, game log, tile
 * reference, scoring rules, players, scoring breakdown).
 *
 * `'paper'` is the cream dialog the classic shells were designed on and
 * stays byte-identical to the pre-theme rendering. `'glass'` is the
 * dark frosted language of the 3D render layer's HUD: white text at
 * 0.92 / 0.62 alpha, gold accents, 11 px uppercase micro-labels,
 * hairline dividers at 0.08 alpha. `MatchModals` picks the theme from
 * the resolved renderer so the classic shells never see glass.
 */
export type SheetTheme = 'paper' | 'glass';

export interface SheetPalette {
  /** Primary text. */
  text: string;
  /** Secondary text (0.62 alpha on glass). */
  text2: string;
  /** Muted labels — ≥ 4.5:1 on the glass sheet over a bright felt. */
  text3: string;
  /** Row / card fill. */
  surface: string;
  /** Pressed / hovered fill. */
  surfaceHi: string;
  /** Card border. */
  border: string;
  /** Divider hairline. */
  hairline: string;
  gold: string;
  goldTint: string;
  goldBorder: string;
  /** Text on a solid gold fill. */
  goldInk: string;
  red: string;
  redTint: string;
  redBorder: string;
  success: string;
  /** Dark felt card the tile references sit on (glass); cream on paper. */
  feltCard: string;
  feltCardBorder: string;
  /** Font stack for tile glyphs and Chinese pattern names. */
  serif: string;
}

export const GLASS_SHEET: SheetPalette = {
  text: 'rgba(255,255,255,0.92)',
  text2: 'rgba(255,255,255,0.62)',
  text3: 'rgba(255,255,255,0.58)',
  surface: 'rgba(255,255,255,0.06)',
  surfaceHi: 'rgba(255,255,255,0.12)',
  border: 'rgba(255,255,255,0.1)',
  hairline: 'rgba(255,255,255,0.08)',
  gold: COLORS.gold,
  goldTint: 'rgba(216,168,90,0.16)',
  goldBorder: 'rgba(216,168,90,0.45)',
  goldInk: '#2a2418',
  red: '#f0a08e',
  redTint: 'rgba(177,77,58,0.14)',
  redBorder: 'rgba(177,77,58,0.6)',
  success: '#6fcf97',
  feltCard: 'rgba(22,44,32,0.85)',
  feltCardBorder: 'rgba(255,255,255,0.08)',
  serif: 'Noto Serif TC',
};

export const PAPER_SHEET: SheetPalette = {
  text: COLORS.ink,
  text2: COLORS.ink2,
  text3: COLORS.ink3,
  surface: COLORS.paperHi,
  surfaceHi: COLORS.creamLow,
  border: COLORS.hairline,
  hairline: COLORS.hairline,
  gold: COLORS.gold,
  goldTint: '#fff5d6',
  goldBorder: '#d4a73a',
  goldInk: COLORS.ink,
  red: COLORS.red,
  redTint: COLORS.accentSalmonSwatch,
  redBorder: COLORS.accentSalmonEdge,
  success: COLORS.success,
  feltCard: COLORS.cream,
  feltCardBorder: COLORS.cream,
  serif: 'Noto Serif TC',
};

export function sheetPalette(theme: SheetTheme): SheetPalette {
  return theme === 'glass' ? GLASS_SHEET : PAPER_SHEET;
}

/** 11 px uppercase micro-label — the HUD's section / badge typography. */
export function microLabel(color: string) {
  return {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700' as const,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
    color,
  };
}

/**
 * Perimeter position of `seat` as seen from `mySeat` — the user is
 * always at the bottom, the next seat clockwise sits on the right, the
 * seat across at the top, the previous seat on the left. Spectators
 * (`mySeat === null`) see seat 0 at the bottom.
 */
export function seatPositionFrom(mySeat: Seat | null, seat: Seat): Position {
  const offset = (seat - (mySeat ?? 0) + 4) % 4;
  return (['bottom', 'right', 'top', 'left'] as const)[offset] ?? 'bottom';
}

/** Seat accent colour (coral / jade / mauve / sky) relative to `mySeat`. */
export function seatColorFrom(mySeat: Seat | null, seat: Seat): string {
  return SEAT_COLOR[seatPositionFrom(mySeat, seat)];
}
