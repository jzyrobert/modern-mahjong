import type { Seat } from '@mahjong/game-logic';
import type { ReplayBookmark, ReplayFrame, ReplayPlayerMeta } from './types';

const SEAT_LABEL: Record<Seat, string> = {
  0: 'East',
  1: 'South',
  2: 'West',
  3: 'North',
};

// Inlined from ui/winds.ts so bookmark derivation can be exercised
// without dragging in the React-Native UI module graph (e.g. tests
// that import bookmarks shouldn't have to mock RN).
const SEAT_GLYPH = ['東', '南', '西', '北'] as const;

function nameFor(seat: Seat, players: Record<Seat, ReplayPlayerMeta | null>): string {
  return players[seat]?.displayName ?? SEAT_LABEL[seat];
}

function seatGlyph(seat: Seat): string {
  return SEAT_GLYPH[seat];
}

/**
 * Walk a finalised frame list and surface key moments as bookmarks for
 * the scrubber strip. Single pass, O(N) over frames × events.
 *
 * "Robbed gang" detection: a `won` event in the same frame whose
 * preceding state had `pendingPromotedGang` set indicates 搶槓. We
 * special-case the bookmark label so the scrubber pip reads as the
 * dramatic moment it is rather than a plain win.
 */
export function deriveBookmarks(
  frames: ReplayFrame[],
  players: Record<Seat, ReplayPlayerMeta | null>,
): ReplayBookmark[] {
  const bookmarks: ReplayBookmark[] = [];
  let handIndex = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const prevState = i > 0 ? frames[i - 1]!.state : null;
    for (const event of frame.events) {
      switch (event.t) {
        case 'handStarted': {
          handIndex++;
          const dealer = frame.state.dealer;
          bookmarks.push({
            seq: i,
            kind: 'hand-start',
            label: `Hand ${handIndex} — ${nameFor(dealer, players)} ${seatGlyph(dealer)} dealing`,
          });
          break;
        }
        case 'gangDeclared': {
          bookmarks.push({
            seq: i,
            kind: 'gang',
            label: `${nameFor(event.seat, players)} declares ${event.kind} gang (槓)`,
          });
          break;
        }
        case 'won': {
          const robbed = prevState?.pendingPromotedGang !== undefined;
          if (robbed && prevState) {
            bookmarks.push({
              seq: i,
              kind: 'robbed-gang',
              label: `${nameFor(event.seat, players)} robs the gang off ${nameFor(prevState.pendingPromotedGang!.seat, players)} for ${event.faan} faan (搶槓)`,
            });
          } else {
            bookmarks.push({
              seq: i,
              kind: 'win',
              label: `${nameFor(event.seat, players)} wins ${event.faan} faan${event.selfDraw ? ' (self-draw)' : ''}`,
            });
          }
          break;
        }
        case 'drawn-game': {
          bookmarks.push({
            seq: i,
            kind: 'draw',
            label: 'Wall empty — drawn hand',
          });
          break;
        }
      }
    }
  }
  return bookmarks;
}
