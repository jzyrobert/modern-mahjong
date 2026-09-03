import type { Tile as MTile } from '@mahjong/game-logic';
import { View, useWindowDimensions } from 'react-native';
import { Tile } from '../Tile';
import { DOM_FAN_TILES, classifyAspect, domFan } from './heroAnchor';

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

/** Tile-back positions per viewport class, kept clear of the title
 *  block and the fan (`heroAnchor`) so nothing peeks out from behind
 *  the hand or sits under the heading. */
const BACKS: Record<ReturnType<typeof classifyAspect>, ScatteredTile[]> = {
  portrait: [
    { fx: 0.06, fy: 0.165, rot: -16, size: 0.9, opacity: 0.3 },
    { fx: 0.9, fy: 0.175, rot: 14, size: 0.8, opacity: 0.26 },
    { fx: 0.92, fy: 0.345, rot: -9, size: 0.95, opacity: 0.22 },
  ],
  'landscape-phone': [
    { fx: 0.27, fy: 0.08, rot: 12, size: 0.8, opacity: 0.22 },
    { fx: 0.05, fy: 0.86, rot: -14, size: 0.9, opacity: 0.24 },
    { fx: 0.4, fy: 0.76, rot: 8, size: 0.85, opacity: 0.2 },
    { fx: 0.64, fy: 0.7, rot: -6, size: 0.75, opacity: 0.16 },
    { fx: 0.9, fy: 0.16, rot: 15, size: 0.85, opacity: 0.2 },
  ],
  wide: [
    { fx: 0.08, fy: 0.16, rot: -16, size: 0.9, opacity: 0.32 },
    { fx: 0.88, fy: 0.12, rot: 14, size: 0.8, opacity: 0.26 },
    { fx: 0.18, fy: 0.3, rot: 9, size: 0.7, opacity: 0.18 },
    { fx: 0.78, fy: 0.27, rot: -7, size: 1.05, opacity: 0.3 },
    { fx: 0.06, fy: 0.62, rot: 6, size: 0.85, opacity: 0.16 },
    { fx: 0.92, fy: 0.7, rot: -12, size: 0.95, opacity: 0.2 },
  ],
};

/**
 * Classic-renderer ornament for the dark lobby: a fanned hand of
 * face-up tiles resting in the hero band (same anchor the Three.js
 * scene projects its hand to — `heroAnchor.ts`), plus a handful of
 * dim tile backs drifting in the void around it. Pure decoration — the
 * parent is `pointerEvents: 'none'`.
 */
export function ScatteredTiles() {
  const { width, height } = useWindowDimensions();
  const tiles = BACKS[classifyAspect(width / Math.max(1, height))];
  const fan = domFan(width, height);
  const first = fan[0];
  const last = fan[fan.length - 1];
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
      <View
        testID="hero-fan"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {first && last ? (
          // Soft pool of shadow under the hand so it reads as resting on
          // an unseen table rather than floating in the void.
          <View
            style={{
              position: 'absolute',
              left: first.left + first.width * 0.4,
              width: last.left + last.width - first.left - first.width * 0.8,
              top: first.top + first.height * 0.62,
              height: first.height * 0.55,
              borderRadius: 999,
              backgroundColor: 'rgba(0,0,0,0.38)',
              boxShadow: '0px 6px 34px 22px rgba(0,0,0,0.38)',
            }}
          />
        ) : null}
        {fan.map((slot, i) => {
          const tile = DOM_FAN_TILES[i];
          if (!tile) return null;
          return (
            <View
              key={`fan-${i}-${slot.left}`}
              style={{ position: 'absolute', left: slot.left, top: slot.top }}
            >
              <Tile
                tile={tile}
                width={slot.width}
                height={slot.height}
                rotate={slot.rotate}
                elevation="hand"
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}
