import { type Tile as MTile, tileId, tileLabel } from '@mahjong/game-logic';
import { type MotionStyle, type Transition, motion } from 'framer-motion';
import { memo } from 'react';
import { TILE_BACK_BG } from '../native/theme.js';

interface TileProps {
  tile: MTile;
  faceDown?: boolean | undefined;
  selected?: boolean | undefined;
  onClick?: (() => void) | undefined;
  style?: MotionStyle | undefined;
  rotate?: number | undefined;
  testId?: string | undefined;
}

const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 32, mass: 0.6 };
const TAP = { scale: 0.94 } as const;

const STATIC_STYLE: MotionStyle = {
  width: 'var(--tile-w, 36px)',
  height: 'var(--tile-h, 50px)',
  color: '#222',
  borderRadius: 6,
  boxShadow: '0 2px 4px #0006',
  fontWeight: 600,
  fontSize: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};

function TileComponent({ tile, faceDown, selected, onClick, style, rotate, testId }: TileProps) {
  return (
    <motion.button
      type="button"
      layoutId={`tile-${tileId(tile)}`}
      onClick={onClick}
      {...(onClick ? { whileTap: TAP } : {})}
      {...(testId ? { 'data-testid': testId } : {})}
      transition={SPRING}
      style={{
        ...STATIC_STYLE,
        background: faceDown ? TILE_BACK_BG : '#fff',
        border: selected ? '2px solid #f3c54a' : '1px solid #2228',
        cursor: onClick ? 'pointer' : 'default',
        rotate: rotate ?? 0,
        ...(style ?? {}),
      }}
    >
      {faceDown ? '' : tileLabel(tile)}
    </motion.button>
  );
}

export const Tile = memo(TileComponent);
