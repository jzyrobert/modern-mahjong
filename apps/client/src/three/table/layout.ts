import type { GameState, Meld, Seat, Tile } from '@mahjong/game-logic';
import { TOTAL_TILES, acrossSeat, nextSeat, prevSeat, tileId } from '@mahjong/game-logic';
import { manualOrderHand, orderHand } from '../../ui/handSort';
import type { SortMode } from '../../ui/match/SortPicker';
import { TILE_D, TILE_H, TILE_W } from '../tiles/geometry';

/**
 * World-space slots for every tile given a `GameState` and the user's
 * seat. Pure, dependency-light (no three.js objects) so it unit-tests
 * in node and so `choreography.ts` can diff two layouts cheaply.
 *
 * Coordinate system: Y up, the user sits at +Z looking toward −Z.
 * Every zone is authored in the *seat-local* frame of its owner
 * (x → the owner's right, z → toward the owner) and then rotated
 * about Y by `rel · 90°`, where `rel = (seat − me + 4) % 4`
 * (0 bottom / 1 right / 2 top / 3 left — the same order
 * `seatPlacement.layoutFor` uses). Units: 1 = one tile width.
 *
 * Orientation of a slot is `base` (flat face-up / flat face-down /
 * standing, face toward the owner) plus `yaw`, the total rotation
 * about world Y (seat rotation + the 90° spin of a claimed tile).
 */
export type Rel = 0 | 1 | 2 | 3;
export type Zone = 'hand' | 'oppHand' | 'wall' | 'deadWall' | 'discard' | 'meld' | 'sheet';
export type BaseOrient = 'flatUp' | 'flatDown' | 'standing';

export interface TileSlot {
  id: number;
  zone: Zone;
  /** Owner seat (for walls: the seat whose side the stack sits on). */
  seat: Seat;
  rel: Rel;
  x: number;
  y: number;
  z: number;
  base: BaseOrient;
  /** Rotation about world Y, radians. */
  yaw: number;
  /**
   * Backward lean for standing tiles, radians — the top edge leans
   * *away* from the owner (toward the table centre) so the printed
   * face tips up toward a camera looking down over the owner's
   * shoulder. 0 = bolt upright.
   */
  tilt: number;
  /** Show the tile-back on the printed side (concealed opponent tiles). */
  back: boolean;
  /** Ordinal within its zone (dispense stagger, river order). */
  index: number;
  /**
   * Explicit orientation (x, y, z, w) that overrides `base` / `yaw` /
   * `tilt` — used by the held hand, whose tiles face the camera
   * rather than a table edge.
   */
  quat?: [number, number, number, number];
  /** Uniform size multiplier (portrait rivers 1.36×, portrait side melds 1.15×). Default 1. */
  scale?: number;
}

/**
 * Near-camera frame the user's hand is laid out in on phone portrait
 * (see `cameraPresets.heldHandFrameFor`). `origin` is the block's
 * bottom-centre baseline; `right` / `up` span the plane the rows lie
 * in; `forward` is the direction the faces look (toward the camera);
 * `lean` tips each tile's top edge away from the camera.
 */
export interface HeldHandFrame {
  origin: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
  lean: number;
  /** CSS px per world unit at the hand's depth (HUD sizing hint). */
  pxPerUnit: number;
  /** Distance between the two rows' centre lines, world units. */
  rowPitch: number;
}

export type Layout = (TileSlot | null)[];

// ─── Table metrics ─────────────────────────────────────────────────
export const HAND_PITCH = TILE_W + 0.06;
export const WALL_PITCH = TILE_W + 0.03;
export const STACKS_PER_WALL = 17;
export const DEAD_WALL_STACKS = 7;
/** Distance from the table centre to the wall tiles' centre line. */
export const WALL_D = 8.8;
/** Pinwheel shift of each wall toward its owner's right. */
export const WALL_SHIFT = 0.75;
/** Opponent hand rows sit just outside the wall. */
export const HAND_Z = 10.55;
/**
 * The user's own row sits half a tile nearer the camera than the
 * opponents' so, from the low landscape / desktop presets, its top edge
 * clears the near wall's front face and the two rows read separately.
 */
export const OWN_HAND_Z = HAND_Z + 0.5;
/**
 * Exposed melds lie flat in the rack line: a flat tile reaches ±TILE_H/2
 * from this centre line, so 10.5 keeps the meld's inner edge (9.82) a
 * clear third of a tile off the wall's outer edge (9.48) — round-3: at
 * 10.3 the side seats' melds sat within 2 px of the wall and read as
 * wedged under it — while the outer edge (11.18) stays on the felt and
 * inside the portrait frame (see `PORTRAIT_X_HALF`).
 */
export const MELD_Z = 10.5;
/**
 * Dead-wall stacks step this far toward the rail so the block reads as
 * distinct from the live wall at every viewport (with the darker tint).
 */
export const DEAD_WALL_OFFSET = 0;
/** Own hand leans back ~29° — matches the ~70° camera elevation. */
export const HAND_TILT = 0.5;
/** Opponents' concealed rows stand nearly upright. */
export const OPP_TILT = 0.14;
/** Live / dead wall sizes at hand start (17 stacks × 2 × 4 − 7 × 2). */
export const LIVE_TILES = 122;
export const DEAD_TILES = 14;
export const DRAWN_GAP = 0.42;
/** Held hand (phone portrait): tiles per row and the gap between rows. */
export const HELD_ROW_MAX = 7;
/**
 * Gap between the two held rows, tile widths. 0.55 (round-4: up from
 * 0.34) spends part of the slack recovered from the far-rail band on
 * the hand block itself, so the rows read as two distinct rows rather
 * than one stacked slab.
 */
export const HELD_ROW_GAP = 0.55;
/** Depth step between the held rows (the back row sits a little further). */
export const HELD_ROW_DEPTH = 0.3;
/** Right edge of the user's flat melds when the hand is held off-table. */
export const OWN_MELD_RIGHT = 10.7;
export const MELD_GAP = 0.55;
export const MELD_GROUP_GAP = 0.3;
export const MELD_PITCH = TILE_W + 0.03;
/** Centre plate radius (mirrored below as `CENTRE_PLATE_RADIUS`; the river constants need it first). */
const CENTRE_PLATE_RADIUS_LOCAL = 1.9;
export const RIVER_COLS = 6;
export const RIVER_PITCH_X = TILE_W + 0.06;
export const RIVER_PITCH_Z = TILE_H + 0.1;
/**
 * Near edge of the first river row (owner's frame), every scale: a fifth
 * of a tile off the centre plate (radius 1.9). The first row's centre
 * line follows from the scale (`riverMetrics`): 2.78 at 1×, 3.02 at the
 * portrait 1.36×. Round-4: the edge used to sit at 2.32 whatever the
 * scale, which capped the portrait rivers at 1.3× before the third row
 * reached the wall's inner edge (8.12) — pulling the block 0.22 toward
 * the plate buys the extra size the far river's 萬 numerals needed.
 */
export const RIVER_NEAR_EDGE = CENTRE_PLATE_RADIUS_LOCAL + 0.2;
/** Centre line of the first river row at scale 1 (kept for callers that size by it). */
export const RIVER_Z0 = RIVER_NEAR_EDGE + TILE_H / 2;
/** Clearance kept between neighbouring seats' rivers at the corners. */
export const RIVER_CORNER_GAP = 0.15;
/** Rows the river fills before overflowing along the last row. */
export const RIVER_ROWS = 3;
/** Felt half-size and rail dimensions, shared with `TableScene`. */
export const FELT_HALF = 11.9;
export const RAIL_WIDTH = 1.1;
/** Height of the wood rail above the felt. */
export const RAIL_H = 0.55;
export const CENTRE_PLATE_RADIUS = CENTRE_PLATE_RADIUS_LOCAL;

export const FLAT_Y = TILE_D / 2;
export const STAND_Y = TILE_H / 2;

export function relOf(seat: Seat, me: Seat): Rel {
  return ((seat - me + 4) % 4) as Rel;
}

export function yawOf(rel: Rel): number {
  return (rel * Math.PI) / 2;
}

/** Rotate a seat-local (x, z) into world space for `rel`. */
export function toWorld(rel: Rel, x: number, z: number): [number, number] {
  switch (rel) {
    case 0:
      return [x, z];
    case 1:
      return [z, -x];
    case 2:
      return [-x, -z];
    default:
      return [-z, x];
  }
}

// ─── Walls ─────────────────────────────────────────────────────────
export interface WallRef {
  /** Seat whose side of the table the stack sits on. */
  wallSeat: Seat;
  /** 0..16, leftmost first from that seat's point of view. */
  stack: number;
  /** 0 bottom, 1 top. */
  level: 0 | 1;
  dead: boolean;
}

/**
 * Maps the engine's `wall` / `deadWall` arrays onto physical stacks.
 * Mirrors `ui/match/wallLayout.ts`: the break wall is
 * `(dealer + N − 1) % 4`, the break sits `N` stacks in from that
 * seat's right end, the dead wall is the 7 stacks to the right of the
 * break (wrapping onto the next seat), and the live wall walks left
 * from the break (wrapping onto the previous seat).
 *
 * `live[k]` is the slot of `wall[wall.length − 1 − k]` — the engine
 * pops from the end, so `k = 0` is the next tile to be drawn. Top
 * tiles are taken before bottom ones. `dead[j]` is `deadWall[j]`;
 * gang replacements `shift()` from the front, so index 0 is the far
 * end of the dead wall.
 */
export function wallSlotRefs(
  dealer: Seat,
  breakPosition: number | undefined,
  liveCount: number,
  deadCount: number,
): { live: WallRef[]; dead: WallRef[] } {
  const n =
    breakPosition !== undefined && breakPosition >= 2 && breakPosition <= 12 ? breakPosition : 7;
  const breakWall = ((dealer + (n - 1)) % 4) as Seat;
  const breakStack = STACKS_PER_WALL - n;

  const dead: WallRef[] = [];
  {
    // Fill the 7 dead stacks left→right, then reverse so index 0 is
    // the far (rightmost) end.
    let seat = breakWall;
    let idx = breakStack;
    const stacks: { seat: Seat; stack: number }[] = [];
    for (let k = 0; k < DEAD_WALL_STACKS; k++) {
      if (idx >= STACKS_PER_WALL) {
        idx = 0;
        seat = nextSeat(seat);
      }
      stacks.push({ seat, stack: idx });
      idx++;
    }
    stacks.reverse();
    for (const s of stacks) {
      dead.push({ wallSeat: s.seat, stack: s.stack, level: 1, dead: true });
      dead.push({ wallSeat: s.seat, stack: s.stack, level: 0, dead: true });
    }
    dead.length = Math.min(dead.length, Math.max(0, deadCount));
  }

  const live: WallRef[] = [];
  {
    let seat = breakWall;
    let idx = breakStack - 1;
    while (live.length < liveCount) {
      if (idx < 0) {
        idx = STACKS_PER_WALL - 1;
        seat = prevSeat(seat);
      }
      live.push({ wallSeat: seat, stack: idx, level: 1, dead: false });
      if (live.length < liveCount) live.push({ wallSeat: seat, stack: idx, level: 0, dead: false });
      idx--;
    }
  }
  return { live, dead };
}

/**
 * World position + yaw of a wall stack slot. The dead wall sits in its
 * natural slots along the row — the 68 stacks form a closed ring with
 * no slack, so any gap shift would push a dead stack into the live tail
 * that wraps onto the same wall from the other side (two coplanar top
 * faces z-fighting read as a ghost tile). The dead stacks are marked by
 * `TableScene`'s warm 0.5 tint alone (`DEAD_WALL_OFFSET` is 0: the
 * earlier fifth-of-a-tile step read as misaligned stacks rather than a
 * marker); the break gap grows naturally as tiles leave.
 */
export function wallSlotPosition(
  ref: WallRef,
  me: Seat,
): { x: number; y: number; z: number; yaw: number; rel: Rel } {
  const rel = relOf(ref.wallSeat, me);
  const lx = (ref.stack - (STACKS_PER_WALL - 1) / 2) * WALL_PITCH + WALL_SHIFT;
  const [x, z] = toWorld(rel, lx, WALL_D + (ref.dead ? DEAD_WALL_OFFSET : 0));
  return { x, y: FLAT_Y + ref.level * TILE_D, z, yaw: yawOf(rel), rel };
}

// ─── Hands + melds ─────────────────────────────────────────────────
export interface MeldSlotInfo {
  tile: Tile;
  /** Local x offset from the group's left edge to this tile's centre. */
  dx: number;
  rotated: boolean;
  /** Stacked on top of the tile below (gang's 4th). */
  stacked: boolean;
  faceDown: boolean;
}

/**
 * Lays one meld out left→right in the owner's frame. The claimed
 * tile is rotated 90° at the end that points to the seat it came
 * from (left = previous seat, middle = across, right = next seat);
 * a gang's 4th tile stacks on top of the rotated tile (or the middle
 * tile when there is none). Concealed gangs lie face down.
 */
export function layoutMeld(meld: Meld, owner: Seat): { tiles: MeldSlotInfo[]; width: number } {
  const tiles = meld.tiles;
  const base = tiles.slice(0, 3);
  const extra = tiles.slice(3);
  const faceDown = meld.kind === 'gang-concealed';
  let rotatedIdx = -1;
  if (meld.from !== undefined && meld.from !== owner && !faceDown) {
    if (meld.from === prevSeat(owner)) rotatedIdx = 0;
    else if (meld.from === acrossSeat(owner)) rotatedIdx = 1;
    else if (meld.from === nextSeat(owner)) rotatedIdx = 2;
  }
  const out: MeldSlotInfo[] = [];
  let x = 0;
  const centres: number[] = [];
  base.forEach((t, i) => {
    const rotated = i === rotatedIdx;
    const w = rotated ? TILE_H : TILE_W;
    const cx = x + w / 2;
    centres.push(cx);
    out.push({ tile: t, dx: cx, rotated, stacked: false, faceDown });
    x += w + (MELD_PITCH - TILE_W);
  });
  const width = x - (MELD_PITCH - TILE_W);
  const stackOn = rotatedIdx >= 0 ? rotatedIdx : 1;
  for (const t of extra) {
    out.push({
      tile: t,
      dx: centres[stackOn] ?? width / 2,
      rotated: rotatedIdx >= 0,
      stacked: true,
      faceDown,
    });
  }
  return { tiles: out, width };
}

export interface HandOrderOptions {
  sortMode: SortMode;
  manualOrder: readonly number[];
  drawnTileId: number | null;
}

/** Display order of the user's concealed hand; the drawn tile last. */
export function orderOwnHand(hand: readonly Tile[], opts: HandOrderOptions): Tile[] {
  const drawn = opts.drawnTileId;
  const rest = drawn === null ? [...hand] : hand.filter((t) => tileId(t) !== drawn);
  const drawnTile = drawn === null ? undefined : hand.find((t) => tileId(t) === drawn);
  let ordered: Tile[];
  if (opts.sortMode === 'manual' && opts.manualOrder.length > 0) {
    ordered = manualOrderHand(rest, opts.manualOrder);
  } else {
    ordered = orderHand(rest, opts.sortMode);
  }
  if (drawnTile) ordered.push(drawnTile);
  return ordered;
}

// ─── Full layout ───────────────────────────────────────────────────
/** See `LayoutOptions.hideSideWallsBeyondZ`. */
function hideSideWall(p: { rel: Rel; z: number }, beyondZ: number | undefined): boolean {
  return beyondZ !== undefined && (p.rel === 1 || p.rel === 3) && p.z < beyondZ;
}

export interface LayoutOptions extends HandOrderOptions {
  /** Hand end: opponents' concealed tiles lie face up in their row. */
  reveal: boolean;
  /**
   * Phone portrait: lay the user's hand out in this near-camera frame
   * (two standing rows) instead of on the table edge, and put their
   * exposed melds flat on the felt in front of them.
   */
  heldHand?: HeldHandFrame | null | undefined;
  /**
   * Uniform scale for river tiles (pitch + size) — phone portrait draws
   * discards 1.36× so their glyphs read at the width-bound table scale.
   */
  riverScale?: number | undefined;
  /**
   * Portrait river zoom: drop the side walls' stacks (rel 1 / 3) whose
   * world z is beyond this (toward the far side). The zoom frames the
   * river block and crops the walls off-screen, but perspective folds
   * the side walls' far ends back in under the header bar, where their
   * top faces peek out as a sliver; hiding that far third keeps the
   * header's bottom edge clean. `undefined` keeps every stack.
   */
  hideSideWallsBeyondZ?: number | undefined;
  /**
   * Show the user's own concealed hand backs-out (the pre-game waiting
   * table deals every filled seat a rack, the user's included).
   */
  concealOwn?: boolean | undefined;
  /**
   * Extra outward offset (world units, away from the table centre) for
   * the *side* seats' rows (rel 1 / 3): their concealed rack and their
   * flat melds move together so the row stays one line. The low phone-
   * landscape camera (31°) otherwise looks over the side wall's top
   * edge onto the inner half of a flat meld at `MELD_Z` — the wall
   * (two tiles high) hides it and the meld reads as sliding under the
   * wall (round-4 #1). `SIDE_SEAT_OUT_LOW` clears it; portrait and
   * desktop keep 0.
   */
  sideSeatOut?: number | undefined;
  /**
   * Lay the *right* seat's (rel 1) exposed melds at the near end of its
   * row — before its concealed rack instead of after it — so both side
   * seats' melds sit at the corners nearest the camera. From the low
   * phone-landscape preset the far end of a side row projects ~1.4×
   * smaller than the near end, and the right seat's melds (to its own
   * right = the far end) read as ~12 CSS px sideways glyphs (round-4 #1).
   * The left seat's melds are already at the near end. The group's
   * internal order (claimed-tile rotation) is unchanged.
   */
  sideMeldsNear?: boolean | undefined;
  /**
   * Uniform scale for the *side* seats' (rel 1 / 3) exposed melds. The
   * side melds are the smallest readable thing on the table: their
   * glyphs run sideways and, on the width-bound portrait camera, a flat
   * tile is ~19 CSS px across. 1.15 lifts that to ~22 px while the
   * meld's outer edge (10.5 + 0.78) stays inside the portrait frame and
   * its inner edge (9.72) a quarter-tile off the wall (round-4 #3).
   * Default 1.
   */
  sideMeldScale?: number | undefined;
  /**
   * Stand the *far* seat's (rel 2) exposed melds on the far rail, faces
   * toward the camera, instead of laying them flat in the rack line. The
   * low phone-landscape camera (31°) looks at the far side of the table
   * over the far wall: a flat meld at `MELD_Z` is hidden behind the
   * two-high stacks until the wall is drawn down, and even a flat tile
   * on a raised shelf there foreshortens to ~5 CSS px tall. Standing on
   * the rail (0.53 up, 1.9 further out) the tiles clear the wall's
   * silhouette and present their faces at ~21 px (round-4 #2). The rack
   * stays centred on the felt; the melds run from its right end.
   */
  farMeldsOnRail?: boolean | undefined;
  /**
   * Waiting table (pre-game lobby): lay the wall tiles out as four
   * even, centred runs of whole stacks instead of the engine's break-
   * relative ring. The lobby state deals a rack per filled seat, so the
   * real ring would show a ragged run of missing stacks and a lone odd
   * tile beside one rack (round-4 #4); an odd remaining tile is hidden.
   */
  waitingWalls?: boolean | undefined;
}

/**
 * Side-seat outward shift for the low phone-landscape camera. At 31°
 * elevation a ray from the camera to a flat meld's inner edge (MELD_Z −
 * TILE_H/2 = 9.82) crosses the side wall's outer edge (9.48) at y ≈
 * 0.91 — under the two-tile stack top (1.24), so the wall occludes it.
 * Shifted 0.65 the inner edge moves to 10.47 and the same ray crosses
 * at y ≈ 1.42, clear of the stacks; the meld's outer edge (11.83)
 * stays on the felt (11.9). The rack (10.55 → 11.2, base to 11.51)
 * follows so rack and melds remain one row.
 */
export const SIDE_SEAT_OUT_LOW = 0.65;

/**
 * Side-seat meld scale on the width-bound portrait table (see
 * `LayoutOptions.sideMeldScale`): 1.15 keeps the scaled tile's inner
 * edge (10.5 − 0.78 = 9.72) a quarter-tile off the wall's outer edge
 * (9.48) and its outer edge (11.28) inside the ±11.6 frame.
 */
export const SIDE_MELD_SCALE_PORTRAIT = 1.15;

/**
 * Row split for the held hand: one row while it fits, otherwise the
 * first (lowest-sorted) half on the back row and the rest — drawn tile
 * last — on the front row. Returns row lengths, back row first.
 */
export function heldRowSplit(total: number): number[] {
  if (total <= 0) return [];
  if (total <= HELD_ROW_MAX + 1) return [total];
  const back = Math.ceil(total / 2);
  return [back, total - back];
}

type V3 = [number, number, number];

/** Quaternion (x, y, z, w) whose columns are the orthonormal basis. */
export function quatFromBasis(right: V3, up: V3, forward: V3): [number, number, number, number] {
  const m00 = right[0];
  const m01 = up[0];
  const m02 = forward[0];
  const m10 = right[1];
  const m11 = up[1];
  const m12 = forward[1];
  const m20 = right[2];
  const m21 = up[2];
  const m22 = forward[2];
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

/**
 * Slots for the user's held hand. `hand` is already in display order
 * (drawn tile last); `drawnIdx` gets the extra gap.
 */
export function heldHandSlots(
  hand: readonly Tile[],
  drawnIdx: number,
  frame: HeldHandFrame,
  seat: Seat,
): TileSlot[] {
  const rows = heldRowSplit(hand.length);
  const out: TileSlot[] = [];
  const { right, up, forward, origin, lean } = frame;
  // Tile axes: the face tips up toward the sky by `lean`, so the
  // printed side catches the key light and reads as a 3D object.
  const c = Math.cos(lean);
  const sn = Math.sin(lean);
  const tUp: V3 = [
    up[0] * c - forward[0] * sn,
    up[1] * c - forward[1] * sn,
    up[2] * c - forward[2] * sn,
  ];
  const tFwd: V3 = [
    forward[0] * c + up[0] * sn,
    forward[1] * c + up[1] * sn,
    forward[2] * c + up[2] * sn,
  ];
  const quat = quatFromBasis(right, tUp, tFwd);
  let start = 0;
  rows.forEach((len, r) => {
    // Row 0 of `rows` is the back (top) row; the last row is the front.
    const rowFromFront = rows.length - 1 - r;
    const rowHasDrawn = drawnIdx >= start && drawnIdx < start + len;
    const width = len * HAND_PITCH - (HAND_PITCH - TILE_W) + (rowHasDrawn ? DRAWN_GAP : 0);
    let cursor = -width / 2;
    const v = TILE_H / 2 + rowFromFront * frame.rowPitch;
    const depth = -rowFromFront * HELD_ROW_DEPTH;
    for (let i = 0; i < len; i++) {
      const idx = start + i;
      if (idx === drawnIdx) cursor += DRAWN_GAP;
      const u = cursor + TILE_W / 2;
      cursor += HAND_PITCH;
      out.push({
        id: tileId(hand[idx]!),
        zone: 'hand',
        seat,
        rel: 0,
        x: origin[0] + right[0] * u + tUp[0] * v + forward[0] * depth,
        y: origin[1] + right[1] * u + tUp[1] * v + forward[1] * depth,
        z: origin[2] + right[2] * u + tUp[2] * v + forward[2] * depth,
        base: 'standing',
        yaw: 0,
        tilt: 0,
        back: false,
        index: idx,
        quat,
      });
    }
    start += len;
  });
  return out;
}

function emptyLayout(): Layout {
  const arr: Layout = [];
  for (let i = 0; i < TOTAL_TILES; i++) arr.push(null);
  return arr;
}

function put(layout: Layout, slot: TileSlot): void {
  layout[slot.id] = slot;
}

/**
 * The complete table: four walls, four hands (+ melds), four rivers.
 * Tiles not present anywhere in `state` (shouldn't happen mid-hand)
 * stay `null` and are hidden.
 */
export function computeLayout(state: GameState, me: Seat, opts: LayoutOptions): Layout {
  const layout = emptyLayout();

  if (opts.waitingWalls) placeWaitingWalls(layout, state, me);
  else placeWalls(layout, state, me, opts);

  for (const seat of [0, 1, 2, 3] as Seat[]) {
    const rel = relOf(seat, me);
    const yaw = yawOf(rel);
    const isMe = seat === me;
    const sideOut = !isMe && (rel === 1 || rel === 3) ? (opts.sideSeatOut ?? 0) : 0;
    const handZ = (isMe ? OWN_HAND_Z : HAND_Z) + sideOut;
    const meldZ = MELD_Z + sideOut;

    // Hand + melds share one row centred on the seat.
    const hand = isMe ? orderOwnHand(state.hands[seat], opts) : state.hands[seat];
    const melds = state.melds[seat].map((m) => layoutMeld(m, seat));
    const drawnIdx =
      isMe && opts.drawnTileId !== null
        ? hand.findIndex((t) => tileId(t) === opts.drawnTileId)
        : -1;
    if (isMe && opts.heldHand) {
      // Phone portrait: the concealed hand is held near the camera and
      // the exposed melds lie flat on the felt, right-aligned in the
      // row the hand would otherwise occupy.
      for (const slot of heldHandSlots(hand, drawnIdx, opts.heldHand, seat)) put(layout, slot);
      const meldsWidth =
        melds.reduce((acc, m) => acc + m.width, 0) + Math.max(0, melds.length - 1) * MELD_GROUP_GAP;
      let cursor = OWN_MELD_RIGHT - meldsWidth;
      melds.forEach((m, mi) => {
        let idx = 0;
        for (const ms of m.tiles) {
          put(layout, {
            id: tileId(ms.tile),
            zone: 'meld',
            seat,
            rel,
            x: cursor + ms.dx,
            y: FLAT_Y + (ms.stacked ? TILE_D : 0),
            z: MELD_Z,
            base: ms.faceDown ? 'flatDown' : 'flatUp',
            yaw: yaw + (ms.rotated ? Math.PI / 2 : 0),
            tilt: 0,
            back: ms.faceDown,
            index: mi * 4 + idx++,
          });
        }
        cursor += m.width + MELD_GROUP_GAP;
      });
      // River below still applies.
      placeRiver(layout, state, seat, rel, yaw, opts.riverScale ?? 1);
      continue;
    }
    const handWidth =
      hand.length > 0
        ? hand.length * HAND_PITCH - (HAND_PITCH - TILE_W) + (drawnIdx >= 0 ? DRAWN_GAP : 0)
        : 0;
    const meldScale = !isMe && (rel === 1 || rel === 3) ? (opts.sideMeldScale ?? 1) : 1;
    const railMelds = !isMe && rel === 2 && opts.farMeldsOnRail === true && melds.length > 0;
    const meldsWidth = railMelds
      ? 0
      : (melds.reduce((acc, m) => acc + m.width, 0) +
          Math.max(0, melds.length - 1) * MELD_GROUP_GAP) *
        meldScale;
    const total =
      handWidth + (melds.length > 0 && hand.length > 0 && !railMelds ? MELD_GAP : 0) + meldsWidth;
    // Right seat: melds first (the near end), then the rack.
    const meldsFirst = opts.sideMeldsNear === true && rel === 1 && melds.length > 0 && !railMelds;
    let cursor = -total / 2;
    if (meldsFirst) {
      cursor = placeMelds(layout, melds, seat, rel, yaw, meldZ, cursor, meldScale);
      if (hand.length > 0) cursor += MELD_GAP;
    }

    const revealOpp = !isMe && opts.reveal;
    hand.forEach((t, i) => {
      if (i === drawnIdx) cursor += DRAWN_GAP;
      const lx = cursor + TILE_W / 2;
      cursor += HAND_PITCH;
      const [x, z] = toWorld(rel, lx, handZ);
      put(layout, {
        id: tileId(t),
        zone: isMe ? 'hand' : 'oppHand',
        seat,
        rel,
        x,
        y: revealOpp ? FLAT_Y : STAND_Y,
        z,
        base: revealOpp ? 'flatUp' : 'standing',
        yaw,
        tilt: revealOpp ? 0 : isMe ? HAND_TILT : OPP_TILT,
        back: (!isMe || opts.concealOwn === true) && !revealOpp,
        index: i,
      });
    });
    if (railMelds) {
      placeRailMelds(layout, melds, seat, rel, yaw, handWidth / 2 + MELD_GAP);
    } else if (!meldsFirst) {
      if (hand.length > 0 && melds.length > 0) cursor += MELD_GAP - (HAND_PITCH - TILE_W);
      placeMelds(layout, melds, seat, rel, yaw, meldZ, cursor, meldScale);
    }

    placeRiver(layout, state, seat, rel, yaw, opts.riverScale ?? 1);
  }
  return layout;
}

/**
 * Lays a seat's meld groups left→right from `left` (owner's frame) on the
 * rack line `meldZ`; returns the cursor after the last group (the trailing
 * group gap excluded).
 */
function placeMelds(
  layout: Layout,
  melds: readonly { tiles: MeldSlotInfo[]; width: number }[],
  seat: Seat,
  rel: Rel,
  yaw: number,
  meldZ: number,
  left: number,
  scale = 1,
): number {
  let cursor = left;
  melds.forEach((m, mi) => {
    const groupLeft = cursor;
    let idx = 0;
    for (const ms of m.tiles) {
      const lx = groupLeft + ms.dx * scale;
      const [x, z] = toWorld(rel, lx, meldZ);
      put(layout, {
        id: tileId(ms.tile),
        zone: 'meld',
        seat,
        rel,
        x,
        y: (FLAT_Y + (ms.stacked ? TILE_D : 0)) * scale,
        z,
        base: ms.faceDown ? 'flatDown' : 'flatUp',
        yaw: yaw + (ms.rotated ? Math.PI / 2 : 0),
        tilt: 0,
        back: ms.faceDown,
        index: mi * 4 + idx++,
        ...(scale !== 1 ? { scale } : {}),
      });
    }
    cursor += (m.width + MELD_GROUP_GAP) * scale;
  });
  return melds.length > 0 ? cursor - MELD_GROUP_GAP * scale : cursor;
}

/** Top of the wood rail (its box is centred `RAIL_H / 2 − 0.02` up). */
export const RAIL_TOP = RAIL_H - 0.02;
/** Centre line (owner's frame) of melds stood on the far rail — see `LayoutOptions.farMeldsOnRail`. */
export const RAIL_MELD_Z = FELT_HALF + RAIL_WIDTH / 2;
/** Backward lean of rail-standing melds: the face tips up toward the low camera. */
export const RAIL_MELD_TILT = 0.2;

/**
 * The far seat's melds stood on the far rail (`LayoutOptions.
 * farMeldsOnRail`), faces toward the table centre, running from `left`
 * (the rack's right end) toward the owner's right at `MELD_PITCH`. A
 * claimed tile is not turned (a 90° yaw would stand it edge-on); a
 * gang's fourth tile stands beside the third. Concealed gangs show
 * their backs.
 */
function placeRailMelds(
  layout: Layout,
  melds: readonly { tiles: MeldSlotInfo[]; width: number }[],
  seat: Seat,
  rel: Rel,
  yaw: number,
  left: number,
): void {
  let cursor = left;
  melds.forEach((m, mi) => {
    let idx = 0;
    for (const ms of m.tiles) {
      const lx = cursor + TILE_W / 2;
      cursor += MELD_PITCH;
      const [x, z] = toWorld(rel, lx, RAIL_MELD_Z);
      put(layout, {
        id: tileId(ms.tile),
        zone: 'meld',
        seat,
        rel,
        x,
        y: RAIL_TOP + STAND_Y,
        z,
        base: 'standing',
        // Standing tiles face their owner; a half turn faces the centre,
        // and the lean then tips the top edge toward the rail (away from
        // the camera) so the face looks up at it.
        yaw: yaw + Math.PI,
        tilt: RAIL_MELD_TILT,
        back: ms.faceDown,
        index: mi * 4 + idx++,
      });
    }
    cursor += MELD_GROUP_GAP;
  });
}

/**
 * Walls as the engine sees them: it pops live tiles from the end of
 * `wall` and shifts gang replacements from the front of `deadWall`;
 * physically the remaining tiles never move, so map them onto the *full*
 * set of slots offset by how many have already gone (the gap next to the
 * break grows as the hand progresses, the dead wall shrinks from its far
 * end).
 */
function placeWalls(layout: Layout, state: GameState, me: Seat, opts: LayoutOptions): void {
  const refs = wallSlotRefs(
    state.dealer,
    state.openingRolls?.breakPosition,
    LIVE_TILES,
    DEAD_TILES,
  );
  const drawn = Math.max(0, LIVE_TILES - state.wall.length);
  refs.live.forEach((ref, k) => {
    const i = k - drawn;
    if (i < 0) return;
    const tile = state.wall[state.wall.length - 1 - i];
    if (!tile) return;
    const p = wallSlotPosition(ref, me);
    if (hideSideWall(p, opts.hideSideWallsBeyondZ)) return;
    put(layout, {
      id: tileId(tile),
      zone: 'wall',
      seat: ref.wallSeat,
      rel: p.rel,
      x: p.x,
      y: p.y,
      z: p.z,
      base: 'flatDown',
      yaw: p.yaw,
      tilt: 0,
      back: true,
      index: i,
    });
  });
  const deadGone = Math.max(0, DEAD_TILES - state.deadWall.length);
  refs.dead.forEach((ref, j) => {
    const i = j - deadGone;
    if (i < 0) return;
    const tile = state.deadWall[i];
    if (!tile) return;
    const p = wallSlotPosition(ref, me);
    if (hideSideWall(p, opts.hideSideWallsBeyondZ)) return;
    put(layout, {
      id: tileId(tile),
      zone: 'deadWall',
      seat: ref.wallSeat,
      rel: p.rel,
      x: p.x,
      y: p.y,
      z: p.z,
      base: 'flatDown',
      yaw: p.yaw,
      tilt: 0,
      back: true,
      index: i,
    });
  });
}

/**
 * Waiting-table walls (`LayoutOptions.waitingWalls`): every tile still in
 * `wall` + `deadWall` lies in one of four centred runs of whole stacks,
 * the runs as even as the count allows (the extra stacks go to the seats
 * nearest the viewer). A leftover single tile stays hidden. Keeps the
 * pinwheel shift so the runs sit like the real walls will.
 */
function placeWaitingWalls(layout: Layout, state: GameState, me: Seat): void {
  const tiles = [...state.deadWall, ...state.wall];
  const stacks = Math.floor(tiles.length / 2);
  const base = Math.floor(stacks / 4);
  let extra = stacks - base * 4;
  let k = 0;
  for (let i = 0; i < 4; i++) {
    // Viewer's wall first (rel 0), then round the table, so the extra
    // stacks land on the near / side walls a portrait camera shows.
    const wallSeat = ((me + i) % 4) as Seat;
    const n = Math.min(STACKS_PER_WALL, base + (extra > 0 ? 1 : 0));
    if (extra > 0) extra--;
    const first = Math.floor((STACKS_PER_WALL - n) / 2);
    for (let j = 0; j < n; j++) {
      for (const level of [0, 1] as const) {
        const tile = tiles[k];
        if (!tile) return;
        const p = wallSlotPosition({ wallSeat, stack: first + j, level, dead: false }, me);
        put(layout, {
          id: tileId(tile),
          zone: 'wall',
          seat: wallSeat,
          rel: p.rel,
          x: p.x,
          y: p.y,
          z: p.z,
          base: 'flatDown',
          yaw: p.yaw,
          tilt: 0,
          back: true,
          index: k,
        });
        k++;
      }
    }
  }
}

/** Centre line of the first river row for a tile scale (near edge fixed). */
export function riverZ0(scale: number): number {
  return RIVER_NEAR_EDGE + (TILE_H / 2) * scale;
}

/**
 * River metrics for a tile scale, in the owner's frame. The four rivers
 * are laid out as a pinwheel: each row is shifted toward its owner's
 * right by `shift`, chosen so the row's *left* end never reaches past
 * the near edge of the neighbouring seat's first row (rotated 90°, that
 * neighbour's river occupies the strip |lx| ≤ its half-width beside
 * ours). Centred rows collided at the corners once both rivers held
 * six tiles — round-3: the right seat's rotated 六萬 sat on the user's
 * fifth discard.
 */
export function riverMetrics(scale: number): {
  pitchX: number;
  pitchZ: number;
  /** Half-width of a full row (edge to edge). */
  halfWidth: number;
  /** Rightward pinwheel shift of every row. */
  shift: number;
  /** Near edge (toward the table centre) of the first row. */
  nearEdge: number;
  /** Far edge of the last regular row. */
  farEdge: number;
  /** Right edge of a full row (the far end of the owner's pinwheel arm). */
  rightEdge: number;
} {
  const pitchX = RIVER_PITCH_X * scale;
  const pitchZ = RIVER_PITCH_Z * scale;
  const halfWidth = (RIVER_COLS * pitchX - (pitchX - TILE_W * scale)) / 2;
  const nearEdge = RIVER_NEAR_EDGE;
  const z0 = riverZ0(scale);
  const shift = Math.max(0, halfWidth - nearEdge + RIVER_CORNER_GAP);
  const farEdge = z0 + (RIVER_ROWS - 1) * pitchZ + (TILE_H / 2) * scale;
  return { pitchX, pitchZ, halfWidth, shift, nearEdge, farEdge, rightEdge: shift + halfWidth };
}

/**
 * Dealer chip centre in the dealer's seat frame (x right, z toward
 * them): the near-*left* corner pocket, just beyond the right end of
 * the left neighbour's pinwheel arm (which runs along our left side at
 * z ≤ `rightEdge`) and left of our own river (which starts at
 * lx ≥ shift − halfWidth). Depends on the river scale, so the phone
 * portrait table (1.25×) parks it a little further out than the wide
 * presets; both stay well inside the wall's inner edge.
 */
export function dealerChipLocal(riverScale: number, chipRadius: number): [number, number] {
  const m = riverMetrics(riverScale);
  return [-5.2, m.rightEdge + chipRadius + 0.2];
}

/**
 * River: 6 per row, rows marching toward the owner, every row shifted
 * right into the pinwheel (`riverMetrics`). Past `RIVER_ROWS` rows the
 * extra tiles continue along the last row's right end (the near wall
 * in that corner is long gone by then) instead of starting a fourth
 * row on the wall.
 */
function placeRiver(
  layout: Layout,
  state: GameState,
  seat: Seat,
  rel: Rel,
  yaw: number,
  scale: number,
): void {
  const m = riverMetrics(scale);
  const z0 = riverZ0(scale);
  const regular = RIVER_COLS * RIVER_ROWS;
  state.discards[seat].forEach((t, i) => {
    const overflow = i >= regular;
    const col = overflow ? RIVER_COLS + (i - regular) : i % RIVER_COLS;
    const row = overflow ? RIVER_ROWS - 1 : Math.floor(i / RIVER_COLS);
    const lx = (col - (RIVER_COLS - 1) / 2) * m.pitchX + m.shift;
    const lz = z0 + row * m.pitchZ;
    const [x, z] = toWorld(rel, lx, lz);
    put(layout, {
      id: tileId(t),
      zone: 'discard',
      seat,
      rel,
      x,
      y: FLAT_Y * scale,
      z,
      base: 'flatUp',
      yaw,
      tilt: 0,
      back: false,
      index: i,
      ...(scale !== 1 ? { scale } : {}),
    });
  });
}

/**
 * A "full wall" pose for every tile — the starting point of the
 * hand-start dispense. Tiles still in the walls sit in their real
 * slots; every tile that has left the wall (hands, melds, discards)
 * is placed back into the live slots it was dealt from, in deal order
 * (dealer first, four at a time, walking `nextSeat`), so the dispense
 * flies out of the stacks next to the break exactly as a real deal
 * would.
 */
export function fullWallLayout(state: GameState, me: Seat): Layout {
  const layout = emptyLayout();
  const refs = wallSlotRefs(
    state.dealer,
    state.openingRolls?.breakPosition,
    LIVE_TILES,
    DEAD_TILES,
  );
  const wallSlot = (tile: Tile, ref: WallRef, index: number) => {
    const p = wallSlotPosition(ref, me);
    put(layout, {
      id: tileId(tile),
      zone: ref.dead ? 'deadWall' : 'wall',
      seat: ref.wallSeat,
      rel: p.rel,
      x: p.x,
      y: p.y,
      z: p.z,
      base: 'flatDown',
      yaw: p.yaw,
      tilt: 0,
      back: true,
      index,
    });
  };
  const drawn = Math.max(0, LIVE_TILES - state.wall.length);
  state.wall.forEach((tile, i) => {
    const k = drawn + (state.wall.length - 1 - i);
    const ref = refs.live[k];
    if (ref) wallSlot(tile, ref, k);
  });
  const deadGone = Math.max(0, DEAD_TILES - state.deadWall.length);
  state.deadWall.forEach((tile, j) => {
    const ref = refs.dead[j + deadGone];
    if (ref) wallSlot(tile, ref, j);
  });

  // Deal order: dealer, next, across, previous — four tiles a go.
  const dealt: Tile[] = [];
  const seats: Seat[] = [];
  for (let i = 0; i < 4; i++) seats.push(((state.dealer + i) % 4) as Seat);
  const hands = seats.map((seat) => state.hands[seat]);
  const longest = Math.max(...hands.map((h) => h.length));
  for (let chunk = 0; chunk * 4 < longest; chunk++) {
    for (const hand of hands) dealt.push(...hand.slice(chunk * 4, chunk * 4 + 4));
  }
  for (const seat of seats) {
    for (const m of state.melds[seat]) dealt.push(...m.tiles);
    dealt.push(...state.discards[seat]);
  }
  dealt.forEach((tile, i) => {
    const ref = refs.live[i];
    if (ref && i < drawn) wallSlot(tile, ref, i);
  });
  return layout;
}

/**
 * Debug "tile sheet": all 34 faces standing in rows so glyph quality
 * can be inspected (`shot-states.mjs` → `tile-sheet`).
 */
export function tileSheetLayout(): Layout {
  const layout = emptyLayout();
  const cols = 9;
  const rows: number[][] = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
    [9, 10, 11, 12, 13, 14, 15, 16, 17],
    [18, 19, 20, 21, 22, 23, 24, 25, 26],
    [27, 28, 29, 30, 31, 32, 33],
  ];
  rows.forEach((cells, r) => {
    cells.forEach((cell, c) => {
      // Each row centres on the sheet axis (the 7-tile honours row too).
      const x = (c - (cells.length - 1) / 2) * (TILE_W + 0.28);
      const z = (r - 1.5) * (TILE_H + 1.15);
      put(layout, {
        id: cell * 4,
        zone: 'sheet',
        seat: 0,
        rel: 0,
        x,
        y: STAND_Y,
        z,
        base: 'standing',
        yaw: 0,
        tilt: 0.55,
        back: false,
        index: r * cols + c,
      });
    });
  });
  return layout;
}

/** Bounding metrics used by the camera presets + HUD anchors. */
export function seatAnchor(rel: Rel): { x: number; z: number } {
  const [x, z] = toWorld(rel, 0, HAND_Z);
  return { x, z };
}
