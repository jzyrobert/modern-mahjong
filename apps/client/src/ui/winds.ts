import type { Wind } from '@mahjong/game-logic';

/**
 * Canonical wind-character glyph map used everywhere a wind is
 * surfaced in the UI — the GameStatusBar pill, OppHandStrip + PlayerBadge
 * seat icons, the players sheet roster, and the Scoreboard chips. Visual
 * presentation only, so it lives in the client (the engine package
 * exports the abstract `Wind` type but no rendering choice).
 *
 * Replaces five byte-identical `Record<Wind, string>` copies that were
 * scattered across `ui/` and `ui/match/`. Additions / character changes
 * (e.g. swapping the simplified East 东 for the traditional 東 we use
 * today) now happen in one place.
 */
export const WIND_GLYPH: Record<Wind, string> = {
  E: '東',
  S: '南',
  W: '西',
  N: '北',
};
