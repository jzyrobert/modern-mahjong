import type { GameState, Seat } from '@mahjong/game-logic';
import { SEATS, tileId } from '@mahjong/game-logic';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useGame } from '../../state/game';
import { Tile } from '../Tile';
import { discardHaloStyle } from './SeatDiscardPile';
import { type Position, SEAT_COLOR } from './seatColor';

interface SharedDiscardPoolProps {
  discardOrder: GameState['discardOrder'];
  /** Map from seat → visual position so each tile gets a colour underline. */
  seatToPosition: Record<Seat, Position>;
  /** TileId of the live discard while in awaitingClaims; gets a static gold halo. */
  latestId: number | null;
}

type SortMode = 'order' | 'player';

const TILE_W = 24;
const TILE_H = 32;

/**
 * Centre-of-table discard pool. Top row carries the `DISCARDS` label
 * plus a two-button toggle (`Order` / `Player`) that flips the body
 * between two views:
 *
 *   - `order` (default) — every tile in true turn order, wrapping left
 *     to right. Matches how the table physically grows; useful when
 *     reading the most recent discard and the live claim-window halo.
 *   - `player` — four sub-rows, one per seat (in seat-number order),
 *     with each seat's discards laid out chronologically inside that
 *     row. Useful for at-a-glance "what has this opponent thrown?"
 *     scanning, which the chronological view buries behind interleaved
 *     opponent discards.
 *
 * Each tile carries a seat-coloured underline keyed to its discarder's
 * perimeter `Position`. The live claim-window tile gets a static
 * gold-tinted border so the user can still find it in either view.
 *
 * Layout uses `justifyContent: 'flex-start'` in `order` mode so tiles
 * pack into a fixed left-aligned grid — newly-discarded tiles append
 * to the next empty slot instead of pushing the existing tiles around
 * to keep the row centred. Without this, every discard nudged every
 * prior tile by half a column, which made it impossible to track which
 * tile was the live claim target.
 *
 * `sortMode` is read from zustand, not local `useState`. The pool used
 * to lose the user's `'player'` pick whenever its host `View` got torn
 * down and remounted (orientation flips and a few transient layout
 * states inside `PortraitShell` could do this on an opponent's
 * discard); keeping the toggle in the store means a remount picks the
 * value back up instead of snapping to `'order'`.
 */
export function SharedDiscardPool({
  discardOrder,
  seatToPosition,
  latestId,
}: SharedDiscardPoolProps) {
  const sortMode = useGame((s) => s.discardSortMode);
  const setSortMode = useGame((s) => s.setDiscardSortMode);

  // Pre-discard we still render the header + an empty body so the
  // mobile shell's flex middle stays the same height before vs. after
  // the first discard — otherwise the panel pops in once a tile lands
  // and the action zone jumps up by ~36 px on a portrait phone. The
  // sort toggle is harmless on an empty body (PlayerView shows "no
  // discards" placeholders; OrderView is just the rounded felt).

  return (
    <View style={{ flex: 1, gap: 6, minHeight: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '800',
            color: 'rgba(255,255,255,0.7)',
            letterSpacing: 0.5,
          }}
        >
          DISCARDS
        </Text>
        <View style={{ flex: 1 }} />
        <SortToggle mode={sortMode} onChange={setSortMode} />
      </View>
      {/* Body — scrolls internally when the rows pile up so the
          surrounding action zone stays anchored at the bottom of the
          shell. The label + sort toggle above stay pinned to the top
          of the pane. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 4 }}
        showsVerticalScrollIndicator={false}
      >
        {sortMode === 'order' ? (
          <OrderView
            discardOrder={discardOrder}
            seatToPosition={seatToPosition}
            latestId={latestId}
          />
        ) : (
          <PlayerView
            discardOrder={discardOrder}
            seatToPosition={seatToPosition}
            latestId={latestId}
          />
        )}
      </ScrollView>
    </View>
  );
}

function OrderView({
  discardOrder,
  seatToPosition,
  latestId,
}: {
  discardOrder: GameState['discardOrder'];
  seatToPosition: Record<Seat, Position>;
  latestId: number | null;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        // Trimmed from 4 → 3 to gain one column on 1080-physical
        // phones (~412 CSS px wide): 14 × 24-px tiles with 13 × 3-px
        // gaps need 375 px of pool-interior width, which the trimmed
        // padding (6 each side, see below) gives at 412 viewport.
        gap: 3,
        justifyContent: 'flex-start',
        // Trimmed from 8 → 6 in lockstep with the gap above. The
        // backdrop still reads as a contained pool surface but
        // recovers ~4 px horizontally — together with the gap change
        // that's the difference between 13 and 14 tiles per row on
        // ~412 CSS phones.
        padding: 6,
        backgroundColor: 'rgba(0,0,0,0.05)',
        borderRadius: 12,
      }}
    >
      {discardOrder.map((entry, i) => (
        <DiscardCell
          key={`${tileId(entry.tile)}-${i}`}
          entry={entry}
          position={seatToPosition[entry.from]}
          live={tileId(entry.tile) === latestId}
        />
      ))}
    </View>
  );
}

function PlayerView({
  discardOrder,
  seatToPosition,
  latestId,
}: {
  discardOrder: GameState['discardOrder'];
  seatToPosition: Record<Seat, Position>;
  latestId: number | null;
}) {
  // Bucket each seat's discards in chronological order. The
  // `discardOrder` array is already chronological, so a per-seat
  // filter preserves the within-seat order without an extra sort.
  return (
    <View
      style={{
        // Same density trim as `OrderView` — see the inline comments
        // there. Gap + padding chosen so a 412 CSS-wide phone fits
        // one more tile column per seat row.
        gap: 3,
        padding: 6,
        backgroundColor: 'rgba(0,0,0,0.05)',
        borderRadius: 12,
      }}
    >
      {SEATS.map((seat) => {
        const tiles = discardOrder
          .map((entry, i) => ({ entry, i }))
          .filter(({ entry }) => entry.from === seat);
        const pos = seatToPosition[seat];
        return (
          <View
            key={seat}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TILE_H + 6 }}
          >
            <View
              style={{
                width: 4,
                alignSelf: 'stretch',
                borderRadius: 2,
                backgroundColor: SEAT_COLOR[pos],
              }}
            />
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 3,
                alignItems: 'center',
              }}
            >
              {tiles.length === 0 ? (
                <Text
                  style={{
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.5)',
                    fontStyle: 'italic',
                  }}
                >
                  no discards
                </Text>
              ) : (
                tiles.map(({ entry, i }) => (
                  <DiscardCell
                    key={`${tileId(entry.tile)}-${i}`}
                    entry={entry}
                    position={pos}
                    live={tileId(entry.tile) === latestId}
                  />
                ))
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function DiscardCell({
  entry,
  position,
  live,
}: {
  entry: GameState['discardOrder'][number];
  position: Position;
  live: boolean;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <View style={live ? discardHaloStyle(TILE_W) : undefined}>
        <Tile tile={entry.tile} width={TILE_W} height={TILE_H} />
      </View>
      <View
        style={{
          width: TILE_W - 4,
          height: 2,
          borderRadius: 1,
          backgroundColor: SEAT_COLOR[position],
        }}
      />
    </View>
  );
}

function SortToggle({ mode, onChange }: { mode: SortMode; onChange: (m: SortMode) => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: 'rgba(0,0,0,0.18)',
        borderRadius: 6,
        padding: 2,
      }}
    >
      <SortToggleButton label="Order" active={mode === 'order'} onPress={() => onChange('order')} />
      <SortToggleButton
        label="Player"
        active={mode === 'player'}
        onPress={() => onChange('player')}
      />
    </View>
  );
}

function SortToggleButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    // `aria-pressed` is the canonical ARIA attribute for toggle
    // buttons; `accessibilityState.selected` covers the same intent on
    // native (iOS / Android assistive tech) but RN-Web strips it for
    // button-role elements, so the explicit `aria-pressed` is what
    // surfaces the active/inactive state to a screen reader or an
    // agent driving the page on web. The styling already reflects the
    // state visually.
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Sort discards by ${label.toLowerCase()}`}
      accessibilityState={{ selected: active }}
      aria-pressed={active}
      style={({ pressed }) => ({
        paddingVertical: 3,
        paddingHorizontal: 8,
        borderRadius: 4,
        backgroundColor: active
          ? 'rgba(255,255,255,0.92)'
          : pressed
            ? 'rgba(255,255,255,0.12)'
            : 'transparent',
      })}
    >
      <Text
        style={{
          fontSize: 10,
          fontWeight: '800',
          letterSpacing: 0.4,
          color: active ? '#3a3328' : 'rgba(255,255,255,0.78)',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
