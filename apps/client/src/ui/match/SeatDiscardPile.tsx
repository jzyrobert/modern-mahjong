import { type Tile as MTile, tileId } from '@mahjong/game-logic';
import { View } from 'react-native';
import { TILE_CORNER_RADIUS_RATIO, Tile } from '../Tile';

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
/** Live-claim-target border. Also used by `SharedDiscardPool` to mark
 *  the same tile in the centre pool view. The corner radius tracks the
 *  tile's own `width * TILE_CORNER_RADIUS_RATIO` so the halo curves
 *  follow the rounded tile silhouette at every tile size — a static
 *  radius squares off relative to the tile face once tile width drifts
 *  from ~22 px (mobile portrait pool, scaled desktop piles). */
export function discardHaloStyle(tileWidth: number) {
  return {
    boxShadow: `0px 0px 6px ${HALO}b3`,
    borderWidth: 1.5,
    borderColor: HALO,
    borderRadius: tileWidth * TILE_CORNER_RADIUS_RATIO,
  } as const;
}

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
        // Every rotated pile (top opp + both side opps) flips the side
        // strip in tile space so the pseudo-3D thickness lands on the
        // OUTER-of-the-rotation edge — i.e., toward the felt centre
        // for the side opps and on the screen-bottom edge for the top
        // opp. Without this:
        //   - Top opp (180°): strip points UP (away from the player).
        //   - Left opp (90°): strip points LEFT (away from the felt
        //                     centre, toward the opp's own seat).
        //   - Right opp (-90°): strip points RIGHT (same, mirrored).
        // The bottom seat (0°) keeps `'bottom'` so the player's own
        // discards still cast their thickness toward the player. The
        // rect/face/bevel re-anchor + the gradient direction are
        // handled inside `Tile` — see `TileProps.shadowEdge`.
        const shadowEdge: 'bottom' | 'top' = rotate === 0 ? 'bottom' : 'top';
        // Vertical piles: the wrapper takes the rotated bounds and the
        // unrotated Tile sits absolutely inside. Without this the
        // wrapper would consume tileH of column-flex stride for a tile
        // that's only tileW tall after rotation, baking an
        // (tileH − tileW) px phantom gap between adjacent tiles.
        if (isVertical) {
          const offset = (tileH - tileW) / 2;
          return (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: discard order is append-only and stable; tiles can repeat so we composite with i
              key={`${id}-${i}`}
              style={{
                width: tileH,
                height: tileW,
                ...(isLatest && discardHaloStyle(tileW)),
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  left: offset,
                  top: -offset,
                  width: tileW,
                  height: tileH,
                  transform: [{ rotate: `${rotate}deg` }],
                }}
              >
                <Tile
                  tile={t}
                  flipId={`tile-${id}`}
                  elevation="discard"
                  width={tileW}
                  height={tileH}
                  shadowEdge={shadowEdge}
                />
              </View>
            </View>
          );
        }
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: discard order is append-only and stable; tiles can repeat so we composite with i
            key={`${id}-${i}`}
            style={{
              transform: [{ rotate: `${rotate}deg` }],
              ...(isLatest && discardHaloStyle(tileW)),
            }}
          >
            <Tile
              tile={t}
              flipId={`tile-${id}`}
              elevation="discard"
              width={tileW}
              height={tileH}
              shadowEdge={shadowEdge}
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
