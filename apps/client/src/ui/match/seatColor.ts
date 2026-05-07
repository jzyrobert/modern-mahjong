/**
 * Perimeter position of a seat in the match table layout. The user is
 * always rendered at the bottom; opponents rotate counter-clockwise to
 * `right` / `top` / `left`. Used by both the desktop perimeter felt
 * (PlayerBadge avatars, WallEdge frames) and the mobile shared discard
 * pool (SharedDiscardPool's per-tile underline) so a tile's colour
 * always matches the seat's badge.
 */
export type Position = 'bottom' | 'right' | 'top' | 'left';

/**
 * Per-seat accent palette — coral / jade / mauve / sky, in perimeter
 * order so opposite seats stay visually distinct. Single source of
 * truth: prior to this module both `PlayerBadge` and
 * `SharedDiscardPool` carried their own byte-identical `SEAT_COLOR`
 * map and the `PlayersSheet` doc-comment referenced
 * `PlayerBadge.SEAT_COLOR` as the canonical palette — implicitly
 * couple by hex value and easy to drift.
 */
export const SEAT_COLOR: Record<Position, string> = {
  bottom: '#de7660', // coral — you
  right: '#5db698', // jade
  top: '#c581b7', // mauve
  left: '#729fc6', // sky
};
