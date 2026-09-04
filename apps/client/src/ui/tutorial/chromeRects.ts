import type { HaloRect } from './placement';
import type { TargetFocus } from './types';

/**
 * Discovers HUD chrome the caption card must not bisect. The overlay
 * cannot ask the shells to register every pill and chip (the classic
 * shells are shared with the 3D table and owned elsewhere), so on web
 * it reads the DOM once per settle: interactive or labelled elements
 * (`role=button`, `data-testid`, `aria-label`) and short text labels
 * (the YOUR TURN pill, the wall counter, the status-bar name) that are
 * small enough to be a control rather than a region.
 *
 * `isChromeCandidate` is the pure half (unit-tested); `collectChromeRects`
 * is the DOM walk. Both return rects in overlay coordinates.
 */
export const CHROME_MAX_HEIGHT = 64;
export const CHROME_MAX_WIDTH_RATIO = 0.95;
export const CHROME_MIN_SIZE = 8;

export interface ChromeCandidate {
  rect: HaloRect;
  /** Interactive / labelled element (button, testID, aria-label). */
  control: boolean;
  /** Leaf text node: the trimmed text content. */
  text: string | null;
}

export function isChromeCandidate(
  c: ChromeCandidate,
  viewport: { width: number; height: number },
): boolean {
  const { rect } = c;
  if (rect.width < CHROME_MIN_SIZE || rect.height < CHROME_MIN_SIZE) return false;
  if (rect.height > CHROME_MAX_HEIGHT) return false;
  if (rect.width > viewport.width * CHROME_MAX_WIDTH_RATIO) return false;
  if (rect.left + rect.width <= 0 || rect.top + rect.height <= 0) return false;
  if (rect.left >= viewport.width || rect.top >= viewport.height) return false;
  if (c.control) return true;
  // Text leaf: only Latin / digit labels count. Single CJK glyphs and
  // dot faces are tile artwork, not chrome.
  return c.text !== null && /[A-Za-z0-9]/.test(c.text);
}

/** Stable key so the overlay only re-renders when a rect really moved. */
export function chromeSignature(rects: readonly HaloRect[]): string {
  return rects
    .map(
      (r) =>
        `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`,
    )
    .join(';');
}

function intersects(a: HaloRect, b: HaloRect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

export const OVERLAY_ATTR = 'data-tutorial-overlay';
export const TARGET_ATTR = 'data-tutorial-target';

const SELECTOR = '[role="button"], [data-testid], [aria-label], div[dir="auto"]';

interface CollectOptions {
  doc: Document;
  /** Overlay-space origin in client coordinates. */
  origin: { x: number; y: number };
  viewport: { width: number; height: number };
  /** Id of the active step's target — its subtree is the spotlit content. */
  activeTargetId: string | null;
  /** Spotlit band of the target (overlay coordinates) when a step
   *  focuses part of it. Descendants of the target *outside* the band
   *  (the result panel's rules block under a score-header spotlight)
   *  are dimmed like any other chrome and count as such. `null` /
   *  omitted: the whole subtree is spotlit. */
  focusBand?: HaloRect | null;
}

export function collectChromeRects({
  doc,
  origin,
  viewport,
  activeTargetId,
  focusBand = null,
}: CollectOptions): HaloRect[] {
  const out: HaloRect[] = [];
  const targetSel = activeTargetId ? `[${TARGET_ATTR}="${activeTargetId}"]` : null;
  const nodes = Array.from(doc.querySelectorAll<HTMLElement>(SELECTOR));
  for (const el of nodes) {
    if (el.closest(`[${OVERLAY_ATTR}]`)) continue;
    const inTarget = targetSel !== null && el.closest(targetSel) !== null;
    if (inTarget && !focusBand) continue;
    const control =
      el.hasAttribute('role') || el.hasAttribute('data-testid') || el.hasAttribute('aria-label');
    let text: string | null = null;
    if (!control) {
      if (el.childElementCount !== 0) continue;
      text = (el.textContent ?? '').trim();
      if (!text) continue;
    }
    const visible = (el as { checkVisibility?: (o?: object) => boolean }).checkVisibility;
    if (typeof visible === 'function' && !visible.call(el, { opacityProperty: true })) continue;
    const b = el.getBoundingClientRect();
    const rect = {
      left: b.left - origin.x,
      top: b.top - origin.y,
      width: b.width,
      height: b.height,
    };
    if (inTarget && focusBand && intersects(rect, focusBand)) continue;
    if (isChromeCandidate({ rect, control, text }, viewport)) out.push(rect);
  }
  return out;
}

export interface FocusRects {
  /** The descendant that ends the band (`focus.through`), or `null`. */
  through: HaloRect | null;
  /** The target's first element child — its content box without the
   *  wrapper's outer margin — so the band starts at the panel's paper
   *  rather than 16 px of margin above it. */
  from: HaloRect | null;
}

/**
 * Rects (overlay coordinates) that bound the focus band inside the
 * active target's DOM subtree: `through` is the first `focus.through`
 * candidate found (text candidates match a button or leaf element whose
 * trimmed text equals the label exactly), `from` the target's first
 * child. `null` when the target is not in the DOM.
 */
export function findFocusRect(
  doc: Document,
  targetId: string,
  focus: TargetFocus,
  origin: { x: number; y: number },
): FocusRects | null {
  const root = doc.querySelector<HTMLElement>(`[${TARGET_ATTR}="${targetId}"]`);
  if (!root) return null;
  const toRect = (el: Element | null): HaloRect | null => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) return null;
    return { left: b.left - origin.x, top: b.top - origin.y, width: b.width, height: b.height };
  };
  let through: HaloRect | null = null;
  for (const c of focus.through) {
    let el: HTMLElement | null = null;
    if ('testId' in c) {
      el = root.querySelector<HTMLElement>(`[data-testid="${c.testId}"]`);
    } else {
      for (const cand of Array.from(
        root.querySelectorAll<HTMLElement>('[role="button"], div[dir="auto"]'),
      )) {
        if ((cand.textContent ?? '').trim() === c.text) {
          el = cand;
          break;
        }
      }
    }
    through = toRect(el);
    if (through) break;
  }
  return { through, from: toRect(root.firstElementChild) };
}
