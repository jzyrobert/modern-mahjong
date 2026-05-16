/**
 * Shared neutral palette used across the client's UI surfaces.
 *
 * Most components had their own local `const COLORS = { ... }` with
 * byte-identical hex values for `ink` / `ink3` / `hairline` / `red` /
 * `red`/`green`/etc. — easy to drift if a designer changes one place
 * without the others. This module is the single source of truth for
 * the values; per-file palettes that need additional accents can
 * spread `COLORS` then add the file-specific keys.
 *
 * Migration is incremental. A file fully migrates when all of its
 * local palette keys also appear here; files with file-specific
 * accents (custom golds, status pills, etc.) can either spread or
 * keep their local map until a unifying shape emerges.
 */
export const COLORS = {
  /** Primary text — dark warm brown. */
  ink: '#3a3328',
  /** Mid-tone text — used for secondary labels and table separators. */
  ink2: '#65594c',
  /** Tertiary / hint text — muted brown-grey for captions, help text. */
  ink3: '#918275',
  /** Lightest paper background tone — goes under sheets and panels. */
  paperHi: '#fbf8f0',
  /** Default paper background. */
  paper: '#f1ebe0',
  /** Slightly cooler cream — used for press / hover states and
   *  log-card backgrounds. */
  cream: '#f1eadc',
  /** Recessed-surface cream — a step deeper than `cream`, used for
   *  inset cards (LobbyPreview seat tiles, the bot-skill picker
   *  container, MeldStrip, the lobby InlineHint), and as the
   *  press-state tone for buttons that sit directly on `paper` /
   *  `paperHi`. */
  creamLow: '#ece4d3',
  /** Deeper press-state tone — used by interactive surfaces that
   *  already sit on `creamLow` (the bot-skill picker chips, the
   *  REMOVE button on a bot card, the copy-match-code badge). */
  creamPressed: '#dfd4bc',
  /** Hairline border colour — used for almost every divider in the UI. */
  hairline: '#cdc1ad',
  /** Primary accent — the red used for dealer markers, claim
   *  highlights, and the YOUR TURN dot. */
  red: '#b14d3a',
  /** Brighter accent red — used for active / pulsing states (e.g.
   *  the YOUR TURN halo). */
  redHot: '#db5d4a',
  /** Success — semantic colour for "online / connected / valid /
   *  win-positive". Use the token directly for dots, accents, and
   *  switch tracks. For pill surfaces (text on a tinted bg with a
   *  tinted border) use `SUCCESS_PILL` below.
   *
   *  Nudged from the old `#58c280` to `#3aa066` — slightly darker /
   *  more saturated so it carries enough contrast to be used as fg
   *  text on the pill bg without needing a separate `#2d8645`
   *  literal. */
  success: '#3aa066',
  /** Soft gold — used for win badges, dealer ribbons, and "about to
   *  draw" cues. */
  gold: '#d8a85a',
  /** Salmon highlight bg — paired with `red` text for active /
   *  selected chip-style controls (mode-card RECOMMENDED badge,
   *  bot-skill active chip, sort-picker active option, win-banner
   *  body, destructive menu items). */
  accentSalmonSwatch: '#fbe5d9',
  /** Salmon edge — border tone for `accentSalmonSwatch` surfaces
   *  (RECOMMENDED badge, destructive Leave item in MenuSheet). */
  accentSalmonEdge: '#d8b09f',
};

/**
 * Pill recipe for status / state badges that mean "success" or
 * "online" — bg is a 12 % tint of `success`, the border a 35 %
 * tint, and the fg a darker shade tuned for text contrast on the
 * bg. Reach for this whenever a control needs to communicate a
 * positive / connected state via a tinted pill; keep brand-tone
 * literals (e.g. the LAN match-kind badge in `ReplayLibrary`)
 * separate so a future "tweak the success hue" task doesn't
 * accidentally repaint LAN branding.
 */
export const SUCCESS_PILL = {
  bg: 'rgba(58,160,102,0.12)',
  border: 'rgba(58,160,102,0.35)',
  fg: '#1f6a44',
} as const;

/**
 * Floating-panel chrome — every white pill that floats over the
 * felt table (status bar, top bar, portrait menu pill, replay
 * status pill) shares this recipe. Spread into a View's `style`
 * prop next to padding / flex props. The 0.92 alpha + tight
 * 14-blur drop shadow + 1px inner-border shadow gives the panel
 * enough definition to read on both light (sage) and dark (jade /
 * ocean) felt skins without per-skin tweaks; the inner-border
 * shadow replaces the manual `borderWidth: 1` some sites used
 * before.
 *
 * For the `boxShadow:` shorthand RN ≥ 0.76 + react-native-web both
 * accept this string; older RN targets would need the legacy
 * shadowColor / shadowOffset / shadowOpacity / shadowRadius
 * properties.
 */
export const PANEL_ON_FELT = {
  backgroundColor: 'rgba(255,255,255,0.92)',
  borderRadius: 12,
  boxShadow: '0px 4px 14px rgba(0,0,0,0.14), 0px 0px 0px 1px rgba(0,0,0,0.04)',
} as const;
