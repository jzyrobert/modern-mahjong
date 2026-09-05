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
  /**
   * `paper` (default) is the cream pill of the classic shells; `glass`
   * is the Three.js HUD's dark gold-glass card: bigger 聽 glyph, gold
   * ring and 24 × 33 wait tiles so the tenpai state reads from across
   * the table, not as a footnote.
   */
  theme?: 'paper' | 'glass';
  /**
   * Glass only: a 40 px-tall footer variant (18 px 聽, no READY label,
   * tighter pads) for the phone portrait footer row, where it stands in
   * for the sort control during a claim window.
   */
  dense?: boolean;
}

const DEFAULT_TILE_W = 16;
const DEFAULT_TILE_H = 22;
const GLASS_TILE_W = 24;
const GLASS_TILE_H = 33;

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
  tileWidth,
  tileHeight,
  theme = 'paper',
  dense = false,
}: ReadyHandBadgeProps) {
  if (waits.length === 0) return null;
  const glass = theme === 'glass';
  const tight = glass && dense;
  const tw = tileWidth ?? (glass ? GLASS_TILE_W : DEFAULT_TILE_W);
  const th = tileHeight ?? (glass ? GLASS_TILE_H : DEFAULT_TILE_H);
  return (
    <View
      testID="ready-hand-badge"
      accessibilityLabel={`Ready hand — waiting on ${waits.length} tile${waits.length === 1 ? '' : 's'}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: tight ? 8 : glass ? 12 : 8,
        paddingVertical: tight ? 4 : glass ? 7 : 4,
        paddingHorizontal: tight ? 10 : glass ? 14 : 10,
        borderRadius: glass ? 999 : 14,
        backgroundColor: glass ? 'rgba(14, 20, 17, 0.88)' : 'rgba(255, 250, 234, 0.95)',
        borderColor: glass ? 'rgba(216, 168, 90, 0.75)' : '#dca84a',
        borderWidth: 1,
        boxShadow: glass
          ? '0px 0px 0px 3px rgba(216,168,90,0.14), 0px 0px 24px rgba(216,168,90,0.3), 0px 12px 40px rgba(0,0,0,0.35)'
          : '0px 0px 6px rgba(220, 168, 74, 0.45)',
        flexShrink: 1,
        flexWrap: 'wrap',
        rowGap: 4,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: glass ? 7 : 4 }}>
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: tight ? 18 : glass ? 22 : 14,
            lineHeight: tight ? 22 : glass ? 26 : undefined,
            fontWeight: '900',
            color: glass ? '#d8a85a' : '#a16b1c',
          }}
        >
          聽
        </Text>
        {tight ? null : (
          <Text
            style={{
              fontSize: glass ? 11 : 10,
              fontWeight: '900',
              color: glass ? 'rgba(255,255,255,0.92)' : COLORS.ink,
              letterSpacing: glass ? 2 : 1,
            }}
          >
            READY
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: glass ? 4 : 3 }}>
        {waits.map((tile) => (
          <Tile key={tileId(tile)} tile={tile} width={tw} height={th} />
        ))}
      </View>
    </View>
  );
}
