import type { Meld, Seat, Wind } from '@mahjong/game-logic';
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
  /** This seat's exposed melds, rendered inline on the right of the
   *  strip. Empty list → the meld area is left blank. The previous
   *  rendering of `handBacks` face-down tile rectangles was dropped:
   *  the count was inferable from "did they discard yet" via the
   *  active-turn cue, and the strip ate ~30 px per seat × 3 seats of
   *  vertical space on a phone for visual filler. Inlining the melds
   *  here also collapses the separate MeldStrip row that used to sit
   *  below the OppHandStrip — saves another row when an opponent has
   *  exposed any melds. */
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

/**
 * Compact opponent strip — wind glyph + display name on the left, the
 * seat's exposed melds inline on the right. Active-turn picks up a red
 * fill + gold border + soft glow, held statically: an earlier 1.03x
 * scale pulse made the card visibly grow each cycle and shifted the
 * rows below it on a tight portrait phone. The "next about to draw"
 * cue is a static gold halo so the two highlights don't fight for
 * attention.
 *
 * The legacy strip of face-down tile rectangles was dropped to reclaim
 * mobile vertical space — see the `melds` prop comment above.
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

  // `aboutToDraw` only surfaces when this seat is *not* the current
  // turn (it's the "next" seat). Active-turn cue takes priority.
  const cueBorder = !isActive && aboutToDraw;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: isActive ? COLORS.redHot : COLORS.paperHi,
        borderColor: isActive ? COLORS.gold : cueBorder ? COLORS.gold : COLORS.hairline,
        // Stays 2 px in every state — toggling 1↔2 with `isActive`
        // grew the card by 1 px on each side when the turn rotated
        // and shifted the rows below it on a portrait phone.
        borderWidth: 2,
        borderRadius: 10,
        paddingVertical: 6,
        paddingHorizontal: 10,
        boxShadow: isActive
          ? `0px 4px 12px ${COLORS.redHot}73`
          : cueBorder
            ? '0px 0px 8px rgba(243,197,74,0.5)'
            : 'none',
      }}
    >
      <View style={{ alignItems: 'center', minWidth: 64, gap: 1 }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
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
              fontSize: 14,
              color: isActive ? 'white' : COLORS.red,
              fontWeight: '700',
            }}
          >
            {WIND_GLYPH[seatWind]}
          </Text>
        </View>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '800',
            color: isActive ? 'white' : COLORS.ink,
          }}
          numberOfLines={1}
        >
          {name}
        </Text>
        {isBot ? (
          <Text
            style={{
              fontSize: 8,
              color: isActive ? 'rgba(255,255,255,0.85)' : COLORS.ink3,
              fontWeight: '700',
            }}
          >
            BOT
          </Text>
        ) : null}
        {cueBorder && drawCountdown !== null ? (
          <Text style={{ fontSize: 8, fontWeight: '800', color: COLORS.red }} numberOfLines={1}>
            drawing in {drawCountdown}s
          </Text>
        ) : null}
        {isActive && turnCountdown !== null ? (
          <Text
            style={{
              fontSize: 8,
              fontWeight: '800',
              color: isActive ? 'white' : COLORS.red,
            }}
            numberOfLines={1}
          >
            {turnCountdown}s left
          </Text>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        {melds.length > 0 ? <MeldStrip melds={melds} tileWidth={14} tileHeight={20} /> : null}
      </View>
    </View>
  );
}
