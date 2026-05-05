import type { GameState, Tile as MTile, Seat } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import { Tile } from '../Tile';

interface SharedDiscardPoolProps {
  discardOrder: GameState['discardOrder'];
  /** Map from seat → visual position so each tile gets a colour underline. */
  seatToPosition: Record<Seat, 'bottom' | 'right' | 'top' | 'left'>;
  /** TileId of the live discard while in awaitingClaims; pulses (static halo for Phase 4). */
  latestId: number | null;
}

const SEAT_COLOR: Record<'bottom' | 'right' | 'top' | 'left', string> = {
  bottom: '#de7660', // coral — you
  right: '#5db698', // jade
  top: '#c581b7', // mauve
  left: '#729fc6', // sky
};

const TILE_W = 24;
const TILE_H = 32;

/**
 * Centre-of-table discard pool. Tiles in true turn order, each with a
 * colour underline keying the discarder's visual position. The pulse-halo on
 * the live claim-window tile is deferred to Phase 6; for now we just
 * gold-tint its border.
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
        justifyContent: 'center',
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
