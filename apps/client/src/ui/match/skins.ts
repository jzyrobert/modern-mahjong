import type { FeltSkin, TileBackSkin } from '../../state/game';

/**
 * Felt + tile-back skin presets — hex translations of the legacy
 * `_legacy/src/ui/match/skins.ts` (which used `oklch()` for browser-only
 * gradient stops). RN inline `backgroundColor` rejects oklch on Android,
 * so the table commits to hex everywhere now (matches the visual-polish
 * commit 697a7cb's "oklch → hex everywhere" pivot).
 */

export const FELT_SKINS: Record<FeltSkin, { name: string; top: string; bottom: string }> = {
  sage: {
    name: 'Sage',
    top: '#506a51',
    bottom: '#3e574c',
  },
  jade: {
    name: 'Jade',
    top: '#3a8b6a',
    bottom: '#1f5a44',
  },
  ocean: {
    name: 'Ocean',
    top: '#4a6f8a',
    bottom: '#2c4a63',
  },
  rose: {
    name: 'Rose',
    top: '#9c5a4a',
    bottom: '#683425',
  },
};

export const TILE_BACK_SKINS: Record<TileBackSkin, { name: string; top: string; bottom: string }> =
  {
    cream: {
      name: 'Cream',
      top: '#ece4d3',
      bottom: '#c5b89f',
    },
    blue: {
      name: 'Blue',
      top: '#7fa9c1',
      bottom: '#5a8cb0',
    },
    plum: {
      name: 'Plum',
      top: '#b87fb6',
      bottom: '#9a5598',
    },
    mint: {
      name: 'Mint',
      top: '#84cdb4',
      bottom: '#5cae93',
    },
  };
