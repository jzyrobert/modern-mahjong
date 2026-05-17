import type { GameState } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { ScrollView, Text, View } from 'react-native';
import { Tile } from '../Tile';
import { discardHaloStyle } from './SeatDiscardPile';
import { type Position, SEAT_COLOR } from './seatColor';

interface OppDiscardColumnProps {
  position: Position;
  /** Pre-filtered to this seat by the shell — the parent buckets the
   *  full `discardOrder` once and hands the per-seat slice down so
   *  the three landscape columns don't each re-filter the full list
   *  on every render. */
  discards: GameState['discardOrder'];
  latestId: number | null;
}

const TILE_W = 20;
const TILE_H = 28;

/**
 * One opponent's discard pile rendered as a flex-grow column under
 * their `OppHandStrip` in landscape mobile. Tiles wrap left-to-right
 * inside the column and the whole column scrolls internally once the
 * pile grows past the available height.
 */
export function OppDiscardColumn({ position, discards, latestId }: OppDiscardColumnProps) {
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
        {discards.length === 0 ? (
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
          discards.map((entry, i) => {
            const id = tileId(entry.tile);
            const live = id === latestId;
            return (
              <View
                // biome-ignore lint/suspicious/noArrayIndexKey: discard order is stable and tiles repeat — composite with index
                key={`${id}-${i}`}
                style={live ? discardHaloStyle(TILE_W) : undefined}
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
