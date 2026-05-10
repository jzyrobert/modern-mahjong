import { type Tile as MTile, type Seat, seatWindFor, tileId, tileLabel } from '@mahjong/game-logic';
import { ScrollView, Text, View } from 'react-native';
import { type PlaybackPov, usePlayback } from '../../replay/playback';
import { Hand } from '../Hand';
import { Tile } from '../Tile';
import { COLORS } from '../colors';
import { MeldStrip } from '../match/MeldStrip';
import { SEAT_WIND_GLYPH, WIND_GLYPH } from '../winds';
import { Scrubber } from './Scrubber';

const SEATS: readonly Seat[] = [0, 1, 2, 3];

/**
 * Read-only match shell rendered for a `ReplayRecord`'s current frame.
 * Mounts inside a `<PlaybackProvider>` so the cursor / pov / autoplay
 * state come from `usePlayback()`. No transport, no engine; everything
 * derives from the recorded `frames[cursor].state`.
 *
 * Layout: vertical stack of seat strips (name + melds + face-up hand)
 * with the local seat anchored to the bottom, a shared discard pool
 * row, the current frame's event log, and the `<Scrubber>` strip
 * pinned to the bottom of the screen.
 */
export function ReplayPlayer() {
  const playback = usePlayback();
  const state = playback.state;

  // Order seats so the local player ends up at the bottom of the
  // vertical stack — matches the live MobileShell convention. When the
  // local seat is `'spectator'`, fall back to natural seat order
  // (East → North).
  const localSeat = playback.header.localSeat;
  const orderedSeats = useOrderedSeats(localSeat);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 12, paddingHorizontal: 10, gap: 8 }}
      >
        <Header />
        <DiscardPool />
        {orderedSeats.map((seat) => (
          <SeatRow key={seat} seat={seat} pov={playback.pov} isLocal={seat === localSeat} />
        ))}
        <EventStrip />
      </ScrollView>
      <Scrubber />
    </View>
  );
}

function useOrderedSeats(localSeat: Seat | 'spectator'): readonly Seat[] {
  if (localSeat === 'spectator') return SEATS;
  // Top → middle → middle → bottom (local last).
  // Across a phone-screen vertical stack we want the local seat
  // furthest from the top so the user reads "their" hand last,
  // matching the live MobileShell layout convention.
  const others: Seat[] = SEATS.filter((s) => s !== localSeat);
  // Order opponents in seat-order from the top down.
  return [...others, localSeat];
}

function Header() {
  const playback = usePlayback();
  const { header, state, cursor, totalFrames } = playback;
  return (
    <View
      style={{
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        gap: 4,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: '900', color: COLORS.ink }}>
        {playerLineFor(header)}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Stat label="Phase" value={state.phase} />
        <Stat label="Hand" value={`${header.handsPlayed > 0 ? header.handsPlayed : '—'}`} />
        <Stat label="Wall" value={`${state.wall.length}`} />
        <Stat
          label="Round wind"
          value={WIND_GLYPH[state.prevailingWind]}
          fontFamily="Noto Serif TC"
        />
        <Stat label="Frame" value={`${cursor + 1}/${totalFrames}`} />
      </View>
      <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '700' }}>
        {new Date(header.startedAt).toLocaleString()} · {Math.round(header.durationMs / 1000)}s
        played
      </Text>
    </View>
  );
}

function Stat({ label, value, fontFamily }: { label: string; value: string; fontFamily?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
      <Text
        style={{
          fontSize: 9,
          fontWeight: '900',
          letterSpacing: 0.5,
          color: COLORS.ink3,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        style={{
          fontSize: 12,
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

function playerLineFor(header: ReturnType<typeof usePlayback>['header']): string {
  const parts: string[] = [];
  for (const seat of SEATS) {
    const p = header.players[seat];
    const youTag = seat === header.localSeat ? ' (you)' : '';
    const name = p ? p.displayName : `Seat ${seat}`;
    parts.push(`${SEAT_WIND_GLYPH[seat]} ${name}${youTag}`);
  }
  return parts.join('  ·  ');
}

function DiscardPool() {
  const playback = usePlayback();
  const state = playback.state;
  // Show all discards merged from every seat, in chronological order.
  const allDiscards: Array<{ seat: Seat; tile: MTile; idx: number }> = [];
  for (const seat of SEATS) {
    state.discards[seat].forEach((tile, idx) => {
      allDiscards.push({ seat, tile, idx });
    });
  }
  if (allDiscards.length === 0) {
    return (
      <View
        style={{
          backgroundColor: COLORS.creamLow,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          borderRadius: 8,
          padding: 10,
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
  return (
    <View
      style={{
        backgroundColor: COLORS.creamLow,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        padding: 8,
      }}
    >
      <Text
        style={{
          fontSize: 9,
          fontWeight: '900',
          color: COLORS.ink3,
          letterSpacing: 0.6,
          marginBottom: 4,
        }}
      >
        DISCARDS · {allDiscards.length}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {allDiscards.map(({ seat, tile, idx }) => {
          const id = tileId(tile);
          const isLast = id === lastId;
          return (
            <View
              key={`${seat}-${idx}-${id}`}
              style={{
                borderColor: isLast ? COLORS.red : 'transparent',
                borderWidth: 1.5,
                borderRadius: 4,
              }}
            >
              <Tile tile={tile} width={22} height={30} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function SeatRow({
  seat,
  pov,
  isLocal,
}: {
  seat: Seat;
  pov: PlaybackPov;
  isLocal: boolean;
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
  return (
    <View
      style={{
        backgroundColor: isLocal ? COLORS.paperHi : COLORS.creamLow,
        borderColor: isActive ? COLORS.red : COLORS.hairline,
        borderWidth: isActive ? 2 : 1,
        borderRadius: 10,
        padding: 8,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 16,
            color: COLORS.red,
            fontWeight: '700',
            minWidth: 22,
            textAlign: 'center',
          }}
        >
          {WIND_GLYPH[seatWind]}
        </Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.ink }}>
            {name}
            {isLocal ? ' (you)' : ''}
            {isBot ? ' · BOT' : ''}
            {isDealer ? ' · DEALER' : ''}
          </Text>
          <Text style={{ fontSize: 10, color: COLORS.ink3, fontWeight: '700' }}>
            {tiles.length} tile{tiles.length === 1 ? '' : 's'} · {score >= 0 ? `+${score}` : score}
          </Text>
        </View>
        {!faceUp ? (
          <Text style={{ fontSize: 10, color: COLORS.ink3, fontWeight: '700' }}>HIDDEN</Text>
        ) : null}
      </View>
      {melds.length > 0 ? <MeldStrip melds={melds} /> : null}
      <Hand tiles={tiles} faceDown={!faceUp} sortMode="suit" tileWidth={26} tileHeight={36} />
    </View>
  );
}

function EventStrip() {
  const playback = usePlayback();
  const events = playback.events;
  if (events.length === 0) return null;
  return (
    <View
      style={{
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        padding: 8,
        gap: 4,
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
        FRAME EVENTS
      </Text>
      {events.map((e, i) => (
        <Text
          // biome-ignore lint/suspicious/noArrayIndexKey: events array is stable per frame
          key={i}
          style={{ fontSize: 12, color: COLORS.ink, lineHeight: 16 }}
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
