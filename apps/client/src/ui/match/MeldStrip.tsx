import type { Meld } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import { Tile } from '../Tile';
import { COLORS } from '../colors';

interface MeldStripProps {
  melds: readonly Meld[];
  tileWidth?: number;
  tileHeight?: number;
  /** Renders the trailing `PENG`/`CHI`/`GANG` label after each meld's
   *  tiles. Defaults to true (user's own melds use this for clarity).
   *  Compact opponent strips set it false so four melds can fit on
   *  one row inside a 360 px portrait viewport. */
  showKindLabel?: boolean;
}

/**
 * Renders a seat's exposed melds as horizontal rows of small tiles
 * from `state.melds[seat]`. Empty list → nothing rendered (parent
 * decides whether to reserve space).
 */
export function MeldStrip({
  melds,
  tileWidth = 18,
  tileHeight = 24,
  showKindLabel = true,
}: MeldStripProps) {
  if (melds.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {melds.map((meld, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: melds are append-only per hand
          key={i}
          style={{
            flexDirection: 'row',
            gap: 1,
            backgroundColor: COLORS.creamLow,
            borderColor: COLORS.hairline,
            borderWidth: 1,
            borderRadius: 4,
            padding: 2,
          }}
        >
          {meld.tiles.map((t) => (
            <Tile
              key={tileId(t)}
              tile={t}
              flipId={`tile-${tileId(t)}`}
              width={tileWidth}
              height={tileHeight}
            />
          ))}
          {showKindLabel ? (
            <View style={{ alignSelf: 'flex-end', paddingLeft: 4 }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: COLORS.ink3 }}>
                {meld.kind.toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}
