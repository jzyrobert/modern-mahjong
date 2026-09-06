import type { Tile as MTile } from '@mahjong/game-logic';
import { type HeroBand, heroBox } from './heroBand';

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
  // Landscape phone: title column on the left (≈ 30 % of the width),
  // cards on the right from x ≈ 0.32 — the fan lives under the title
  // and must clear both the 12 px safe area and the Tutorial row, so
  // it is centred well inside the column (`MobileLobby` landscape).
  if (cls === 'landscape-phone') return { cls, x: 0.16, y: 0.58 };
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

export interface DomFanOptions {
  /** The measured hero band (`heroBand.ts`); the fan centres itself in
   *  the band's inset box and shrinks to fit it. Without one the fan
   *  sits on the viewport-fraction anchor. */
  band?: HeroBand | null;
  count?: number;
}

/** Tile width the classic fan starts from per viewport class (CSS px). */
function domFanTileWidth(cls: ViewportClass): number {
  return cls === 'wide' ? 52 : 44;
}

/** Smallest tile the fan shrinks to when the band is short. */
const DOM_FAN_MIN_TILE_W = 28;

/**
 * Screen-space slots for the classic fan: `count` tiles on a shallow
 * arc centred on the hero anchor — or, when the lobby has measured its
 * hero band, centred in the band's inset box (`heroBox`) and scaled
 * down until the arc fits it, so the fan never runs under the title's
 * tagline or the first card. Tiles are ≥ 44 CSS px wide on phones so
 * the glyphs stay crisp (visual language), a little larger on wide
 * viewports; a short band trades size for clearance.
 */
export function domFan(width: number, height: number, opts: DomFanOptions = {}): DomFanSlot[] {
  const aspect = width / Math.max(1, height);
  const a = heroAnchor(aspect);
  const count = opts.count ?? (a.cls === 'wide' ? 9 : 7);
  const box = heroBox(opts.band);
  const baseW = domFanTileWidth(a.cls);
  const spacingF = a.cls === 'wide' ? 0.94 : a.cls === 'landscape-phone' ? 0.76 : 0.8;
  const rotStep = a.cls === 'portrait' ? 4.5 : 3;
  const bowF = (a.cls === 'wide' ? 1.0 : 1.5) / baseW;
  const mid = (count - 1) / 2;
  const build = (tileW: number, cx: number, cy: number): DomFanSlot[] => {
    const tileH = Math.round(tileW * TILE_ASPECT);
    const spacing = tileW * spacingF;
    const bow = tileW * bowF;
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
  };
  if (!box) {
    // Wide viewports lift the DOM fan above the shared anchor so its
    // bowed ends keep ≥ 20 px of air above the card row (which starts
    // at 38 % of the height — `DesktopLobby.heroMinHeight`).
    return build(baseW, width * a.x, height * a.y - (a.cls === 'wide' ? 26 : 0));
  }
  // Fit: the arc's extent at the base size (plus the slop the end
  // tiles' rotation adds) against the box, then centre it in the box.
  const extent = (slots: DomFanSlot[]) => {
    const slop = Math.ceil(slots[0]!.width * 0.12);
    return {
      top: Math.min(...slots.map((s) => s.top)) - slop,
      bottom: Math.max(...slots.map((s) => s.top + s.height)) + slop,
      left: Math.min(...slots.map((s) => s.left)) - slop,
      right: Math.max(...slots.map((s) => s.left + s.width)) + slop,
    };
  };
  const probe = extent(build(baseW, 0, 0));
  const scale = Math.min(1, box.h / (probe.bottom - probe.top), box.w / (probe.right - probe.left));
  const tileW = Math.max(DOM_FAN_MIN_TILE_W, Math.floor(baseW * scale));
  const fitted = extent(build(tileW, 0, 0));
  const cx = box.x + box.w / 2 - (fitted.left + fitted.right) / 2;
  const cy = box.y + box.h / 2 - (fitted.top + fitted.bottom) / 2;
  return build(tileW, cx, cy);
}
