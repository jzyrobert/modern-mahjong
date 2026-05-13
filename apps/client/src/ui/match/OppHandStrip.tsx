import type { Meld, Seat, Wind } from '@mahjong/game-logic';
import { type BotKind, botDisplayName } from '@mahjong/protocol';
import { Text, View } from 'react-native';
import type { LobbyState } from '../../state/game';
import { COLORS as SHARED_COLORS } from '../colors';
import { WIND_GLYPH } from '../winds';
import { MeldStrip } from './MeldStrip';
import { type Position, SEAT_COLOR } from './seatColor';

interface OppHandStripProps {
  seat: Seat;
  seatWind: Wind;
  /** Perimeter slot this opponent occupies — drives the seat-coloured
   *  ring around the wind glyph so the strip's identity hue matches
   *  the underline on this seat's discards in `SharedDiscardPool`. */
  position: Position;
  lobby: LobbyState | null;
  /** This seat's exposed melds, rendered inline below the header. The
   *  earlier rendering of `handBacks` face-down tile rectangles was
   *  dropped: the count was inferable from "did they discard yet" via
   *  the active-turn cue, and the strip ate ~30 px per seat × 3 seats
   *  of vertical space on a phone for visual filler. */
  melds: readonly Meld[];
  /** Highlight when this seat is on the move. */
  isActive: boolean;
  /** Set when this seat would draw next once claims resolve AND the
   *  soft floor (`pendingClaims.deadlineMs`) has elapsed. Surfaces a
   *  static gold halo so the mobile felt mirrors the desktop
   *  PlayerBadge cue. Default false. */
  aboutToDraw?: boolean;
  /** Whole seconds until the hard fallback once `softExpiryMs` is
   *  crossed. Renders next to the name as "drawing in Ns" when set. */
  drawCountdown?: number | null;
  /** Whole seconds until `state.turnDeadlineMs` for this seat —
   *  rendered as "Ns left" when this seat is the active turn. Null
   *  when the rule is off, in solo, or this seat isn't active. */
  turnCountdown?: number | null;
}

const COLORS = {
  ...SHARED_COLORS,
  // OppHandStrip's "about-to-draw" gold halo uses a brighter
  // saturation than the shared `gold` (which targets win badges +
  // dealer ribbons). The opponent strip's halo competes with the
  // active-turn red glow for attention, so we lean into a more
  // luminous tone. Local override.
  gold: '#f3c54a',
};

// Compact tile dims for the inline meld row. Smaller than the previous
// 14×20 so the row can comfortably hold four chi/peng melds inside a
// 360 px portrait viewport — the previous 14 px tiles + `PENG`/`CHI`
// kind labels ate enough horizontal room that the fourth meld
// overflowed onto a second row.
const MELD_TILE_W = 12;
const MELD_TILE_H = 18;

/**
 * Compact opponent strip — header row at the top (wind glyph + display
 * name + bot/difficulty marker on a single line) and the seat's exposed
 * melds inline below. Active-turn picks up a red fill + gold border +
 * soft glow, held statically: an earlier 1.03x scale pulse made the
 * card visibly grow each cycle and shifted the rows below it on a
 * tight portrait phone. The "next about to draw" cue is a static gold
 * halo so the two highlights don't fight for attention.
 *
 * The pre-2026-05 layout stacked wind / name / BOT vertically in a
 * 64-px left column with the meld strip on the right. That ate ~80 px
 * vertical per card × three opponents = 240 px before the discard pool
 * even rendered. The new single-line header drops card height to ~50
 * px (header ~24 px + meld row ~24 px) and surfaces the bot's
 * difficulty inline as `Bot (Easy)` so the user can tell at a glance
 * which opponent is the soft target.
 */
export function OppHandStrip({
  seat,
  seatWind,
  position,
  lobby,
  melds,
  isActive,
  aboutToDraw = false,
  drawCountdown = null,
  turnCountdown = null,
}: OppHandStripProps) {
  const player = lobby?.players.find((p) => p.seat === seat);
  const name = player?.displayName ?? `Seat ${seat}`;
  const isBot = player?.isBot ?? false;
  const botKind = (player?.botKind ?? null) as BotKind | null;
  const botStatus = isBot && botKind ? botDisplayName(botKind) : isBot ? 'Bot' : null;

  // `aboutToDraw` only surfaces when this seat is *not* the current
  // turn (it's the "next" seat). Active-turn cue takes priority.
  const cueBorder = !isActive && aboutToDraw;

  return (
    <View
      style={{
        backgroundColor: isActive ? COLORS.redHot : COLORS.paperHi,
        borderColor: isActive ? COLORS.gold : cueBorder ? COLORS.gold : COLORS.hairline,
        // Stays 2 px in every state — toggling 1↔2 with `isActive`
        // grew the card by 1 px on each side when the turn rotated
        // and shifted the rows below it on a portrait phone.
        borderWidth: 2,
        borderRadius: 10,
        paddingVertical: 6,
        paddingHorizontal: 10,
        gap: melds.length > 0 ? 4 : 0,
        boxShadow: isActive
          ? `0px 4px 12px ${COLORS.redHot}73`
          : cueBorder
            ? '0px 0px 8px rgba(243,197,74,0.5)'
            : 'none',
      }}
    >
      {/* Single-line header — wind glyph (small ring), name, bot
          status, and any active-turn / about-to-draw countdown. All
          inline so the card height collapses to the row height. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 2,
            // Stays seat-coloured even on the active red fill — the
            // three opponent palette entries (jade / mauve / sky) are
            // all distinct from `redHot`, and keeping the ring colour
            // stable means the user can still cross-reference a discard
            // underline against the strip while it's lit up.
            borderColor: SEAT_COLOR[position],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: 11,
              lineHeight: 13,
              color: isActive ? 'white' : COLORS.red,
              fontWeight: '700',
            }}
          >
            {WIND_GLYPH[seatWind]}
          </Text>
        </View>
        <Text
          style={{
            fontSize: 12,
            fontWeight: '800',
            color: isActive ? 'white' : COLORS.ink,
            // Cap name width so a long human displayName doesn't push
            // the bot-status chip off the row on a narrow portrait
            // viewport. 110 px fits ~10 chars of bold-weight Inter,
            // which is enough for the entire `BOT_NAME_POOL` plus the
            // server's 32-char human cap with truncation.
            maxWidth: 110,
          }}
          numberOfLines={1}
        >
          {name}
        </Text>
        {botStatus ? (
          <View
            style={{
              backgroundColor: isActive ? 'rgba(255,255,255,0.18)' : 'rgba(115,90,163,0.12)',
              borderRadius: 4,
              paddingVertical: 1,
              paddingHorizontal: 5,
            }}
          >
            <Text
              style={{
                fontSize: 9,
                fontWeight: '800',
                letterSpacing: 0.3,
                color: isActive ? 'rgba(255,255,255,0.92)' : '#735aa3',
              }}
            >
              {botStatus}
            </Text>
          </View>
        ) : null}
        {/* Spacer pushes any countdown chip to the right edge. */}
        <View style={{ flex: 1 }} />
        {cueBorder && drawCountdown !== null ? (
          <Text style={{ fontSize: 9, fontWeight: '800', color: COLORS.red }} numberOfLines={1}>
            drawing in {drawCountdown}s
          </Text>
        ) : null}
        {isActive && turnCountdown !== null ? (
          <Text style={{ fontSize: 9, fontWeight: '800', color: 'white' }} numberOfLines={1}>
            {turnCountdown}s left
          </Text>
        ) : null}
      </View>
      {/* Melds row — inline tiles, no kind labels (the user can read
          the meld shape from the tile arrangement). Hidden entirely
          when the seat has no exposed melds so the card collapses
          back to header-height alone. */}
      {melds.length > 0 ? (
        <MeldStrip
          melds={melds}
          tileWidth={MELD_TILE_W}
          tileHeight={MELD_TILE_H}
          showKindLabel={false}
        />
      ) : null}
    </View>
  );
}
