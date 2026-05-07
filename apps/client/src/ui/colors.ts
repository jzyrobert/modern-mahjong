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
  /** Success green — used for connection indicators, valid-state
   *  switches, and Scoreboard chip dots. */
  green: '#58c280',
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
