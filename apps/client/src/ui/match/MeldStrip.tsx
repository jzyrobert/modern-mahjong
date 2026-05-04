import type { Meld } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import { Tile } from '../Tile';

interface MeldStripProps {
  melds: readonly Meld[];
  tileWidth?: number;
  tileHeight?: number;
}

/**
 * Renders a seat's exposed melds as horizontal rows of small tiles.
 * Native port of `_legacy/src/ui/match/MeldStrip.tsx`. Legacy was a
 * placeholder dashed slot — this version actually shows the meld
 * contents from `state.melds[seat]`. Empty list → nothing rendered
 * (parent decides whether to reserve space).
 */
export function MeldStrip({ melds, tileWidth = 18, tileHeight = 24 }: MeldStripProps) {
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
            backgroundColor: '#ece4d3',
            borderColor: '#cdc1ad',
            borderWidth: 1,
            borderRadius: 4,
            padding: 2,
          }}
        >
          {meld.tiles.map((t) => (
            <Tile key={tileId(t)} tile={t} width={tileWidth} height={tileHeight} />
          ))}
          <View style={{ alignSelf: 'flex-end', paddingLeft: 4 }}>
            <Text style={{ fontSize: 8, fontWeight: '700', color: '#918275' }}>
              {meld.kind.toUpperCase()}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
