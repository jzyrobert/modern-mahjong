import type { GameState, Seat } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { ScrollView, Text, View } from 'react-native';
import { Tile } from '../Tile';
import { DISCARD_HALO_STYLE } from './SeatDiscardPile';
import { type Position, SEAT_COLOR } from './seatColor';

interface OppDiscardColumnProps {
  seat: Seat;
  position: Position;
  discardOrder: GameState['discardOrder'];
  latestId: number | null;
}

const TILE_W = 20;
const TILE_H = 28;

/**
 * One opponent's discard pile rendered as a flex-grow column under
 * their `OppHandStrip` in landscape mobile. Tiles wrap left-to-right
 * inside the column and the whole column scrolls internally once the
 * pile grows past the available height. Filtered down to a single
 * seat — mirrors the `Player` view of `SharedDiscardPool` but laid
 * out next to the player it belongs to instead of in a centre pool.
 */
export function OppDiscardColumn({
  seat,
  position,
  discardOrder,
  latestId,
}: OppDiscardColumnProps) {
  const tiles = discardOrder.filter((e) => e.from === seat);
  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        marginTop: 4,
        backgroundColor: 'rgba(0,0,0,0.06)',
        borderRadius: 8,
        borderLeftColor: SEAT_COLOR[position],
        borderLeftWidth: 3,
        padding: 6,
      }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}
        showsVerticalScrollIndicator={false}
      >
        {tiles.length === 0 ? (
          <Text
            style={{
              fontSize: 10,
              fontStyle: 'italic',
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            no discards
          </Text>
        ) : (
          tiles.map((entry, i) => {
            const id = tileId(entry.tile);
            const live = id === latestId;
            return (
              <View
                // biome-ignore lint/suspicious/noArrayIndexKey: discard order is stable and tiles repeat — composite with index
                key={`${id}-${i}`}
                style={live ? DISCARD_HALO_STYLE : undefined}
              >
                <Tile tile={entry.tile} width={TILE_W} height={TILE_H} />
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
