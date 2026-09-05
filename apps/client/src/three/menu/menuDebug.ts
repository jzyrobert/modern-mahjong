import type { OccluderRect } from '../../ui/menu/menuOccluders';
import type { ScreenRect } from './layout';

/**
 * `globalThis.__MAHJONG_MENU_DEBUG__` — the menu backdrop's diagnostics
 * for the verifier and the `three-menu` spec, assembled from the two
 * scenes that draw the menu:
 *
 * - the **drift field** (`DriftScene`, the fixed canvas behind the
 *   page) publishes plain values once per drift step — which DOM
 *   occluders it sees, every tile's fade and projected disc;
 * - the **hero** (`HeroScene`, the canvas inside the lobby's hero band
 *   that scrolls with the title) registers a *provider*. Its rects are
 *   exposed as getters that add the hero canvas's live client rect at
 *   read time, so `rack` / `band` / `diceRects` / `rackGoal` are window
 *   CSS px wherever the page has scrolled to — without the scene having
 *   to render (or even know) when the page scrolls.
 *
 * Everything is in window CSS px, matching Playwright's `boundingBox`.
 */
export interface MenuDebug {
  /** How many rects the drift fade runs against (DOM + scene keep-outs). */
  occluders: number;
  /** The rects the fade currently runs against (CSS px). */
  occluderRects: OccluderRect[];
  reseeded: boolean;
  visible: number;
  /** Visible-slot tiles the re-seed parked (no open spot) — hidden. */
  parked: number;
  fades: number[];
  tiles: { x: number; y: number; r: number; fade: number; parked: boolean }[];
  /** Keep-out factor per die (1 = clear of every rect). */
  dice: number[];
  /** How many times the dice keep-out pass ran, and how many DOM rects
   *  it saw the last time. */
  dicePlaceRuns: number;
  dicePlaceRects: number;
  /** Projected disc per die, CSS px. */
  diceRects: { x: number; y: number; r: number }[];
  /** The hero rack's live projected footprint (tiles + dice). */
  rack: ScreenRect;
  /** The hero band the rack is fitted into — the hero canvas's rect. */
  band: ScreenRect | null;
  /** Where the pure layout maths expects the settled rack (tiles +
   *  dice) to project — the live `rack` converges on it. */
  rackGoal: ScreenRect | null;
  /** How many times the hero camera's `setViewOffset` has been
   *  re-applied since build. Only a resize / band re-fit may bump it:
   *  a scroll moves the canvas itself and must leave this alone. */
  viewOffsetApplies: number;
  /** How many hero scenes this page has built (1 = never remounted). */
  heroBuilds: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_MENU_DEBUG__: MenuDebug | undefined;
}

export type DriftDebug = Pick<
  MenuDebug,
  'occluders' | 'occluderRects' | 'reseeded' | 'visible' | 'parked' | 'fades' | 'tiles'
>;

/** What the hero scene exposes; rects are *canvas-local* CSS px. */
export interface HeroDebugProvider {
  canvasRect(): ScreenRect;
  rack(): ScreenRect;
  rackGoal(): ScreenRect | null;
  diceRects(): { x: number; y: number; r: number }[];
  dice(): number[];
  dicePlaceRuns(): number;
  dicePlaceRects(): number;
  viewOffsetApplies(): number;
  heroBuilds(): number;
}

let drift: DriftDebug | null = null;
let hero: HeroDebugProvider | null = null;

const EMPTY_DRIFT: DriftDebug = {
  occluders: 0,
  occluderRects: [],
  reseeded: false,
  visible: 0,
  parked: 0,
  fades: [],
  tiles: [],
};

function shifted(r: ScreenRect, by: ScreenRect): ScreenRect {
  return { x: r.x + by.x, y: r.y + by.y, w: r.w, h: r.h };
}

function rebuild(): void {
  if (!drift && !hero) {
    globalThis.__MAHJONG_MENU_DEBUG__ = undefined;
    return;
  }
  const d = drift ?? EMPTY_DRIFT;
  const h = hero;
  globalThis.__MAHJONG_MENU_DEBUG__ = {
    ...d,
    get dice() {
      return h ? h.dice() : [];
    },
    get dicePlaceRuns() {
      return h ? h.dicePlaceRuns() : 0;
    },
    get dicePlaceRects() {
      return h ? h.dicePlaceRects() : 0;
    },
    get diceRects() {
      if (!h) return [];
      const c = h.canvasRect();
      return h.diceRects().map((r) => ({ x: r.x + c.x, y: r.y + c.y, r: r.r }));
    },
    get rack() {
      if (!h) return { x: 0, y: 0, w: 0, h: 0 };
      return shifted(h.rack(), h.canvasRect());
    },
    get band() {
      return h ? h.canvasRect() : null;
    },
    get rackGoal() {
      if (!h) return null;
      const g = h.rackGoal();
      return g ? shifted(g, h.canvasRect()) : null;
    },
    get viewOffsetApplies() {
      return h ? h.viewOffsetApplies() : 0;
    },
    get heroBuilds() {
      return h ? h.heroBuilds() : 0;
    },
  };
}

/** Drift scene: publish this step's field diagnostics. */
export function publishDriftDebug(next: DriftDebug | null): void {
  drift = next;
  rebuild();
}

/** Hero scene: register (or, with `null`, withdraw) its provider. */
export function setHeroDebugProvider(next: HeroDebugProvider | null): void {
  hero = next;
  rebuild();
}

/** Test seam. */
export function resetMenuDebugForTests(): void {
  drift = null;
  hero = null;
  rebuild();
}
