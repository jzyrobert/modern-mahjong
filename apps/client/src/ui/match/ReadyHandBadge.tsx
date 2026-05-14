import type { Tile as MTile } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import { Tile } from '../Tile';
import { COLORS } from '../colors';

interface ReadyHandBadgeProps {
  /** Distinct wait faces (`waitTiles` output). Empty → component returns null. */
  waits: readonly MTile[];
  /** Optional sizing override — defaults to the mini-tile sizing used by
   *  the own-melds / own-discards strips so the badge nests cleanly into
   *  either action zone. */
  tileWidth?: number;
  tileHeight?: number;
}

const DEFAULT_TILE_W = 16;
const DEFAULT_TILE_H = 22;

/**
 * Compact pill rendered above the user's hand when their concealed hand
 * is tenpai (聽牌 — shanten 0). Shows the gold "聽" glyph plus a row of
 * mini-tile thumbnails for every face that would complete the hand.
 * The waits are computed in `Match.tsx` via the engine's `waitTiles`
 * helper and threaded through both shells; this component is a pure
 * presentation layer.
 *
 * Returns null when there are no waits so the surrounding flex layout
 * collapses without a leftover empty row.
 */
export function ReadyHandBadge({
  waits,
  tileWidth = DEFAULT_TILE_W,
  tileHeight = DEFAULT_TILE_H,
}: ReadyHandBadgeProps) {
  if (waits.length === 0) return null;
  return (
    <View
      accessibilityLabel={`Ready hand — waiting on ${waits.length} tile${waits.length === 1 ? '' : 's'}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 8,
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 14,
        backgroundColor: 'rgba(255, 250, 234, 0.95)',
        borderColor: '#dca84a',
        borderWidth: 1,
        boxShadow: '0px 0px 6px rgba(220, 168, 74, 0.45)',
        flexShrink: 1,
        flexWrap: 'wrap',
        rowGap: 4,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 14,
            fontWeight: '900',
            color: '#a16b1c',
          }}
        >
          聽
        </Text>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '900',
            color: COLORS.ink,
            letterSpacing: 1,
          }}
        >
          READY
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
        {waits.map((tile) => (
          <Tile key={tileId(tile)} tile={tile} width={tileWidth} height={tileHeight} />
        ))}
      </View>
    </View>
  );
}
