import type { Tile as MTile } from '@mahjong/game-logic';
import { View, useWindowDimensions } from 'react-native';
import { Tile } from '../Tile';

// Tile only renders the back when `faceDown`, so the engine value here
// is a placeholder — the tile-back skin gradient is what paints.
const DUMMY: MTile = { kind: 'suit', suit: 'man', rank: 1, copy: 0 };

interface ScatteredTile {
  /** Horizontal anchor as a fraction of the width. */
  fx: number;
  /** Vertical anchor as a fraction of the height. */
  fy: number;
  rot: number;
  size: number;
  opacity: number;
}

const TILES: ScatteredTile[] = [
  { fx: 0.08, fy: 0.16, rot: -16, size: 0.9, opacity: 0.32 },
  { fx: 0.88, fy: 0.12, rot: 14, size: 0.8, opacity: 0.26 },
  { fx: 0.18, fy: 0.3, rot: 9, size: 0.7, opacity: 0.18 },
  { fx: 0.78, fy: 0.27, rot: -7, size: 1.05, opacity: 0.3 },
  { fx: 0.06, fy: 0.62, rot: 6, size: 0.85, opacity: 0.16 },
  { fx: 0.92, fy: 0.7, rot: -12, size: 0.95, opacity: 0.2 },
];

/**
 * Classic-renderer ornament for the dark lobby: a handful of face-down
 * tile backs drifting in the void where the Three.js hero would sit.
 * Pure decoration — the parent is `pointerEvents: 'none'`.
 */
export function ScatteredTiles() {
  const { width, height } = useWindowDimensions();
  const dense = width >= 600;
  const tiles = dense ? TILES : TILES.slice(0, 4);
  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
    >
      {tiles.map((t) => (
        <View
          key={`${t.fx}-${t.fy}`}
          style={{
            position: 'absolute',
            left: width * t.fx - 22 * t.size,
            top: height * t.fy,
            opacity: t.opacity,
          }}
        >
          <Tile tile={DUMMY} faceDown width={44 * t.size} height={61 * t.size} rotate={t.rot} />
        </View>
      ))}
    </View>
  );
}
