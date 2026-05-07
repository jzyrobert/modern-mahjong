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

/**
 * Seat-indexed wind glyph for surfaces that show a seat's *permanent*
 * label rather than the dealer-relative round-wind. Seat 0 is always
 * East / 東, seat 1 South / 南, seat 2 West / 西, seat 3 North / 北 —
 * the engine's `WINDS` array in this exact order, paired with the
 * matching glyph from `WIND_GLYPH`. Used by the GameLog seat tag, the
 * LobbyPreview seat cards, and the Match lobby waiting-room — all of
 * which want a stable label that doesn't shift with dealer rotation.
 */
export const SEAT_WIND_GLYPH = ['東', '南', '西', '北'] as const;
