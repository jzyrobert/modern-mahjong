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

type Backs = Record<ReturnType<typeof classifyAspect>, ScatteredTile[]>;

/** Tile-back positions per viewport class for the menu, kept clear of
 *  the title block, the fan (`heroAnchor`) and the card stack so
 *  nothing peeks out from behind the hand or blurs through a card. */
const MENU_BACKS: Backs = {
  portrait: [
    { fx: 0.06, fy: 0.165, rot: -16, size: 0.9, opacity: 0.3 },
    { fx: 0.9, fy: 0.175, rot: 14, size: 0.8, opacity: 0.26 },
    { fx: 0.92, fy: 0.29, rot: -9, size: 0.95, opacity: 0.22 },
  ],
  // Landscape: title column + fan on the left, cards from x ≈ 0.32 down
  // to y ≈ 0.76, credits bottom-right — the backs live in the strip
  // under the cards, left of the credits.
  'landscape-phone': [
    { fx: 0.05, fy: 0.86, rot: -14, size: 0.9, opacity: 0.24 },
    { fx: 0.4, fy: 0.8, rot: 8, size: 0.85, opacity: 0.22 },
    { fx: 0.6, fy: 0.85, rot: -6, size: 0.75, opacity: 0.18 },
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

/** Replay library: no hero, content is a centred column (max 960 px)
 *  with the header row at the top — backs sit in the side margins and
 *  the lower void, never under the heading, the Import button or the
 *  glass cards (a back blurred through glass reads as a smudge). */
const LIBRARY_BACKS: Backs = {
  // Portrait: header + ribbon + empty-state card end near y ≈ 0.72;
  // the backs anchor the void below.
  portrait: [
    { fx: 0.88, fy: 0.14, rot: 14, size: 0.8, opacity: 0.22 },
    { fx: 0.14, fy: 0.78, rot: -16, size: 0.95, opacity: 0.3 },
    { fx: 0.84, fy: 0.82, rot: 9, size: 0.85, opacity: 0.26 },
    { fx: 0.5, fy: 0.92, rot: -7, size: 0.75, opacity: 0.2 },
  ],
  // Landscape: glass spans the full width from y ≈ 0.4; only the gap
  // between the summary and the Import button is free.
  'landscape-phone': [
    { fx: 0.42, fy: 0.1, rot: -14, size: 0.85, opacity: 0.24 },
    { fx: 0.62, fy: 0.05, rot: 8, size: 0.7, opacity: 0.18 },
    { fx: 0.7, fy: 0.24, rot: 15, size: 0.6, opacity: 0.16 },
  ],
  wide: [
    { fx: 0.06, fy: 0.14, rot: -16, size: 0.9, opacity: 0.32 },
    { fx: 0.93, fy: 0.1, rot: 14, size: 0.8, opacity: 0.26 },
    { fx: 0.04, fy: 0.5, rot: 9, size: 0.7, opacity: 0.18 },
    { fx: 0.95, fy: 0.55, rot: -7, size: 1.05, opacity: 0.3 },
    { fx: 0.08, fy: 0.84, rot: 6, size: 0.85, opacity: 0.18 },
    { fx: 0.9, fy: 0.88, rot: -12, size: 0.95, opacity: 0.22 },
  ],
};

/**
 * Classic-renderer ornament for the dark lobby: a fanned hand of
 * face-up tiles resting in the hero band (same anchor the Three.js
 * scene projects its hand to — `heroAnchor.ts`), plus a handful of
 * dim tile backs drifting in the void around it. `fan={false}` keeps
 * only the backs, placed for the replay library's column layout (no
 * hero there — `variant` picks the set). Pure decoration —
 * the parent is `pointerEvents: 'none'`.
 */
export function ScatteredTiles({
  fan: showFan = true,
  variant = showFan ? 'menu' : 'library',
}: { fan?: boolean; variant?: 'menu' | 'library' }) {
  const { width, height } = useWindowDimensions();
  const tiles = (variant === 'menu' ? MENU_BACKS : LIBRARY_BACKS)[
    classifyAspect(width / Math.max(1, height))
  ];
  const fan = showFan ? domFan(width, height) : [];
  const first = fan[0];
  const last = fan[fan.length - 1];
  return (
    // Pure decoration: hide the whole layer from the accessibility tree so
    // the dummy tiles' labels don't surface (Lighthouse flagged them as
    // `aria-prohibited-attr` on role-less divs).
    <View
      aria-hidden
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
      {showFan ? (
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
      ) : null}
    </View>
  );
}
