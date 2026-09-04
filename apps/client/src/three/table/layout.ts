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
 * Exposed melds lie flat, tucked toward the table centre: a flat tile
 * reaches ±TILE_H/2 from this line, so 10.3 keeps the meld off the wall
 * (outer edge 9.48) and inside the portrait frame (|x| ≤ 11.0).
 */
export const MELD_Z = 10.3;
/**
 * Dead-wall stacks step this far toward the rail so the block reads as
 * distinct from the live wall at every viewport (with the darker tint).
 */
export const DEAD_WALL_OFFSET = 0.18;
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
export const HELD_ROW_GAP = 0.34;
/** Depth step between the held rows (the back row sits a little further). */
export const HELD_ROW_DEPTH = 0.3;
/** Right edge of the user's flat melds when the hand is held off-table. */
export const OWN_MELD_RIGHT = 10.7;
export const MELD_GAP = 0.55;
export const MELD_GROUP_GAP = 0.3;
export const MELD_PITCH = TILE_W + 0.03;
export const RIVER_COLS = 6;
export const RIVER_PITCH_X = TILE_W + 0.06;
export const RIVER_PITCH_Z = TILE_H + 0.1;
export const RIVER_Z0 = 2.6;
/** Felt half-size and rail dimensions, shared with `TableScene`. */
export const FELT_HALF = 11.9;
export const RAIL_WIDTH = 1.1;
export const CENTRE_PLATE_RADIUS = 1.9;

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
 * faces z-fighting read as a ghost tile). Instead the dead stacks step
 * `DEAD_WALL_OFFSET` toward the rail (an L-shaped kink, never an
 * overlap) and `TableScene` tints them darker; the break gap grows
 * naturally as tiles leave.
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
export interface LayoutOptions extends HandOrderOptions {
  /** Hand end: opponents' concealed tiles lie face up in their row. */
  reveal: boolean;
  /**
   * Phone portrait: lay the user's hand out in this near-camera frame
   * (two standing rows) instead of on the table edge, and put their
   * exposed melds flat on the felt in front of them.
   */
  heldHand?: HeldHandFrame | null | undefined;
}

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

  // Walls. The engine pops live tiles from the end of `wall` and
  // shifts gang replacements from the front of `deadWall`; physically
  // the remaining tiles never move, so map them onto the *full* set of
  // slots offset by how many have already gone (the gap next to the
  // break grows as the hand progresses, the dead wall shrinks from its
  // far end).
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

  for (const seat of [0, 1, 2, 3] as Seat[]) {
    const rel = relOf(seat, me);
    const yaw = yawOf(rel);
    const isMe = seat === me;

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
      placeRiver(layout, state, seat, rel, yaw);
      continue;
    }
    const handWidth =
      hand.length > 0
        ? hand.length * HAND_PITCH - (HAND_PITCH - TILE_W) + (drawnIdx >= 0 ? DRAWN_GAP : 0)
        : 0;
    const meldsWidth =
      melds.reduce((acc, m) => acc + m.width, 0) + Math.max(0, melds.length - 1) * MELD_GROUP_GAP;
    const total = handWidth + (melds.length > 0 && hand.length > 0 ? MELD_GAP : 0) + meldsWidth;
    let cursor = -total / 2;

    const revealOpp = !isMe && opts.reveal;
    hand.forEach((t, i) => {
      if (i === drawnIdx) cursor += DRAWN_GAP;
      const lx = cursor + TILE_W / 2;
      cursor += HAND_PITCH;
      const [x, z] = toWorld(rel, lx, isMe ? OWN_HAND_Z : HAND_Z);
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
        back: !isMe && !revealOpp,
        index: i,
      });
    });
    if (hand.length > 0 && melds.length > 0) cursor += MELD_GAP - (HAND_PITCH - TILE_W);
    melds.forEach((m, mi) => {
      const groupLeft = cursor;
      let idx = 0;
      for (const ms of m.tiles) {
        const lx = groupLeft + ms.dx;
        const [x, z] = toWorld(rel, lx, MELD_Z);
        put(layout, {
          id: tileId(ms.tile),
          zone: 'meld',
          seat,
          rel,
          x,
          y: FLAT_Y + (ms.stacked ? TILE_D : 0),
          z,
          base: ms.faceDown ? 'flatDown' : 'flatUp',
          yaw: yaw + (ms.rotated ? Math.PI / 2 : 0),
          tilt: 0,
          back: ms.faceDown,
          index: mi * 4 + idx++,
        });
      }
      cursor += m.width + MELD_GROUP_GAP;
    });

    placeRiver(layout, state, seat, rel, yaw);
  }
  return layout;
}

/** River: 6 per row, rows marching toward the owner. */
function placeRiver(layout: Layout, state: GameState, seat: Seat, rel: Rel, yaw: number): void {
  state.discards[seat].forEach((t, i) => {
    const col = i % RIVER_COLS;
    const row = Math.floor(i / RIVER_COLS);
    const lx = (col - (RIVER_COLS - 1) / 2) * RIVER_PITCH_X;
    const lz = RIVER_Z0 + row * RIVER_PITCH_Z;
    const [x, z] = toWorld(rel, lx, lz);
    put(layout, {
      id: tileId(t),
      zone: 'discard',
      seat,
      rel,
      x,
      y: FLAT_Y,
      z,
      base: 'flatUp',
      yaw,
      tilt: 0,
      back: false,
      index: i,
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
