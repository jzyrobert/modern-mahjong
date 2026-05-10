import type { GameState, Tile as MTile, Seat } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import { Tile } from '../Tile';
import { type Position, SEAT_COLOR } from './seatColor';

interface SharedDiscardPoolProps {
  discardOrder: GameState['discardOrder'];
  /** Map from seat → visual position so each tile gets a colour underline. */
  seatToPosition: Record<Seat, Position>;
  /** TileId of the live discard while in awaitingClaims; gets a static gold halo. */
  latestId: number | null;
}

const TILE_W = 24;
const TILE_H = 32;

/**
 * Centre-of-table discard pool. Tiles in true turn order, each with a
 * colour underline keying the discarder's visual position. The live
 * claim-window tile gets a static gold-tinted border.
 *
 * Layout uses `justifyContent: 'flex-start'` so tiles pack into a
 * fixed left-aligned grid — newly-discarded tiles append to the next
 * empty slot instead of pushing the existing tiles around to keep
 * the row centered. Without this, every discard nudged every prior
 * tile by half a column, which made it impossible to track which
 * tile was the live claim target.
 */
export function SharedDiscardPool({
  discardOrder,
  seatToPosition,
  latestId,
}: SharedDiscardPoolProps) {
  if (discardOrder.length === 0) {
    return (
      <View style={{ padding: 16, alignItems: 'center' }}>
        <Text style={{ fontSize: 11, color: '#918275' }}>No discards yet</Text>
      </View>
    );
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        justifyContent: 'flex-start',
        padding: 8,
        backgroundColor: 'rgba(0,0,0,0.05)',
        borderRadius: 12,
      }}
    >
      {discardOrder.map((entry, i) => {
        const id = tileId(entry.tile);
        const pos = seatToPosition[entry.from];
        const live = id === latestId;
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: discardOrder is append-only and indexed by turn order
            key={`${id}-${i}`}
            style={{
              alignItems: 'center',
              gap: 2,
            }}
          >
            <View
              style={{
                ...(live && {
                  boxShadow: '0px 0px 6px rgba(220,159,79,0.7)',
                  borderWidth: 1.5,
                  borderColor: '#dc9f4f',
                  borderRadius: 4,
                }),
              }}
            >
              <Tile tile={entry.tile} width={TILE_W} height={TILE_H} />
            </View>
            <View
              style={{
                width: TILE_W - 4,
                height: 2,
                borderRadius: 1,
                backgroundColor: SEAT_COLOR[pos],
              }}
            />
          </View>
        );
      })}
    </View>
  );
}
