import { SEATS, type Seat, seatWindFor, tileId, tileLabel } from '@mahjong/game-logic';
import { useMemo, useState } from 'react';
import { Animated, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { type PlaybackPov, usePlayback } from '../../replay/playback';
import type { ReplayBookmark } from '../../replay/types';
import { useGame } from '../../state/game';
import { Hand } from '../Hand';
import { Tile } from '../Tile';
import { PULSE_TEMPO, usePulse } from '../animations';
import { COLORS, PANEL_ON_FELT, SUCCESS_PILL } from '../colors';
import { MeldStrip } from '../match/MeldStrip';
import { type Position, SEAT_COLOR } from '../match/seatColor';
import { FELT_SKINS } from '../match/skins';
import { WIND_GLYPH } from '../winds';
import { Scrubber } from './Scrubber';

/**
 * "Table replay" — read-only match shell rendered for a `ReplayRecord`'s
 * current frame. Mounts inside a `<PlaybackProvider>` so the cursor /
 * pov / autoplay state come from `usePlayback()`. No transport, no
 * engine; everything derives from `frames[cursor].state`.
 *
 * The redesign brings the live match's visual vocabulary into playback:
 *   - Felt-coloured perimeter (felt skin follows the user's settings)
 *   - GameStatusBar-style pill at the top
 *   - 4 seats arranged around a centre discard well, with the local
 *     seat anchored at the bottom (or whichever seat the POV picker
 *     selects)
 *   - Events transcript rail to the right on desktop, single-line
 *     ticker on portrait
 *   - Chapter-marked scrubber along the bottom — each hand is a
 *     horizontally-flexed card sized by its duration with a one-line
 *     result label
 *
 * Three viewport variants, mapped from the existing density branching:
 *   - `roomy`     (landscape ≥ 720 px wide): full perimeter felt with
 *                 all four seat cards + events rail
 *   - `portrait`  (< 480 px wide, height ≥ width): 3 mini opp pills,
 *                 felt-bordered discard pool, self card, latest-event
 *                 ticker
 *   - `landscape` (width > height, height < 540): two-column main —
 *                 felt left, events rail right
 */
export function ReplayPlayer() {
  const playback = usePlayback();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height && height < 540;
  const isCompactPortrait = !isLandscape && width < 480;
  const density: Density = isLandscape ? 'landscape' : isCompactPortrait ? 'portrait' : 'roomy';

  const localSeat = playback.header.localSeat;
  const pov = playback.pov;
  // Seat-keyed colour palette: each seat's wind ring, hand-strip
  // accent, and discard underline share the same hue so the user can
  // trace a discard back to its source. POV anchors the chosen seat at
  // the bottom (matches the live perimeter convention).
  const positions = useMemo(() => positionMapFor(pov, localSeat), [pov, localSeat]);
  const seatColor = useMemo<Record<Seat, string>>(() => {
    return {
      0: SEAT_COLOR[positions[0]],
      1: SEAT_COLOR[positions[1]],
      2: SEAT_COLOR[positions[2]],
      3: SEAT_COLOR[positions[3]],
    };
  }, [positions]);

  const seatByPosition = useMemo<Record<Position, Seat>>(() => {
    const out: Partial<Record<Position, Seat>> = {};
    for (const seat of SEATS) out[positions[seat]] = seat;
    return out as Record<Position, Seat>;
  }, [positions]);

  const chapters = useChapters();

  if (density === 'roomy') {
    return (
      <FeltPage density={density}>
        <StatusPill density={density} />
        <View
          style={{
            flex: 1,
            minHeight: 0,
            flexDirection: 'row',
            gap: 12,
            paddingHorizontal: 16,
            paddingBottom: 12,
          }}
        >
          <FeltTable
            seatByPosition={seatByPosition}
            seatColor={seatColor}
            positions={positions}
            density={density}
          />
          <EventsRail density={density} />
        </View>
        <Scrubber chapters={chapters} />
      </FeltPage>
    );
  }

  if (density === 'landscape') {
    return (
      <FeltPage density={density}>
        <StatusPill density={density} />
        <View
          style={{
            flex: 1,
            minHeight: 0,
            flexDirection: 'row',
            gap: 8,
            paddingHorizontal: 10,
            paddingBottom: 4,
          }}
        >
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'column', gap: 4 }}>
            <MiniOppRow positions={positions} seatColor={seatColor} density={density} />
            <DiscardWell positions={positions} seatColor={seatColor} density={density} />
            <SelfStrip seat={seatByPosition.bottom} seatColor={seatColor} density={density} />
          </View>
          <EventsRail density={density} />
        </View>
        <Scrubber chapters={chapters} compact />
      </FeltPage>
    );
  }

  return (
    <FeltPage density={density}>
      <StatusPill density={density} />
      <View style={{ paddingHorizontal: 10, paddingBottom: 4 }}>
        <MiniOppRow positions={positions} seatColor={seatColor} density={density} />
      </View>
      <View style={{ flex: 1, minHeight: 0, paddingHorizontal: 10, paddingBottom: 4 }}>
        <DiscardWell positions={positions} seatColor={seatColor} density={density} />
      </View>
      <View style={{ paddingHorizontal: 10, paddingBottom: 4 }}>
        <SelfCard seat={seatByPosition.bottom} seatColor={seatColor} density={density} />
      </View>
      <View style={{ paddingHorizontal: 10, paddingBottom: 4 }}>
        <LatestEventTicker />
      </View>
      <Scrubber chapters={chapters} compact />
    </FeltPage>
  );
}

type Density = 'portrait' | 'landscape' | 'roomy';

function FeltPage({ density, children }: { density: Density; children: React.ReactNode }) {
  const felt = useFeltSkin();
  return (
    <View style={{ flex: 1, backgroundColor: felt.top }}>
      <View style={{ flex: 1, paddingTop: density === 'roomy' ? 4 : 0 }}>{children}</View>
    </View>
  );
}

function useFeltSkin() {
  const skin = useGame((s) => s.settings.felt);
  return FELT_SKINS[skin];
}

// Mirror the live match: bottom-seat-is-you. POV picker overrides the
// anchor; spectator records fall back to seat 0.
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

// ─── Status pill ────────────────────────────────────────────────────

function StatusPill({ density }: { density: Density }) {
  const playback = usePlayback();
  const { state, header, cursor, totalFrames } = playback;
  const dealer = state.dealer;
  const dealerName = header.players[dealer]?.displayName ?? `Seat ${dealer}`;
  const compact = density !== 'roomy';
  const ringSize = compact ? 22 : 26;
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        paddingHorizontal: 12,
        paddingVertical: compact ? 6 : 10,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: compact ? 8 : 10,
          flexWrap: 'wrap',
          paddingHorizontal: compact ? 10 : 14,
          paddingVertical: compact ? 5 : 6,
          ...PANEL_ON_FELT,
        }}
      >
        <View
          style={{
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            backgroundColor: '#ecd9b8',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: compact ? 12 : 14,
              fontWeight: '700',
              color: COLORS.red,
            }}
          >
            {WIND_GLYPH[state.prevailingWind]}
          </Text>
        </View>
        <View style={{ gap: 1 }}>
          <Text
            style={{
              fontSize: compact ? 10 : 11,
              fontWeight: '900',
              color: COLORS.ink,
              letterSpacing: 0.4,
            }}
          >
            {WIND_LABEL[state.prevailingWind]} · HAND {Math.max(header.handsPlayed, 1)}
          </Text>
          {compact ? null : (
            <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.ink3 }} numberOfLines={1}>
              {dealerName} · {WIND_LABEL[seatWindFor(dealer, dealer)]} · Dealer
            </Text>
          )}
        </View>
        <Divider />
        <Text
          style={{
            fontSize: compact ? 10 : 11,
            fontWeight: '700',
            color: COLORS.ink,
            letterSpacing: 0.3,
          }}
        >
          {state.wall.length} tiles in wall
        </Text>
        <Divider />
        <Text
          style={{
            fontSize: 10,
            fontWeight: '700',
            color: COLORS.ink3,
            fontFamily: 'Courier',
          }}
        >
          FRAME {cursor + 1}/{totalFrames}
        </Text>
      </View>
    </View>
  );
}

const WIND_LABEL = { E: 'EAST', S: 'SOUTH', W: 'WEST', N: 'NORTH' } as const;

function Divider() {
  return <View style={{ width: 1, height: 14, backgroundColor: COLORS.hairline, opacity: 0.6 }} />;
}

// ─── Felt table (desktop / roomy) ───────────────────────────────────

function FeltTable({
  seatByPosition,
  seatColor,
  positions,
  density,
}: {
  seatByPosition: Record<Position, Seat>;
  seatColor: Record<Seat, string>;
  positions: Record<Seat, Position>;
  density: Density;
}) {
  const felt = useFeltSkin();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        backgroundColor: felt.top,
        borderRadius: 24,
        padding: 16,
        borderWidth: 4,
        borderColor: 'rgba(216,168,90,0.45)',
        boxShadow: '0px 12px 32px rgba(0,0,0,0.22)',
        gap: 12,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
        <View style={{ width: 220 }}>
          <OppSeatCard
            seat={seatByPosition.top}
            position="top"
            seatColor={seatColor}
            density={density}
          />
        </View>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', gap: 12, minHeight: 0 }}>
        <View style={{ width: 180 }}>
          <OppSeatCard
            seat={seatByPosition.left}
            position="left"
            seatColor={seatColor}
            density={density}
          />
        </View>
        <DiscardWell positions={positions} seatColor={seatColor} density={density} />
        <View style={{ width: 180 }}>
          <OppSeatCard
            seat={seatByPosition.right}
            position="right"
            seatColor={seatColor}
            density={density}
          />
        </View>
      </View>
      <SelfCard seat={seatByPosition.bottom} seatColor={seatColor} density={density} />
    </View>
  );
}

// ─── Opp seat card (desktop) ────────────────────────────────────────

function OppSeatCard({
  seat,
  position,
  seatColor,
  density,
}: {
  seat: Seat;
  position: Position;
  seatColor: Record<Seat, string>;
  density: Density;
}) {
  const playback = usePlayback();
  const { state, header, pov } = playback;
  const player = header.players[seat];
  const name = player?.displayName ?? `Seat ${seat}`;
  const isBot = player?.isBot ?? false;
  const tiles = state.hands[seat];
  const melds = state.melds[seat];
  const score = state.scoreboard[seat];
  const faceUp = pov === 'all' || pov === seat;
  const isActive = state.phase === 'turn' && state.turn === seat;
  const isDealer = state.dealer === seat;
  const seatWind = seatWindFor(state.dealer, seat);
  const ringColor = seatColor[seat];
  const handTile = density === 'roomy' ? { w: 13, h: 18 } : { w: 10, h: 14 };
  return (
    <View
      style={{
        backgroundColor: isActive ? COLORS.redHot : 'rgba(255,255,255,0.92)',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: isActive ? '#f3c54a' : COLORS.hairline,
        padding: 8,
        gap: 6,
        boxShadow: isActive ? '0px 4px 12px rgba(219,93,74,0.45)' : '0px 4px 12px rgba(0,0,0,0.18)',
      }}
    >
      {isActive ? <ActiveHalo /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: ringColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: 11,
              fontWeight: '700',
              color: isActive ? 'white' : COLORS.red,
            }}
          >
            {WIND_GLYPH[seatWind]}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: '800',
              color: isActive ? 'white' : COLORS.ink,
            }}
            numberOfLines={1}
          >
            {name}
            {isBot ? ' · BOT' : ''}
            {isDealer ? ' · DEALER' : ''}
          </Text>
          <Text
            style={{
              fontSize: 10,
              fontWeight: '700',
              color: isActive ? 'rgba(255,255,255,0.85)' : COLORS.ink3,
            }}
          >
            {tiles.length} tiles · {score >= 0 ? `+${score}` : score}
          </Text>
        </View>
      </View>
      {faceUp ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 2,
            justifyContent: 'center',
          }}
        >
          {tiles.map((t, i) => (
            <Tile key={`${tileId(t)}-${i}`} tile={t} width={handTile.w} height={handTile.h} />
          ))}
        </View>
      ) : (
        <FaceDownRow
          count={tiles.length}
          orientation={position === 'top' ? 'horizontal' : 'vertical'}
        />
      )}
      {melds.length > 0 ? (
        <MeldStrip melds={melds} tileWidth={12} tileHeight={17} showKindLabel={false} />
      ) : null}
    </View>
  );
}

function FaceDownRow({
  count,
  orientation,
}: {
  count: number;
  orientation: 'horizontal' | 'vertical';
}) {
  const w = orientation === 'horizontal' ? 12 : 18;
  const h = orientation === 'horizontal' ? 18 : 12;
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 2,
        justifyContent: 'center',
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: count-driven placeholders, no stable identity
          key={i}
          style={{
            width: w,
            height: h,
            borderRadius: 3,
            backgroundColor: '#5a8cb0',
            borderWidth: 0.5,
            borderColor: 'rgba(50,80,100,0.6)',
          }}
        />
      ))}
    </View>
  );
}

// ─── Mini opp pill (portrait + landscape) ───────────────────────────

function MiniOppRow({
  positions,
  seatColor,
  density,
}: {
  positions: Record<Seat, Position>;
  seatColor: Record<Seat, string>;
  density: Density;
}) {
  // Three non-bottom seats, ordered left → top → right so the visual
  // perimeter reads counter-clockwise from the local seat.
  const order: Position[] = ['left', 'top', 'right'];
  const seats = order.map((pos) => {
    const seat = SEATS.find((s) => positions[s] === pos);
    return seat === undefined ? null : { seat, pos };
  });
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'stretch' }}>
      {seats.map((s) =>
        s === null ? null : (
          <MiniOppPill key={s.seat} seat={s.seat} seatColor={seatColor[s.seat]} density={density} />
        ),
      )}
    </View>
  );
}

function MiniOppPill({
  seat,
  seatColor,
  density: _density,
}: {
  seat: Seat;
  seatColor: string;
  density: Density;
}) {
  const playback = usePlayback();
  const { state, header, pov } = playback;
  const player = header.players[seat];
  const name = player?.displayName ?? `Seat ${seat}`;
  const tiles = state.hands[seat];
  const melds = state.melds[seat];
  const score = state.scoreboard[seat];
  const faceUp = pov === 'all' || pov === seat;
  const isActive = state.phase === 'turn' && state.turn === seat;
  const seatWind = seatWindFor(state.dealer, seat);
  const sign = score >= 0 ? '+' : '';
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        backgroundColor: isActive ? COLORS.redHot : 'rgba(255,255,255,0.92)',
        borderRadius: 10,
        borderWidth: 2,
        borderColor: isActive ? '#f3c54a' : COLORS.hairline,
        paddingHorizontal: 6,
        paddingVertical: 4,
        gap: 3,
        boxShadow: isActive ? '0px 2px 8px rgba(219,93,74,0.45)' : '0px 2px 6px rgba(0,0,0,0.18)',
      }}
    >
      {isActive ? <ActiveHalo /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            borderWidth: 1.5,
            borderColor: seatColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: 10,
              fontWeight: '700',
              color: isActive ? 'white' : COLORS.red,
              lineHeight: 12,
            }}
          >
            {WIND_GLYPH[seatWind]}
          </Text>
        </View>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '800',
            color: isActive ? 'white' : COLORS.ink,
            flex: 1,
            minWidth: 0,
          }}
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '900',
            fontFamily: 'Courier',
            paddingHorizontal: 4,
            borderRadius: 3,
            backgroundColor: isActive ? 'rgba(255,255,255,0.18)' : COLORS.creamLow,
            color: isActive ? 'white' : score >= 0 ? SUCCESS_PILL.fg : COLORS.red,
          }}
        >
          {sign}
          {score}
        </Text>
      </View>
      {faceUp ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 1,
            justifyContent: 'center',
          }}
        >
          {tiles.map((t, i) => (
            <Tile key={`${tileId(t)}-${i}`} tile={t} width={10} height={14} />
          ))}
        </View>
      ) : (
        <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)', fontWeight: '700' }}>
          {tiles.length} hidden
        </Text>
      )}
      {melds.length > 0 ? (
        <MeldStrip melds={melds} tileWidth={9} tileHeight={13} showKindLabel={false} />
      ) : null}
    </View>
  );
}

// ─── Discard well ───────────────────────────────────────────────────

function DiscardWell({
  positions,
  seatColor: _seatColor,
  density,
}: {
  positions: Record<Seat, Position>;
  seatColor: Record<Seat, string>;
  density: Density;
}) {
  const playback = usePlayback();
  const { state } = playback;
  const order = state.discardOrder;
  const lastId = state.lastDiscard ? tileId(state.lastDiscard.tile) : null;
  const felt = useFeltSkin();
  const tileSize = discardTileSizeFor(density);
  const tileColor = (seat: Seat): string => SEAT_COLOR[positions[seat]];
  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        backgroundColor: felt.bottom,
        borderRadius: 16,
        borderWidth: density === 'roomy' ? 1 : 3,
        borderColor: density === 'roomy' ? 'rgba(255,255,255,0.12)' : 'rgba(216,168,90,0.45)',
        padding: density === 'roomy' ? 12 : 10,
        gap: 6,
        boxShadow: density === 'roomy' ? undefined : '0px 6px 18px rgba(0,0,0,0.22)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text
          style={{
            fontSize: 9,
            fontWeight: '900',
            letterSpacing: 0.6,
            color: 'rgba(255,255,255,0.72)',
          }}
        >
          DISCARDS
        </Text>
        <Text style={{ fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.45)' }}>
          · {order.length}
        </Text>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 4,
          alignContent: 'flex-start',
        }}
        showsVerticalScrollIndicator={false}
      >
        {order.map((entry, i) => {
          const id = tileId(entry.tile);
          const isLast = id === lastId;
          return (
            <View key={`${i}-${id}`} style={{ alignItems: 'center', gap: 2 }}>
              <View
                style={{
                  borderRadius: 4,
                  boxShadow: isLast
                    ? '0px 0px 0px 1.5px #d8a85a, 0px 0px 6px rgba(216,168,90,0.5)'
                    : undefined,
                }}
              >
                <Tile tile={entry.tile} width={tileSize.w} height={tileSize.h} />
              </View>
              <View
                style={{
                  width: tileSize.w - 4,
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: tileColor(entry.from),
                }}
              />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function discardTileSizeFor(density: Density): { w: number; h: number } {
  if (density === 'roomy') return { w: 22, h: 30 };
  if (density === 'landscape') return { w: 16, h: 22 };
  return { w: 20, h: 28 };
}

// ─── Self seat card / strip ─────────────────────────────────────────

function SelfCard({
  seat,
  seatColor,
  density,
}: {
  seat: Seat;
  seatColor: Record<Seat, string>;
  density: Density;
}) {
  const playback = usePlayback();
  const { state, header } = playback;
  const player = header.players[seat];
  const name = player?.displayName ?? `Seat ${seat}`;
  const tiles = state.hands[seat];
  const melds = state.melds[seat];
  const score = state.scoreboard[seat];
  const isDealer = state.dealer === seat;
  const isLocal = header.localSeat === seat;
  const seatWind = seatWindFor(state.dealer, seat);
  const handSize = density === 'roomy' ? { w: 24, h: 34 } : { w: 22, h: 30 };
  return (
    <View
      style={{
        backgroundColor: 'rgba(251,248,240,0.94)',
        borderRadius: 14,
        borderWidth: 2,
        borderColor: COLORS.hairline,
        padding: density === 'roomy' ? 12 : 10,
        gap: 6,
        boxShadow: '0px -2px 12px rgba(0,0,0,0.12)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: density === 'roomy' ? 24 : 20,
            height: density === 'roomy' ? 24 : 20,
            borderRadius: density === 'roomy' ? 12 : 10,
            borderWidth: 2,
            borderColor: seatColor[seat],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: density === 'roomy' ? 13 : 11,
              fontWeight: '700',
              color: COLORS.red,
            }}
          >
            {WIND_GLYPH[seatWind]}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontSize: density === 'roomy' ? 13 : 11,
              fontWeight: '900',
              color: COLORS.ink,
            }}
            numberOfLines={1}
          >
            {name}
            {isLocal ? ' (you)' : ''}
            {isDealer ? ' · DEALER' : ''}
          </Text>
          <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.ink3 }}>
            {tiles.length} tiles · {score >= 0 ? `+${score}` : score}
          </Text>
        </View>
        {melds.length > 0 ? (
          <MeldStrip melds={melds} tileWidth={14} tileHeight={20} showKindLabel={false} />
        ) : null}
      </View>
      <Hand tiles={tiles} sortMode="suit" tileWidth={handSize.w} tileHeight={handSize.h} />
    </View>
  );
}

function SelfStrip({
  seat,
  seatColor,
  density,
}: {
  seat: Seat;
  seatColor: Record<Seat, string>;
  density: Density;
}) {
  // Landscape variant — single horizontal row with name + score
  // inline + the hand to the right. Keeps the felt + events visible
  // above without a tall card.
  const playback = usePlayback();
  const { state, header } = playback;
  const player = header.players[seat];
  const name = player?.displayName ?? `Seat ${seat}`;
  const tiles = state.hands[seat];
  const score = state.scoreboard[seat];
  const seatWind = seatWindFor(state.dealer, seat);
  const isLocal = header.localSeat === seat;
  return (
    <View
      style={{
        backgroundColor: 'rgba(251,248,240,0.94)',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: COLORS.hairline,
        paddingHorizontal: 8,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: seatColor[seat],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 11,
            fontWeight: '700',
            color: COLORS.red,
          }}
        >
          {WIND_GLYPH[seatWind]}
        </Text>
      </View>
      <Text style={{ fontSize: 10, fontWeight: '900', color: COLORS.ink, flexShrink: 0 }}>
        {isLocal ? 'You' : name} · {score >= 0 ? `+${score}` : score}
      </Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Hand tiles={tiles} sortMode="suit" tileWidth={18} tileHeight={26} />
      </View>
    </View>
  );
}

// ─── Events transcript ─────────────────────────────────────────────

function EventsRail({ density }: { density: Density }) {
  const playback = usePlayback();
  const events = playback.events;
  if (events.length === 0 && density !== 'roomy') return null;
  const compact = density !== 'roomy';
  return (
    <View
      style={{
        width: compact ? 200 : 320,
        flexShrink: 0,
        backgroundColor: 'rgba(255,255,255,0.94)',
        borderRadius: compact ? 12 : 16,
        borderWidth: 1,
        borderColor: COLORS.hairline,
        padding: compact ? 8 : 12,
        gap: compact ? 4 : 6,
        boxShadow: compact ? '0px 4px 16px rgba(0,0,0,0.2)' : '0px 8px 24px rgba(0,0,0,0.2)',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingBottom: 4,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.hairline,
        }}
      >
        <Text
          style={{
            fontSize: compact ? 9 : 10,
            fontWeight: '900',
            color: COLORS.ink3,
            letterSpacing: 0.8,
          }}
        >
          EVENTS
        </Text>
        <View style={{ flex: 1 }} />
        <Text
          style={{
            fontSize: compact ? 8 : 9,
            fontWeight: '700',
            color: COLORS.ink3,
            letterSpacing: 0.4,
          }}
        >
          HAND {Math.max(playback.header.handsPlayed, 1)}
        </Text>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 2 }}
        showsVerticalScrollIndicator={false}
      >
        {events.length === 0 ? (
          <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600', padding: 4 }}>
            No events on this frame yet.
          </Text>
        ) : (
          events.map((e, i) => (
            <EventRow
              // biome-ignore lint/suspicious/noArrayIndexKey: events array is stable per frame
              key={i}
              event={e}
              latest={i === events.length - 1}
              compact={compact}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function EventRow({
  event,
  latest,
  compact,
}: {
  event: ReturnType<typeof usePlayback>['events'][number];
  latest: boolean;
  compact: boolean;
}) {
  const kind = eventKind(event);
  const borderColor = latest ? COLORS.red : EVENT_BORDER[kind];
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: compact ? 6 : 8,
        paddingHorizontal: compact ? 4 : 4,
        paddingVertical: compact ? 4 : 6,
        borderRadius: compact ? 4 : 6,
        borderLeftWidth: 3,
        borderLeftColor: borderColor,
        paddingLeft: compact ? 6 : 8,
        backgroundColor: latest ? '#fdf1e6' : 'transparent',
      }}
    >
      <Text
        style={{
          fontFamily: 'Courier',
          fontSize: compact ? 9 : 10,
          fontWeight: '800',
          color: COLORS.ink3,
          width: compact ? 32 : 38,
          flexShrink: 0,
        }}
      >
        ·{eventIndexHint(event)}
      </Text>
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: compact ? 10 : 12,
          color: COLORS.ink,
          fontWeight: '600',
          lineHeight: compact ? 14 : 16,
        }}
        numberOfLines={compact ? 1 : 2}
      >
        {describeEvent(event)}
      </Text>
    </View>
  );
}

function eventIndexHint(_event: ReturnType<typeof usePlayback>['events'][number]): string {
  return '';
}

type EventKindBucket = 'gang' | 'claim' | 'draw' | 'discard' | 'other';
const EVENT_BORDER: Record<EventKindBucket, string> = {
  gang: '#a64ad9',
  claim: COLORS.gold,
  draw: COLORS.green,
  discard: COLORS.creamLow,
  other: COLORS.creamLow,
};

function eventKind(e: ReturnType<typeof usePlayback>['events'][number]): EventKindBucket {
  switch (e.t) {
    case 'gangDeclared':
      return 'gang';
    case 'claimsOpened':
    case 'claimsResolved':
      return 'claim';
    case 'drew':
      return 'draw';
    case 'discarded':
      return 'discard';
    default:
      return 'other';
  }
}

function LatestEventTicker() {
  const playback = usePlayback();
  const events = playback.events;
  if (events.length === 0) return null;
  const latest = events[events.length - 1]!;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: COLORS.hairline,
        borderLeftWidth: 3,
        borderLeftColor: COLORS.red,
        backgroundColor: 'rgba(255,255,255,0.94)',
      }}
    >
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11,
          fontWeight: '700',
          color: COLORS.ink,
        }}
        numberOfLines={1}
      >
        {describeEvent(latest)}
      </Text>
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

// ─── Active-turn halo (ported from OppHandStrip.ActiveHalo) ─────────

function ActiveHalo() {
  const t = usePulse({ durationMs: PULSE_TEMPO.state });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const GROWTH_PX = 3;
  const sx = size && size.w > 0 ? 1 + (GROWTH_PX * 2) / size.w : 1;
  const sy = size && size.h > 0 ? 1 + (GROWTH_PX * 2) / size.h : 1;
  const scaleX = t.interpolate({ inputRange: [0, 1], outputRange: [1, sx] });
  const scaleY = t.interpolate({ inputRange: [0, 1], outputRange: [1, sy] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] });
  return (
    <Animated.View
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) =>
          prev && prev.w === width && prev.h === height ? prev : { w: width, h: height },
        );
      }}
      style={{
        position: 'absolute',
        top: -2,
        left: -2,
        right: -2,
        bottom: -2,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: COLORS.gold,
        opacity,
        transform: [{ scaleX }, { scaleY }],
      }}
    />
  );
}

// ─── Chapter strip ──────────────────────────────────────────────────

export interface ReplayChapter {
  /** 0..1 range start, used to flex the chapter cell width. */
  from: number;
  /** 0..1 range end. */
  to: number;
  /** Bookmark seq the chapter begins at — what the strip tap seeks to. */
  seq: number;
  /** Hand number (1-based). */
  index: number;
  /** Round-wind glyph for the chapter (currently always the prevailing
   *  wind — most replays sit inside a single round). */
  wind: string;
  /** Two-line label content. */
  label: string;
  /** "Robert won · 5 faan" / "Drawn game" / "IN PROGRESS" / "Pending". */
  result: string;
  /** Cursor sits inside this chapter's range. */
  current: boolean;
  /** Chapter starts after the cursor (not yet reached). */
  pending: boolean;
}

function useChapters(): readonly ReplayChapter[] {
  const playback = usePlayback();
  return useMemo(() => {
    return deriveChapters(playback.bookmarks, playback.totalFrames, playback.cursor, {
      windGlyph: WIND_GLYPH[playback.state.prevailingWind],
    });
  }, [playback.bookmarks, playback.totalFrames, playback.cursor, playback.state.prevailingWind]);
}

function deriveChapters(
  bookmarks: readonly ReplayBookmark[],
  totalFrames: number,
  cursor: number,
  opts: { windGlyph: string },
): ReplayChapter[] {
  if (totalFrames <= 0) return [];
  const starts = bookmarks.filter((b) => b.kind === 'hand-start');
  // Synthesise a hand-1 boundary at seq 0 only if the recorder never
  // emitted one — e.g. a record that started mid-hand. Otherwise trust
  // the real bookmarks even if the first sits a frame or two in.
  if (starts.length === 0) {
    starts.push({
      seq: 0,
      kind: 'hand-start',
      label: 'Hand 1',
    });
  }
  const last = Math.max(1, totalFrames - 1);
  return starts.map((b, i) => {
    const next = starts[i + 1];
    const startSeq = b.seq;
    // The visible-seq remap can snap a `won` / `draw` bookmark forward
    // onto the next hand's start frame. Look one frame past the
    // chapter's nominal end so a collapsed end-bookmark still finds
    // the right chapter.
    const endSeq = next ? next.seq - 1 : totalFrames - 1;
    const lookupEndSeq = next ? next.seq : totalFrames - 1;
    const from = startSeq / last;
    const to = (endSeq + 1) / last;
    const ended = findEndBookmark(bookmarks, startSeq, lookupEndSeq);
    const current = cursor >= startSeq && cursor <= endSeq;
    const pending = cursor < startSeq;
    return {
      from: Math.min(1, Math.max(0, from)),
      to: Math.min(1, Math.max(from, to)),
      seq: startSeq,
      index: i + 1,
      wind: opts.windGlyph,
      label: `HAND ${i + 1}`,
      result: chapterResult(ended, current, pending, cursor),
      current,
      pending,
    };
  });
}

function findEndBookmark(
  bookmarks: readonly ReplayBookmark[],
  startSeq: number,
  endSeq: number,
): ReplayBookmark | null {
  for (const b of bookmarks) {
    if (b.seq < startSeq) continue;
    if (b.seq > endSeq) break;
    if (b.kind === 'win' || b.kind === 'robbed-gang' || b.kind === 'draw') return b;
  }
  return null;
}

function chapterResult(
  ended: ReplayBookmark | null,
  current: boolean,
  pending: boolean,
  cursor: number,
): string {
  if (pending) return 'Pending';
  if (ended && cursor >= ended.seq) {
    if (ended.kind === 'draw') return 'Drawn game';
    // Bookmark labels are pre-rendered as "<Name> wins N faan" or the
    // robbed-gang phrasing — keep them as-is for the chapter strip.
    return ended.label;
  }
  if (current) return 'IN PROGRESS';
  // Chapter is in the past but the visible-seq remap snapped its
  // win/draw bookmark onto the next chapter's start frame, so we
  // couldn't find it inside this chapter's range. Show a neutral
  // dash rather than the misleading "Pending" label.
  return '—';
}
