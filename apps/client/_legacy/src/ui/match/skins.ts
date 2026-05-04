import type { FeltSkin, TileBackSkin } from '../../state/game.js';

/**
 * Felt skin presets — each pair `(top, bottom)` are the gradient stops the
 * Match container injects as `--felt-1` and `--felt-2`. `Table.tsx` uses
 * those CSS vars on the table background; the deeper-sage inner ring +
 * gold halo + corner shadow stay constant across skins.
 */
export const FELT_SKINS: Record<FeltSkin, { name: string; top: string; bottom: string }> = {
  sage: {
    name: 'Sage',
    top: 'oklch(0.5 0.06 145)',
    bottom: 'oklch(0.32 0.06 150)',
  },
  jade: {
    name: 'Jade',
    top: 'oklch(0.55 0.1 170)',
    bottom: 'oklch(0.36 0.1 175)',
  },
  ocean: {
    name: 'Ocean',
    top: 'oklch(0.5 0.08 220)',
    bottom: 'oklch(0.32 0.09 225)',
  },
  rose: {
    name: 'Rose',
    top: 'oklch(0.55 0.07 25)',
    bottom: 'oklch(0.36 0.08 25)',
  },
};

/**
 * Tile-back skin presets — each pair drives `--tile-back-1` / `--tile-back-2`
 * which `Tile.tsx` reads via the `mj-tile-back` linearGradient.
 */
export const TILE_BACK_SKINS: Record<TileBackSkin, { name: string; top: string; bottom: string }> =
  {
    cream: {
      name: 'Cream',
      top: 'oklch(0.92 0.02 85)',
      bottom: 'oklch(0.78 0.03 85)',
    },
    blue: {
      name: 'Blue',
      top: 'oklch(0.72 0.08 220)',
      bottom: 'oklch(0.6 0.1 230)',
    },
    plum: {
      name: 'Plum',
      top: 'oklch(0.7 0.1 320)',
      bottom: 'oklch(0.58 0.13 325)',
    },
    mint: {
      name: 'Mint',
      top: 'oklch(0.78 0.08 165)',
      bottom: 'oklch(0.66 0.1 170)',
    },
  };
