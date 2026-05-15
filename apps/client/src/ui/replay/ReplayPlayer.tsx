import { SEATS, type Seat, seatWindFor, tileId, tileLabel } from '@mahjong/game-logic';
import { useMemo } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { type PlaybackPov, usePlayback } from '../../replay/playback';
import { Hand } from '../Hand';
import { Tile } from '../Tile';
import { COLORS } from '../colors';
import { MeldStrip } from '../match/MeldStrip';
import { type Position, SEAT_COLOR } from '../match/seatColor';
import { SEAT_WIND_GLYPH, WIND_GLYPH } from '../winds';
import { Scrubber } from './Scrubber';

/**
 * Read-only match shell rendered for a `ReplayRecord`'s current frame.
 * Mounts inside a `<PlaybackProvider>` so the cursor / pov / autoplay
 * state come from `usePlayback()`. No transport, no engine; everything
 * derives from the recorded `frames[cursor].state`.
 *
 * Layout adapts to viewport:
 *   - Phone portrait (height ≥ width): single vertical stack
 *     (header → discards → opponent seat rows → local seat → event
 *     strip) sized to fit a 412×906 window without scrolling.
 *   - Phone landscape (width > height, height < 540): two-column
 *     split — left column holds the board (discards + seat rows),
 *     right column holds the header / event strip stacked vertically.
 *     The `<Scrubber>` is always pinned to the bottom across the
 *     entire width.
 *   - Wider viewports keep the legacy vertical stack with a slightly
 *     looser tile size.
 */
export function ReplayPlayer() {
  const playback = usePlayback();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height && height < 540;
  const isCompactPortrait = !isLandscape && width < 480;

  // Order seats so the local player ends up at the bottom of the
  // vertical stack — matches the live MobileShell convention. When
  // the local seat is `'spectator'`, fall back to natural seat order
  // (East → North).
  const localSeat = playback.header.localSeat;
  const pov = playback.pov;
  const orderedSeats = useOrderedSeats(localSeat);
  // Seat-keyed colour palette: the wind-glyph ring on each `SeatRow`
  // and the underline on its discards share the same hue so the
  // discard pool reads as "this came from that player". Mirrors the
  // live perimeter `SEAT_COLOR` keying via `positionMapFor` (POV
  // anchors to the bottom seat).
  const seatColor = useMemo<Record<Seat, string>>(() => {
    const positions = positionMapFor(pov, localSeat);
    return {
      0: SEAT_COLOR[positions[0]],
      1: SEAT_COLOR[positions[1]],
      2: SEAT_COLOR[positions[2]],
      3: SEAT_COLOR[positions[3]],
    };
  }, [pov, localSeat]);

  const density: Density = isLandscape ? 'landscape' : isCompactPortrait ? 'portrait' : 'roomy';

  if (isLandscape) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
        <View
          style={{ flex: 1, flexDirection: 'row', paddingHorizontal: 6, paddingTop: 4, gap: 6 }}
        >
          {/* Left column: discards + seat rows */}
          <ScrollView
            style={{ flex: 3 }}
            contentContainerStyle={{ gap: 4, paddingBottom: 4 }}
            showsVerticalScrollIndicator={false}
          >
            <DiscardPool seatColor={seatColor} density={density} />
            {orderedSeats.map((seat) => (
              <SeatRow
                key={seat}
                seat={seat}
                pov={pov}
                isLocal={seat === localSeat}
                seatColor={seatColor[seat]}
                density={density}
              />
            ))}
          </ScrollView>
          {/* Right column: header + event strip */}
          <View style={{ flex: 2, gap: 4 }}>
            <Header density={density} />
            <EventStrip density={density} />
          </View>
        </View>
        <Scrubber compact />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingBottom: 8,
          paddingHorizontal: isCompactPortrait ? 6 : 10,
          paddingTop: 4,
          gap: isCompactPortrait ? 4 : 8,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Header density={density} />
        <DiscardPool seatColor={seatColor} density={density} />
        {orderedSeats.map((seat) => (
          <SeatRow
            key={seat}
            seat={seat}
            pov={pov}
            isLocal={seat === localSeat}
            seatColor={seatColor[seat]}
            density={density}
          />
        ))}
        <EventStrip density={density} />
      </ScrollView>
      <Scrubber compact={isCompactPortrait} />
    </View>
  );
}

type Density = 'portrait' | 'landscape' | 'roomy';

function useOrderedSeats(localSeat: Seat | 'spectator'): readonly Seat[] {
  if (localSeat === 'spectator') return SEATS;
  // Top → middle → middle → bottom (local last).
  // Across a phone-screen vertical stack we want the local seat
  // furthest from the top so the user reads "their" hand last,
  // matching the live MobileShell layout convention.
  const others: Seat[] = SEATS.filter((s) => s !== localSeat);
  return [...others, localSeat];
}

function Header({ density }: { density: Density }) {
  const playback = usePlayback();
  const { header, state, cursor, totalFrames } = playback;
  const compact = density !== 'roomy';
  const padding = compact ? 6 : 12;
  return (
    <View
      style={{
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        padding,
        gap: compact ? 2 : 4,
      }}
    >
      <Text
        style={{
          fontSize: compact ? 11 : 16,
          fontWeight: '900',
          color: COLORS.ink,
        }}
        numberOfLines={1}
      >
        {playerLineFor(header, compact)}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: compact ? 8 : 12,
          rowGap: 2,
        }}
      >
        <Stat label="Phase" value={state.phase} compact={compact} />
        <Stat
          label="Hand"
          value={`${header.handsPlayed > 0 ? header.handsPlayed : '—'}`}
          compact={compact}
        />
        <Stat label="Wall" value={`${state.wall.length}`} compact={compact} />
        <Stat
          label="Wind"
          value={WIND_GLYPH[state.prevailingWind]}
          fontFamily="Noto Serif TC"
          compact={compact}
        />
        <Stat label="Frame" value={`${cursor + 1}/${totalFrames}`} compact={compact} />
      </View>
    </View>
  );
}

function Stat({
  label,
  value,
  fontFamily,
  compact,
}: {
  label: string;
  value: string;
  fontFamily?: string;
  compact?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
      <Text
        style={{
          fontSize: compact ? 8 : 9,
          fontWeight: '900',
          letterSpacing: 0.5,
          color: COLORS.ink3,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        style={{
          fontSize: compact ? 10 : 12,
          fontWeight: '900',
          color: COLORS.ink,
          fontFamily,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function playerLineFor(header: ReturnType<typeof usePlayback>['header'], compact: boolean): string {
  const parts: string[] = [];
  for (const seat of SEATS) {
    const p = header.players[seat];
    const youTag = seat === header.localSeat ? (compact ? '*' : ' (you)') : '';
    const name = p ? p.displayName : `S${seat}`;
    parts.push(`${SEAT_WIND_GLYPH[seat]} ${name}${youTag}`);
  }
  return parts.join(compact ? ' · ' : '  ·  ');
}

function tileSizeFor(density: Density): { w: number; h: number } {
  if (density === 'portrait') return { w: 18, h: 24 };
  if (density === 'landscape') return { w: 16, h: 22 };
  return { w: 22, h: 30 };
}

function handTileSizeFor(density: Density): { w: number; h: number } {
  if (density === 'portrait') return { w: 22, h: 30 };
  if (density === 'landscape') return { w: 18, h: 26 };
  return { w: 26, h: 36 };
}

function DiscardPool({
  seatColor,
  density,
}: {
  seatColor: Record<Seat, string>;
  density: Density;
}) {
  const playback = usePlayback();
  const state = playback.state;
  const order = state.discardOrder;
  const compact = density !== 'roomy';
  const padding = compact ? 6 : 8;
  if (order.length === 0) {
    return (
      <View
        style={{
          backgroundColor: COLORS.creamLow,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          borderRadius: 8,
          padding,
        }}
      >
        <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '700' }}>No discards yet</Text>
      </View>
    );
  }
  // Highlight the last-discarded tile (the one the engine has flagged
  // in `state.lastDiscard`) so the viewer can see what was discarded
  // in this frame.
  const lastId = state.lastDiscard ? tileId(state.lastDiscard.tile) : null;
  const size = tileSizeFor(density);
  return (
    <View
      style={{
        backgroundColor: COLORS.creamLow,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        padding,
      }}
    >
      <Text
        style={{
          fontSize: 9,
          fontWeight: '900',
          color: COLORS.ink3,
          letterSpacing: 0.6,
          marginBottom: 3,
        }}
      >
        DISCARDS · {order.length}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
        {order.map((entry, i) => {
          const id = tileId(entry.tile);
          const isLast = id === lastId;
          return (
            <View key={`${i}-${id}`} style={{ alignItems: 'center', gap: 1 }}>
              <View
                style={{
                  borderColor: isLast ? COLORS.red : 'transparent',
                  borderWidth: 1.5,
                  borderRadius: 4,
                }}
              >
                <Tile tile={entry.tile} width={size.w} height={size.h} />
              </View>
              <View
                style={{
                  width: size.w - 4,
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: seatColor[entry.from],
                }}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

// Mirror the live match's bottom-seat-is-you convention so the underline
// colour for a given player's discards matches their badge / hand strip.
// When the user is watching from a specific seat (POV picker), that seat
// anchors at the bottom; otherwise fall back to the recorded local seat,
// then to East (seat 0) for spectator recordings.
const POSITION_CYCLE: readonly Position[] = ['bottom', 'right', 'top', 'left'];
function positionMapFor(pov: PlaybackPov, localSeat: Seat | 'spectator'): Record<Seat, Position> {
  const anchor: Seat = pov !== 'all' ? pov : localSeat !== 'spectator' ? localSeat : 0;
  return {
    0: POSITION_CYCLE[(0 - anchor + 4) % 4]!,
    1: POSITION_CYCLE[(1 - anchor + 4) % 4]!,
    2: POSITION_CYCLE[(2 - anchor + 4) % 4]!,
    3: POSITION_CYCLE[(3 - anchor + 4) % 4]!,
  };
}

function SeatRow({
  seat,
  pov,
  isLocal,
  seatColor,
  density,
}: {
  seat: Seat;
  pov: PlaybackPov;
  isLocal: boolean;
  seatColor: string;
  density: Density;
}) {
  const playback = usePlayback();
  const state = playback.state;
  const player = playback.header.players[seat];
  const name = player?.displayName ?? `Seat ${seat}`;
  const isBot = player?.isBot ?? false;
  const tiles = state.hands[seat];
  const melds = state.melds[seat];
  const score = state.scoreboard[seat];
  // Face-up rules: if pov === 'all', everyone is face-up. Otherwise,
  // only the seat matching pov is face-up; others get face-down so
  // the user can re-watch as if they were that seat.
  const faceUp = pov === 'all' || pov === seat;
  const isActive = state.phase === 'turn' && state.turn === seat;
  const isDealer = state.dealer === seat;
  const seatWind = seatWindFor(state.dealer, seat);
  const compact = density !== 'roomy';
  const handSize = handTileSizeFor(density);
  return (
    <View
      style={{
        backgroundColor: isLocal ? COLORS.paperHi : COLORS.creamLow,
        borderColor: isActive ? COLORS.red : COLORS.hairline,
        borderWidth: isActive ? 2 : 1,
        borderRadius: 8,
        padding: compact ? 5 : 8,
        gap: compact ? 3 : 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View
          style={{
            width: compact ? 20 : 26,
            height: compact ? 20 : 26,
            borderRadius: compact ? 10 : 13,
            borderWidth: 2,
            borderColor: seatColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: compact ? 11 : 14,
              color: COLORS.red,
              fontWeight: '700',
            }}
          >
            {WIND_GLYPH[seatWind]}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: compact ? 11 : 13,
              fontWeight: '900',
              color: COLORS.ink,
            }}
            numberOfLines={1}
          >
            {name}
            {isLocal ? ' (you)' : ''}
            {isBot ? ' · BOT' : ''}
            {isDealer ? ' · DEALER' : ''}
          </Text>
          <Text
            style={{
              fontSize: compact ? 9 : 10,
              color: COLORS.ink3,
              fontWeight: '700',
            }}
          >
            {tiles.length} tile{tiles.length === 1 ? '' : 's'} · {score >= 0 ? `+${score}` : score}
          </Text>
        </View>
        {!faceUp ? (
          <Text style={{ fontSize: 9, color: COLORS.ink3, fontWeight: '700' }}>HIDDEN</Text>
        ) : null}
      </View>
      {melds.length > 0 ? <MeldStrip melds={melds} /> : null}
      <Hand
        tiles={tiles}
        faceDown={!faceUp}
        sortMode="suit"
        tileWidth={handSize.w}
        tileHeight={handSize.h}
      />
    </View>
  );
}

function EventStrip({ density }: { density: Density }) {
  const playback = usePlayback();
  const events = playback.events;
  if (events.length === 0) return null;
  const compact = density !== 'roomy';
  return (
    <View
      style={{
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        padding: compact ? 5 : 8,
        gap: compact ? 2 : 4,
      }}
    >
      <Text
        style={{
          fontSize: 9,
          fontWeight: '900',
          color: COLORS.ink3,
          letterSpacing: 0.6,
        }}
      >
        EVENTS
      </Text>
      {events.map((e, i) => (
        <Text
          // biome-ignore lint/suspicious/noArrayIndexKey: events array is stable per frame
          key={i}
          style={{ fontSize: compact ? 10 : 12, color: COLORS.ink, lineHeight: compact ? 14 : 16 }}
          numberOfLines={1}
        >
          • {describeEvent(e)}
        </Text>
      ))}
    </View>
  );
}

function describeEvent(e: ReturnType<typeof usePlayback>['events'][number]): string {
  switch (e.t) {
    case 'handStarted':
      return `Hand started (seed ${e.seed})`;
    case 'opened':
      return e.rolls.fullRoll ? 'Opening rolls — all four seats rolled' : 'Winner re-rolled';
    case 'rulesChanged':
      return 'Rules updated';
    case 'drew':
      return `Seat ${e.seat} drew a tile`;
    case 'discarded':
      return `Seat ${e.seat} discarded ${tileLabel(e.tile)}`;
    case 'claimsOpened':
      return 'Claim window open';
    case 'claimsResolved':
      if (e.result.kind === 'pass') return 'All passed';
      return `Seat ${e.result.seat} called ${e.result.claim.kind}`;
    case 'gangDeclared':
      return `Seat ${e.seat} declared ${e.kind} gang`;
    case 'won':
      return `Seat ${e.seat} won ${e.faan} faan${e.selfDraw ? ' (self-draw)' : ''}`;
    case 'drawn-game':
      return 'Drawn game — wall empty';
    default:
      return JSON.stringify(e);
  }
}
