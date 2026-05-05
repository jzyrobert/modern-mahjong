import { type Tile as MTile, mulberry32, tileId } from '@mahjong/game-logic';
import { View } from 'react-native';
import { Tile } from '../Tile';

interface SeatDiscardPileProps {
  tiles: readonly MTile[];
  /** Seat-relative rotation in degrees:
   *   - `0`   bottom (you): row, tiles upright.
   *   - `180` top (across): row-reverse, tiles upside-down.
   *   - `-90` right: column, tiles' tops point left → upright from their seat.
   *   - `90`  left: column-reverse, tiles' tops point right → upright from their seat.
   */
  rotate: 0 | 90 | 180 | -90;
  /** Engine `tileId` of the live discard while in `awaitingClaims` —
   *  the matching tile gets a gold halo border. */
  latestId: number | null;
  /** Tile width. Default 22. */
  tileW?: number;
  /** Tile height. Default 30. */
  tileH?: number;
  /** Cap horizontal piles by width / vertical piles by height so a long
   *  run wraps into a second row/column instead of sprawling. Default
   *  derived from rotate. */
  maxExtent?: number;
}

const HALO = '#dc9f4f';

/** Max ± jitter in degrees added on top of the seat orientation, so each
 *  tile lands at a slightly different angle (a "toss" feel rather than
 *  perfect alignment). Same MAX_TOSS_DEGREES as legacy DiscardPile. */
const MAX_TOSS_DEGREES = 8;

/**
 * One seat's discard pile, oriented for that seat's view of the table.
 * Uses RN flex-wrap with a `maxWidth` (horizontal piles) or `maxHeight`
 * (vertical piles) constraint so a long run breaks into a second
 * row/column instead of spilling across the centre area. Per-tile
 * mulberry32 jitter on top of the seat rotation produces the "toss"
 * angles.
 *
 * The pulse halo on the latest claim-window tile is a static gold
 * border for now — the framer-motion `HALO_ANIMATE` pulse is Phase 6
 * (Animated API loop).
 */
export function SeatDiscardPile({
  tiles,
  rotate,
  latestId,
  tileW = 22,
  tileH = 30,
  maxExtent,
}: SeatDiscardPileProps) {
  const isVertical = rotate === 90 || rotate === -90;
  const flexDirection = flowFor(rotate);
  // 6 tiles per row/column matches the visual density of the legacy
  // pile: 6 × (22+2gap) ≈ 144px row width, 6 × (30+2gap) ≈ 192px column
  // height. Caller can override.
  const extent = maxExtent ?? (isVertical ? 6 * (tileH + 2) : 6 * (tileW + 2));

  // Empty discard piles render nothing — the felt centre stays clean
  // until someone actually plays. The dashes were left over from an
  // earlier debug layout and added visual noise to the start-of-hand
  // table.
  if (tiles.length === 0) return null;

  return (
    <View
      style={{
        flexDirection,
        flexWrap: 'wrap',
        gap: 2,
        justifyContent: 'flex-start',
        ...(isVertical ? { maxHeight: extent } : { maxWidth: extent }),
      }}
    >
      {tiles.map((t, i) => {
        const id = tileId(t);
        const tossOffset = (mulberry32(id)() - 0.5) * 2 * MAX_TOSS_DEGREES;
        const isLatest = latestId === id;
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: discard order is append-only and stable; tiles can repeat (multiple of the same face) so we composite with i
            key={`${id}-${i}`}
            style={{
              ...(isLatest && {
                boxShadow: `0px 0px 6px ${HALO}b3`,
                borderWidth: 1.5,
                borderColor: HALO,
                borderRadius: 4,
              }),
            }}
          >
            <Tile
              tile={t}
              flipId={`tile-${id}`}
              width={tileW}
              height={tileH}
              rotate={rotate + tossOffset}
            />
          </View>
        );
      })}
    </View>
  );
}

function flowFor(rotate: 0 | 90 | 180 | -90): 'row' | 'row-reverse' | 'column' | 'column-reverse' {
  if (rotate === 180) return 'row-reverse';
  if (rotate === 90) return 'column-reverse';
  if (rotate === -90) return 'column';
  return 'row';
}
