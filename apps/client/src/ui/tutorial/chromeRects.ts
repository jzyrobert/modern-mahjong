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
/** Tallest element that still counts as a control. The 3D table's
 *  projected hand tiles run to ~80 CSS px on a landscape phone and the
 *  registered own-hand row (tiles + 6 px pad) to ~90 on desktop; both
 *  must count (the ring is trimmed to them, cards keep clear of them —
 *  the dice card docks beside the modal instead of over the hand).
 *  Regions (discard pool, result panel) are hundreds of px. */
export const CHROME_MAX_HEIGHT = 100;
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
/** Subtrees the scan skips: a modal fading *out* (the opening-rolls
 *  panel after its step advances) is still opaque enough to pass
 *  `checkVisibility`, yet its labels are not chrome the next card
 *  should dodge — counting them tinted the own-hand card solid for the
 *  ~300 ms of the fade. */
export const IGNORE_ATTR = 'data-tutorial-ignore';

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
    if (el.closest(`[${OVERLAY_ATTR}], [${IGNORE_ATTR}]`)) continue;
    const inTarget = targetSel !== null && el.closest(targetSel) !== null;
    if (inTarget && !focusBand) continue;
    // An element that *contains* the spotlit target is the slot it sits
    // in (the portrait action tray, the footer's claim-float row), not a
    // neighbouring control: counting it grew the ring to the slot's
    // height — 104 px around a 40 px tsumo button — and shifted the
    // claim-strip ring off the strip.
    if (targetSel !== null && !inTarget && el.querySelector(targetSel) !== null) continue;
    const control =
      el.hasAttribute('role') || el.hasAttribute('data-testid') || el.hasAttribute('aria-label');
    // A labelled container that paints nothing of its own and holds other
    // candidates is a layout slot (the portrait action tray around the
    // turn / table chips, the footer's claim-float row), not a control a
    // card could bisect — its chips are scanned in their own right. The
    // tray's 96 px otherwise counted as chrome the card had to clear whole,
    // which no strip in the 146 px band under the hand could.
    if (control && isLayoutSlot(el)) continue;
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

/** True for an element with element children, at least one of them a
 *  scan candidate, whose own box paints nothing: no background, border
 *  or shadow. Transparent hit targets (leaf buttons over the canvas) have
 *  no children and stay. */
export function isLayoutSlot(el: HTMLElement): boolean {
  if (el.childElementCount === 0 || el.querySelector(SELECTOR) === null) return false;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const cs = view.getComputedStyle(el);
  const bg = cs.backgroundColor;
  const transparent = bg === 'transparent' || /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$/.test(bg);
  if (!transparent) return false;
  if (cs.backgroundImage !== 'none' || (cs.boxShadow !== 'none' && cs.boxShadow !== ''))
    return false;
  const widths = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth];
  return widths.every((w) => w === '0px' || w === '' || Number.parseFloat(w) === 0);
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

/** Elements a *centred* (no-target) card must keep off entirely, like
 *  the hand: the portrait seat strip (`data-testid="seat-strip"`). It is
 *  chrome a docked card or a strip may still cover whole (the top strip
 *  under a river ring has nowhere else to go), but a centred card has
 *  the whole free band to size itself into and so never sits on it. */
const KEEP_OUT_SELECTOR = '[data-testid="seat-strip"]';

/** Rects (overlay coordinates) of the keep-out elements on the page —
 *  visible ones only; a strip faded out for a claim toast is not there. */
export function collectKeepOutRects(doc: Document, origin: { x: number; y: number }): HaloRect[] {
  const out: HaloRect[] = [];
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>(KEEP_OUT_SELECTOR))) {
    if (el.closest(`[${OVERLAY_ATTR}], [${IGNORE_ATTR}]`)) continue;
    const visible = (el as { checkVisibility?: (o?: object) => boolean }).checkVisibility;
    if (typeof visible === 'function' && !visible.call(el, { opacityProperty: true })) continue;
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) continue;
    out.push({ left: b.left - origin.x, top: b.top - origin.y, width: b.width, height: b.height });
  }
  return out;
}

/** Slack for a tile that rides above its row: the classic shells lift the
 *  drawn tile 10 px past the wrapper's 4 px pad. */
const TILE_IN_PLACE_PAD = 12;

/**
 * True when every visible `own-hand-tile` hit target lies inside the
 * registered `own-hand` wrapper (with `TILE_IN_PLACE_PAD` of slack), or
 * there is no hand. The 3D shell moves its hit targets with the tiles
 * once per rendered frame, so a scan taken while the deal is still in
 * flight — or before the shell's first frame after a stall — sees tiles
 * far above the row and reads a collapsed room; the card waits for a
 * scan where the tiles sit where the row says they are.
 */
export function handTilesInPlace(doc: Document): boolean {
  const hand = doc.querySelector<HTMLElement>(`[${TARGET_ATTR}="own-hand"]`);
  if (!hand) return true;
  const h = hand.getBoundingClientRect();
  if (h.width <= 0 || h.height <= 0) return true;
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="own-hand-tile"]'))) {
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) continue;
    if (
      b.left < h.left - TILE_IN_PLACE_PAD ||
      b.right > h.right + TILE_IN_PLACE_PAD ||
      b.top < h.top - TILE_IN_PLACE_PAD ||
      b.bottom > h.bottom + TILE_IN_PLACE_PAD
    )
      return false;
  }
  return true;
}
