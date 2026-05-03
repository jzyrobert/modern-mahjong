/**
 * App-wide design tokens. Ported from the "Mahjong" design comp at
 * `/tmp/design/design/menu.jsx` + `tile.jsx`. Aesthetic: warm-cream paper,
 * sage felt, soft red accent, rounded corners, no harsh shadows.
 *
 * Colours are in `oklch()` so hue/chroma can be retuned without
 * recomputing every related shade.
 */

/** App background — used by splash, status bar, and the Android shell config. */
export const SURFACE_BG = '#f1eadc';

/** Light paper / card background. */
export const PAPER = 'oklch(0.97 0.01 80)';
/** Slightly brighter paper for raised cards. */
export const PAPER_HI = 'oklch(0.99 0.005 85)';
/** App-default cream backdrop. */
export const CREAM = 'oklch(0.95 0.02 85)';

/** Primary ink — text, headings. */
export const INK = 'oklch(0.25 0.04 60)';
/** Secondary ink — body. */
export const INK_2 = 'oklch(0.4 0.04 60)';
/** Tertiary ink — labels, meta. */
export const INK_3 = 'oklch(0.55 0.04 60)';

/** Subtle hairline stroke for cards / inputs. */
export const HAIRLINE = 'oklch(0.86 0.02 80)';

/** Sage felt — table surface base. */
export const FELT = 'oklch(0.4 0.05 145)';
/** Slightly deeper sage — table edge. */
export const FELT_2 = 'oklch(0.32 0.05 150)';

/** Brand red — used on primary buttons, the wind-character emblem, and the brand 麻雀 gloss. */
export const RED = 'oklch(0.55 0.18 25)';
/** Hot red on hover. */
export const RED_HOT = 'oklch(0.62 0.2 28)';
/** Gold accent — wind glyph in brand mark, gold on the felt-edge inner ring. */
export const GOLD = 'oklch(0.78 0.14 80)';

/** Default tile-back gradient stops. The `<Tile>` component's `--tile-back-1/2`
 * CSS vars resolve to these unless an in-app skin override is set. */
export const TILE_BACK_1 = 'oklch(0.72 0.08 200)';
export const TILE_BACK_2 = 'oklch(0.62 0.09 210)';

/** Legacy single-stop tile-back colour. Some places still reference this; new
 * code should use the gradient pair via the `--tile-back-1/2` CSS vars. */
export const TILE_BACK_BG = 'oklch(0.67 0.085 205)';

/**
 * Per-seat colour tokens. Used on the mobile shared-discard pool to
 * underline each tile with its discarder's seat colour, and as an
 * accent on each opponent's avatar.
 */
export const SEAT_COLOR = {
  bottom: 'oklch(0.68 0.18 28)', // coral — you
  right: 'oklch(0.68 0.14 165)', // jade
  top: 'oklch(0.68 0.14 320)', // mauve
  left: 'oklch(0.68 0.14 240)', // sky
} as const;

/** Font stacks. */
export const SERIF = "'Noto Serif TC', 'Songti SC', serif";
export const SANS = "'Nunito', system-ui, sans-serif";
export const MONO = "'JetBrains Mono', ui-monospace, monospace";
