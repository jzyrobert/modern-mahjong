import type { Tile as MTile } from '@mahjong/game-logic';
import { View, useWindowDimensions } from 'react-native';
import { Tile } from '../Tile';

// Tile only renders the back when `faceDown`, so the engine values here
// are placeholders — the back gradient is what actually paints.
const DUMMY: MTile = { kind: 'suit', suit: 'man', rank: 1, copy: 0 };

interface ScatteredTile {
  /** Anchor side. */
  side: 'left' | 'right';
  /** Distance from `side`, in CSS pixels (RN absolute positioning). */
  offset: number;
  /** Distance from top, in CSS pixels. */
  top: number;
  /** Rotation in degrees. */
  rot: number;
  /** Tile width scale (height auto-derives at 50/36 ratio). */
  size: number;
}

const TILES: ScatteredTile[] = [
  { side: 'left', offset: 24, top: 80, rot: -14, size: 0.9 },
  { side: 'left', offset: 40, top: 480, rot: 8, size: 1.0 },
  { side: 'right', offset: 28, top: 120, rot: 16, size: 0.85 },
  { side: 'right', offset: 48, top: 520, rot: -6, size: 1.1 },
];

/**
 * Decorative face-down tile-backs scattered in the lobby corners. Pure
 * decoration — `pointerEvents: 'none'` so the tiles never block taps on
 * the mode cards beneath. Native port of
 * `_legacy/src/ui/menu/ScatteredTiles.tsx`.
 *
 * On viewports narrower than ~480px (small phones in portrait), the
 * scatter is suppressed — the tile-backs would otherwise overlap the
 * mode cards. On wider screens they sit behind the content with
 * pointerEvents: 'none' so taps on the lobby still go through.
 */
export function ScatteredTiles() {
  const { width } = useWindowDimensions();
  if (width < 480) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
      }}
    >
      {TILES.map((t) => (
        <View
          key={`${t.side}-${t.offset}-${t.top}`}
          style={{
            position: 'absolute',
            top: t.top,
            ...(t.side === 'left' ? { left: t.offset } : { right: t.offset }),
            opacity: 0.55,
          }}
        >
          <Tile tile={DUMMY} faceDown width={36 * t.size} height={50 * t.size} rotate={t.rot} />
        </View>
      ))}
    </View>
  );
}
