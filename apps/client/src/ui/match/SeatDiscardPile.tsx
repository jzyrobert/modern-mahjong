import { type Tile as MTile, tileId } from '@mahjong/game-logic';
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

/**
 * One seat's discard pile, oriented for that seat's view of the table.
 * Uses RN flex-wrap with a `maxWidth` (horizontal piles) or `maxHeight`
 * (vertical piles) constraint so a long run breaks into a second
 * row/column instead of spilling across the centre area. Tiles align
 * cleanly to the grid — Riichi-style — so a row reads as a single
 * scannable line of suits/ranks rather than a tossed pile.
 *
 * The latest claim-window tile gets a static gold border so it pops
 * out of the otherwise uniform grid.
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
  // 6 tiles per row/column. Tighter 1px gap fits the Riichi-style
  // grid: 6 × (22+1gap) = 138px row width, 6 × (30+1gap) = 186px column
  // height. Caller can override via `maxExtent`.
  const extent = maxExtent ?? (isVertical ? 6 * (tileH + 1) : 6 * (tileW + 1));

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
        gap: 1,
        justifyContent: 'flex-start',
        ...(isVertical ? { maxHeight: extent } : { maxWidth: extent }),
      }}
    >
      {tiles.map((t, i) => {
        const id = tileId(t);
        const isLatest = latestId === id;
        // The wrapper carries the seat orientation so the halo box
        // stays axis-aligned with the tile under it; `<Tile>`'s own
        // `rotate` prop is left unset to avoid double-rotating.
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: discard order is append-only and stable; tiles can repeat (multiple of the same face) so we composite with i
            key={`${id}-${i}`}
            style={{
              transform: [{ rotate: `${rotate}deg` }],
              ...(isLatest && {
                boxShadow: `0px 0px 6px ${HALO}b3`,
                borderWidth: 1.5,
                borderColor: HALO,
                borderRadius: 4,
              }),
            }}
          >
            <Tile tile={t} flipId={`tile-${id}`} width={tileW} height={tileH} />
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
