import type { HaloRect } from './placement';

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
}

export function collectChromeRects({
  doc,
  origin,
  viewport,
  activeTargetId,
}: CollectOptions): HaloRect[] {
  const out: HaloRect[] = [];
  const targetSel = activeTargetId ? `[${TARGET_ATTR}="${activeTargetId}"]` : null;
  const nodes = Array.from(doc.querySelectorAll<HTMLElement>(SELECTOR));
  for (const el of nodes) {
    if (el.closest(`[${OVERLAY_ATTR}]`)) continue;
    if (targetSel && el.closest(targetSel)) continue;
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
    if (isChromeCandidate({ rect, control, text }, viewport)) out.push(rect);
  }
  return out;
}
