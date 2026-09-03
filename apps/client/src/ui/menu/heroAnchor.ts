import type { Tile as MTile } from '@mahjong/game-logic';

/**
 * Where the menu hero (the fanned hand) sits on screen, as fractions of
 * the viewport. Shared by the 3D backdrop (`three/menu/layout.ts` shifts
 * the camera frustum so the fan projects here) and the classic DOM fan
 * (`ScatteredTiles`), so both renderers leave the same band under the
 * title clear for the hero. Universal + pure — no three.js, unit-tested.
 */
export type ViewportClass = 'portrait' | 'landscape-phone' | 'wide';

export function classifyAspect(aspect: number): ViewportClass {
  if (aspect < 0.85) return 'portrait';
  if (aspect > 1.95) return 'landscape-phone';
  return 'wide';
}

export interface HeroAnchor {
  cls: ViewportClass;
  /** Horizontal centre, 0..1 of the viewport width. */
  x: number;
  /** Vertical centre, 0..1 of the viewport height. */
  y: number;
}

export function heroAnchor(aspect: number): HeroAnchor {
  const cls = classifyAspect(aspect);
  if (cls === 'portrait') return { cls, x: 0.5, y: 0.3 };
  // Landscape phone: title column on the left, cards on the right —
  // the fan lives under the title, clear of the 12 px safe area.
  if (cls === 'landscape-phone') return { cls, x: 0.21, y: 0.64 };
  return { cls, x: 0.5, y: 0.33 };
}

/** Face-up tiles for the classic DOM fan — a clean mixed hand that
 *  shows every ink colour (萬 red/black, 筒 dots, 索 bamboo, 東, 中, 發). */
export const DOM_FAN_TILES: readonly MTile[] = [
  { kind: 'suit', suit: 'man', rank: 1, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 2, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 3, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 5, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 7, copy: 0 },
  { kind: 'honor', honor: 'E', copy: 0 },
  { kind: 'honor', honor: 'Z', copy: 0 },
  { kind: 'honor', honor: 'F', copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 9, copy: 0 },
];

export interface DomFanSlot {
  left: number;
  top: number;
  /** Degrees; ends turn outward like a hand held in a fan. */
  rotate: number;
  width: number;
  height: number;
}

/** Tile aspect used by `ui/Tile` (36 × 50). */
const TILE_ASPECT = 50 / 36;

/**
 * Screen-space slots for the classic fan: `count` tiles on a shallow
 * arc centred on the hero anchor. Tiles are ≥ 44 CSS px wide on phones
 * so the glyphs stay crisp (visual language), a little larger on wide
 * viewports.
 */
export function domFan(
  width: number,
  height: number,
  count = width / Math.max(1, height) < 0.85 || width / Math.max(1, height) > 1.95 ? 7 : 9,
): DomFanSlot[] {
  const a = heroAnchor(width / Math.max(1, height));
  const tileW = a.cls === 'wide' ? 56 : 44;
  const tileH = Math.round(tileW * TILE_ASPECT);
  const spacing = tileW * (a.cls === 'wide' ? 0.94 : 0.8);
  const rotStep = a.cls === 'portrait' ? 4.5 : 3;
  const bow = a.cls === 'wide' ? 1.1 : 1.5;
  const cx = width * a.x;
  const cy = height * a.y;
  const mid = (count - 1) / 2;
  const out: DomFanSlot[] = [];
  for (let i = 0; i < count; i++) {
    const u = i - mid;
    out.push({
      left: Math.round(cx + u * spacing - tileW / 2),
      top: Math.round(cy - tileH / 2 + u * u * bow),
      rotate: u * rotStep,
      width: tileW,
      height: tileH,
    });
  }
  return out;
}
