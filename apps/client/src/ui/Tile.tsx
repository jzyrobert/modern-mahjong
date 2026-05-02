import { type Tile as MTile, tileLabel } from '@mahjong/game-logic';
import type { CSSProperties, MouseEventHandler } from 'react';

interface TileProps {
  tile: MTile;
  faceDown?: boolean | undefined;
  selected?: boolean | undefined;
  onClick?: MouseEventHandler<HTMLButtonElement> | undefined;
  style?: CSSProperties | undefined;
}

export function Tile({ tile, faceDown, selected, onClick, style }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 'var(--tile-w, 36px)',
        height: 'var(--tile-h, 50px)',
        background: faceDown ? '#5b3a2b' : '#fff',
        color: '#222',
        border: selected ? '2px solid #f3c54a' : '1px solid #2228',
        borderRadius: 6,
        boxShadow: '0 2px 4px #0006',
        fontWeight: 600,
        fontSize: 14,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
        padding: 0,
        ...style,
      }}
    >
      {faceDown ? '' : tileLabel(tile)}
    </button>
  );
}
