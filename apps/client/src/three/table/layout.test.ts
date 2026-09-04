import { type GameState, type Seat, emptyState, startHand, tileId } from '@mahjong/game-logic';
import { describe, expect, test } from 'vitest';
import { TILE_D, TILE_H, TILE_W } from '../tiles/geometry';
import {
  DEAD_WALL_OFFSET,
  FELT_HALF,
  HAND_PITCH,
  HAND_Z,
  MELD_Z,
  OWN_HAND_Z,
  OWN_MELD_RIGHT,
  RIVER_COLS,
  RIVER_ROWS,
  SIDE_SEAT_OUT_LOW,
  STACKS_PER_WALL,
  WALL_D,
  computeLayout,
  dealerChipLocal,
  fullWallLayout,
  heldHandSlots,
  heldRowSplit,
  layoutMeld,
  orderOwnHand,
  quatFromBasis,
  relOf,
  riverMetrics,
  tileSheetLayout,
  toWorld,
  wallSlotPosition,
  wallSlotRefs,
} from './layout';

function dealt(seed = 5, dealer: Seat = 0): GameState {
  return startHand(emptyState(), seed, dealer).state;
}

const OPTS = { sortMode: 'suit' as const, manualOrder: [], drawnTileId: null, reveal: false };

describe('toWorld / relOf', () => {
  test('rotates seat-local coordinates counter-clockwise per seat', () => {
    expect(toWorld(0, 1, 2)).toEqual([1, 2]);
    // The right seat's "toward me" (+z local) points +x in the world.
    expect(toWorld(1, 0, 5)).toEqual([5, -0]);
    expect(toWorld(2, 1, 2)).toEqual([-1, -2]);
    expect(toWorld(3, 0, 5)).toEqual([-5, 0]);
  });
  test('relOf mirrors seatPlacement order (next seat sits to the right)', () => {
    expect(relOf(1, 0)).toBe(1);
    expect(relOf(2, 0)).toBe(2);
    expect(relOf(3, 0)).toBe(3);
    expect(relOf(0, 3)).toBe(1);
  });
});

describe('wallSlotRefs', () => {
  test('live k=0 is the stack left of the break, top tile first', () => {
    const { live } = wallSlotRefs(0, 7, 122, 14);
    // break wall = (0 + 6) % 4 = 2, break stack = 17 - 7 = 10 → live starts at 9.
    expect(live[0]).toEqual({ wallSeat: 2, stack: 9, level: 1, dead: false });
    expect(live[1]).toEqual({ wallSeat: 2, stack: 9, level: 0, dead: false });
    expect(live[2]).toEqual({ wallSeat: 2, stack: 8, level: 1, dead: false });
  });
  test('dead wall is the 7 stacks right of the break; index 0 is the far end', () => {
    const { dead } = wallSlotRefs(0, 7, 122, 14);
    expect(dead).toHaveLength(14);
    expect(dead.every((d) => d.dead)).toBe(true);
    // Far end: stack 16 on the break wall (seat 2).
    expect(dead[0]).toEqual({ wallSeat: 2, stack: 16, level: 1, dead: true });
    expect(dead[13]).toEqual({ wallSeat: 2, stack: 10, level: 0, dead: true });
  });
  test('wraps onto the next seat when the dead wall overruns the corner', () => {
    const { dead } = wallSlotRefs(0, 3, 122, 14);
    // break stack 14 → dead stacks 14,15,16 on seat 2 then 0..3 on seat 3.
    const seats = new Set(dead.map((d) => d.wallSeat));
    expect(seats).toEqual(new Set([2, 3]));
    expect(dead[0]!.wallSeat).toBe(3);
    expect(dead[0]!.stack).toBe(3);
  });
  test('live wall wraps onto the previous seat and never overlaps the dead wall', () => {
    const { live, dead } = wallSlotRefs(1, 12, 122, 14);
    const key = (r: { wallSeat: number; stack: number; level: number }) =>
      `${r.wallSeat}:${r.stack}:${r.level}`;
    const all = new Set([...live, ...dead].map(key));
    expect(all.size).toBe(136);
    expect(live.filter((r) => r.stack === 0).length).toBeGreaterThan(0);
  });
  test('covers all 136 physical slots exactly once for every break', () => {
    for (let n = 2; n <= 12; n++) {
      for (const dealer of [0, 1, 2, 3] as Seat[]) {
        const { live, dead } = wallSlotRefs(dealer, n, 122, 14);
        const all = new Set([...live, ...dead].map((r) => `${r.wallSeat}:${r.stack}:${r.level}`));
        expect(all.size).toBe(136);
        expect(live.length + dead.length).toBe(136);
      }
    }
  });
  test('falls back to a default break when the roll is missing', () => {
    const a = wallSlotRefs(0, undefined, 100, 14);
    const b = wallSlotRefs(0, 7, 100, 14);
    expect(a).toEqual(b);
  });
});

describe('wallSlotPosition', () => {
  test('stacks sit two-high on the near wall for the viewer', () => {
    const bottom = wallSlotPosition({ wallSeat: 0, stack: 8, level: 0, dead: false }, 0);
    const top = wallSlotPosition({ wallSeat: 0, stack: 8, level: 1, dead: false }, 0);
    expect(bottom.z).toBeGreaterThan(8);
    expect(top.y - bottom.y).toBeCloseTo(TILE_D);
    expect(bottom.rel).toBe(0);
  });
  test('dead stacks keep their slot along the row and step toward the rail', () => {
    const live = wallSlotPosition({ wallSeat: 0, stack: 8, level: 0, dead: false }, 0);
    const dead = wallSlotPosition({ wallSeat: 0, stack: 8, level: 0, dead: true }, 0);
    expect(dead.x - live.x).toBeCloseTo(0);
    expect(dead.z - live.z).toBeCloseTo(DEAD_WALL_OFFSET);
    expect(DEAD_WALL_OFFSET).toBe(0);
    // The step is along the owner's outward axis on every wall.
    const right = wallSlotPosition({ wallSeat: 1, stack: 3, level: 0, dead: true }, 0);
    const rightLive = wallSlotPosition({ wallSeat: 1, stack: 3, level: 0, dead: false }, 0);
    expect(right.x - rightLive.x).toBeCloseTo(DEAD_WALL_OFFSET);
    expect(right.z).toBeCloseTo(rightLive.z);
  });
  test('the dead wall wraps onto the next seat when the break is near the right end', () => {
    // Dealer 0, roll 4: break wall 3, dead = left wall 13..16 + near wall 0..2.
    const { dead } = wallSlotRefs(0, 4, 122, 14);
    expect(dead.filter((d) => d.wallSeat === 3)).toHaveLength(8);
    expect(dead.filter((d) => d.wallSeat === 0)).toHaveLength(6);
  });
  test('no two wall stacks intersect for any dealer + break position', () => {
    // Flat tiles: half-extent TILE_W/2 along the wall, TILE_H/2 across.
    const box = (p: { x: number; z: number; rel: number }) => {
      const along = p.rel % 2 === 0 ? 'x' : 'z';
      const hx = along === 'x' ? TILE_W / 2 : TILE_H / 2;
      const hz = along === 'x' ? TILE_H / 2 : TILE_W / 2;
      return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
    };
    for (const dealer of [0, 1, 2, 3] as const) {
      for (let n = 2; n <= 12; n++) {
        const { live, dead } = wallSlotRefs(dealer, n, 122, 14);
        const boxes = [...live, ...dead]
          .filter((r) => r.level === 0)
          .map((r) => box(wallSlotPosition(r, 0)));
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            const overlap =
              a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
            expect(overlap, `dealer ${dealer} roll ${n}: stacks ${i} and ${j} intersect`).toBe(
              false,
            );
          }
        }
      }
    }
  });
  test('the four walls form a pinwheel that never overlaps at the corners', () => {
    // Near wall's right end vs. right wall's near end.
    const nearEnd = wallSlotPosition(
      { wallSeat: 0, stack: STACKS_PER_WALL - 1, level: 0, dead: true },
      0,
    );
    const rightNear = wallSlotPosition({ wallSeat: 1, stack: 0, level: 0, dead: false }, 0);
    // Right wall tiles occupy z ≤ rightNear.z + TILE_W/2; near wall tiles
    // occupy z ≥ nearEnd.z − TILE_H/2.
    expect(rightNear.z + TILE_W / 2).toBeLessThan(nearEnd.z - TILE_H / 2);
    expect(Math.abs(nearEnd.x) + TILE_W / 2).toBeLessThan(FELT_HALF);
  });
});

describe('layoutMeld', () => {
  const t = (rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, copy: 0 | 1 | 2 | 3 = 0) =>
    ({ kind: 'suit', suit: 'pin', rank, copy }) as const;
  test('peng from the next seat rotates the right-hand tile', () => {
    const m = layoutMeld({ kind: 'peng', tiles: [t(5), t(5, 1), t(5, 2)], from: 1 }, 0);
    expect(m.tiles.map((x) => x.rotated)).toEqual([false, false, true]);
    expect(m.width).toBeCloseTo(TILE_W * 2 + TILE_H + 2 * 0.03);
  });
  test('chi from the previous seat rotates the left-hand tile', () => {
    const m = layoutMeld({ kind: 'chi', tiles: [t(3), t(4), t(5)], from: 3 }, 0);
    expect(m.tiles.map((x) => x.rotated)).toEqual([true, false, false]);
  });
  test('across-seat claim rotates the middle tile', () => {
    const m = layoutMeld({ kind: 'peng', tiles: [t(3), t(3, 1), t(3, 2)], from: 2 }, 0);
    expect(m.tiles.map((x) => x.rotated)).toEqual([false, true, false]);
  });
  test('gang stacks the 4th tile on the claimed tile', () => {
    const m = layoutMeld(
      { kind: 'gang-exposed', tiles: [t(7), t(7, 1), t(7, 2), t(7, 3)], from: 2 },
      0,
    );
    expect(m.tiles).toHaveLength(4);
    const stacked = m.tiles[3]!;
    expect(stacked.stacked).toBe(true);
    expect(stacked.dx).toBeCloseTo(m.tiles[1]!.dx);
    expect(stacked.rotated).toBe(true);
  });
  test('concealed gang lies face down with the 4th on the middle', () => {
    const m = layoutMeld({ kind: 'gang-concealed', tiles: [t(1), t(1, 1), t(1, 2), t(1, 3)] }, 0);
    expect(m.tiles.every((x) => x.faceDown)).toBe(true);
    expect(m.tiles[3]!.dx).toBeCloseTo(m.tiles[1]!.dx);
    expect(m.tiles.some((x) => x.rotated)).toBe(false);
  });
});

describe('orderOwnHand', () => {
  test('keeps the drawn tile at the right end regardless of sort', () => {
    const st = dealt();
    const hand = st.hands[0];
    const drawn = hand[3]!;
    const ordered = orderOwnHand(hand, {
      sortMode: 'suit',
      manualOrder: [],
      drawnTileId: tileId(drawn),
    });
    expect(ordered).toHaveLength(hand.length);
    expect(tileId(ordered[ordered.length - 1]!)).toBe(tileId(drawn));
  });
  test('manual mode honours the stored order', () => {
    const st = dealt();
    const hand = st.hands[0];
    const rev = [...hand].reverse().map(tileId);
    const ordered = orderOwnHand(hand, { sortMode: 'manual', manualOrder: rev, drawnTileId: null });
    expect(ordered.map(tileId)).toEqual(rev);
  });
});

describe('computeLayout', () => {
  test('places every tile in the state exactly once', () => {
    const st = dealt();
    const layout = computeLayout(st, 0, OPTS);
    const placed = layout.filter((s) => s !== null);
    const total =
      st.wall.length +
      st.deadWall.length +
      [0, 1, 2, 3].reduce(
        (acc, s) =>
          acc +
          st.hands[s as Seat].length +
          st.discards[s as Seat].length +
          st.melds[s as Seat].reduce((a, m) => a + m.tiles.length, 0),
        0,
      );
    expect(placed).toHaveLength(total);
    expect(total).toBe(136);
    // Every entry sits at its own id.
    layout.forEach((s, i) => {
      if (s) expect(s.id).toBe(i);
    });
  });
  test("the user's hand stands in a centred row at the near edge", () => {
    const st = dealt();
    const layout = computeLayout(st, 0, OPTS);
    const hand = layout.filter((s) => s?.zone === 'hand');
    expect(hand).toHaveLength(st.hands[0].length);
    for (const s of hand) {
      expect(s!.base).toBe('standing');
      expect(s!.z).toBeCloseTo(OWN_HAND_Z);
      expect(s!.back).toBe(false);
    }
    const xs = hand.map((s) => s!.x).sort((a, b) => a - b);
    expect(xs[0]! + xs[xs.length - 1]!).toBeCloseTo(0, 5);
    expect(xs[1]! - xs[0]!).toBeCloseTo(TILE_W + 0.06);
  });
  test('opponent hands stand face-away (back shown) at their edges', () => {
    const st = dealt();
    const layout = computeLayout(st, 0, OPTS);
    const right = layout.filter((s) => s?.zone === 'oppHand' && s.seat === 1);
    expect(right.length).toBe(st.hands[1].length);
    for (const s of right) {
      expect(s!.base).toBe('standing');
      expect(s!.back).toBe(true);
      expect(s!.x).toBeCloseTo(HAND_Z);
      expect(s!.yaw).toBeCloseTo(Math.PI / 2);
    }
  });
  test('reveal lays opponents flat face up', () => {
    const st = { ...dealt(), phase: 'resolved' as const };
    const layout = computeLayout(st, 0, { ...OPTS, reveal: true });
    const opp = layout.filter((s) => s?.zone === 'oppHand');
    for (const s of opp) {
      expect(s!.base).toBe('flatUp');
      expect(s!.back).toBe(false);
    }
  });
  test('discards flow 6 per row toward the owner', () => {
    const st = dealt();
    const hand = st.hands[0];
    const discards = hand.slice(0, 8);
    const withRiver: GameState = {
      ...st,
      hands: { ...st.hands, 0: hand.slice(8) },
      discards: { ...st.discards, 0: discards },
    };
    const layout = computeLayout(withRiver, 0, OPTS);
    const river = layout.filter((s) => s?.zone === 'discard');
    expect(river).toHaveLength(8);
    const rows = new Set(river.map((s) => s!.z.toFixed(3)));
    expect(rows.size).toBe(2);
    const first = river.find((s) => s!.index === 0)!;
    const seventh = river.find((s) => s!.index === 6)!;
    expect(seventh.z).toBeGreaterThan(first.z);
    expect(seventh.x).toBeCloseTo(first.x);
  });
  /** Flat-tile footprint: the long axis runs along the owner's z (world z for rel 0 / 2, world x for the side seats). */
  function footprint(s: { x: number; z: number; rel: number; scale?: number }) {
    const k = s.scale ?? 1;
    const side = s.rel === 1 || s.rel === 3;
    const hx = ((side ? TILE_H : TILE_W) / 2) * k;
    const hz = ((side ? TILE_W : TILE_H) / 2) * k;
    return { x0: s.x - hx, x1: s.x + hx, z0: s.z - hz, z1: s.z + hz };
  }
  /** Four full rivers (18 each) so every corner of the pinwheel is loaded. */
  function fullRivers(scale: number) {
    const st = dealt();
    const pool = [...st.wall, ...st.deadWall];
    const discards = { ...st.discards };
    for (const seat of [0, 1, 2, 3] as Seat[])
      discards[seat] = pool.splice(0, RIVER_COLS * RIVER_ROWS);
    const state: GameState = { ...st, wall: pool, deadWall: [], discards };
    const layout = computeLayout(state, 0, { ...OPTS, riverScale: scale });
    return layout.filter((s) => s?.zone === 'discard').map((s) => s!);
  }
  test('the four rivers form a pinwheel that never collides at the corners', () => {
    for (const scale of [1, 1.1, 1.28]) {
      const river = fullRivers(scale);
      expect(river).toHaveLength(4 * RIVER_COLS * RIVER_ROWS);
      for (let i = 0; i < river.length; i++) {
        for (let j = i + 1; j < river.length; j++) {
          const a = footprint(river[i]!);
          const b = footprint(river[j]!);
          const overlap =
            a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
          expect(overlap, `tiles ${river[i]!.id} / ${river[j]!.id} overlap at scale ${scale}`).toBe(
            false,
          );
        }
      }
      // Every river stays inside the walls' inner faces and off the plate.
      const m = riverMetrics(scale);
      expect(m.farEdge).toBeLessThan(WALL_D - TILE_H / 2);
      expect(m.nearEdge).toBeGreaterThan(1.9);
      for (const s of river) {
        expect(Math.max(Math.abs(s.x), Math.abs(s.z))).toBeLessThan(WALL_D - TILE_H / 2);
      }
    }
  });
  test('a 19th discard extends the last row instead of starting a fourth on the wall', () => {
    const st = dealt();
    const pool = [...st.wall];
    const state: GameState = {
      ...st,
      wall: pool.slice(20),
      discards: { ...st.discards, 0: pool.slice(0, 20) },
    };
    const river = computeLayout(state, 0, OPTS).filter((s) => s?.zone === 'discard');
    const rows = new Set(river.map((s) => s!.z.toFixed(3)));
    expect(rows.size).toBe(RIVER_ROWS);
    const last = river.find((s) => s!.index === 19)!;
    const lastRegular = river.find((s) => s!.index === RIVER_COLS * RIVER_ROWS - 1)!;
    expect(last.z).toBeCloseTo(lastRegular.z, 6);
    expect(last.x).toBeGreaterThan(lastRegular.x + 1.5);
  });
  test('the dealer chip pocket clears every river and the wall', () => {
    for (const scale of [1, 1.28]) {
      const [cx, cz] = dealerChipLocal(scale, 0.62);
      const r = 0.62;
      for (const s of fullRivers(scale)) {
        const f = footprint(s);
        const hit = cx + r > f.x0 && cx - r < f.x1 && cz + r > f.z0 && cz - r < f.z1;
        expect(hit, `chip overlaps discard ${s.id} at scale ${scale}`).toBe(false);
      }
      expect(cz + r).toBeLessThan(WALL_D - TILE_H / 2);
      expect(Math.abs(cx) + r).toBeLessThan(WALL_D - TILE_H / 2);
    }
    // Wide presets keep the chip's near edge above the near wall's top
    // from a 30° camera: edge z ≤ 6.35 (see TableScene CHIP_RADIUS note).
    expect(dealerChipLocal(1, 0.62)[1] + 0.62).toBeLessThan(6.35);
  });
  test('the drawn tile is offset from the rest of the hand', () => {
    const st = dealt();
    const hand = st.hands[0];
    const drawn = hand[0]!;
    const layout = computeLayout(st, 0, { ...OPTS, drawnTileId: tileId(drawn) });
    const slots = layout
      .filter((s) => s?.zone === 'hand')
      .sort((a, b) => a!.x - b!.x)
      .map((s) => s!);
    const last = slots[slots.length - 1]!;
    expect(last.id).toBe(tileId(drawn));
    const gapLast = last.x - slots[slots.length - 2]!.x;
    const gapNormal = slots[1]!.x - slots[0]!.x;
    expect(gapLast).toBeGreaterThan(gapNormal + 0.3);
  });
  test('everything stays inside the felt', () => {
    const st = dealt(9, 2);
    const layout = computeLayout(st, 1, OPTS);
    for (const s of layout) {
      if (!s) continue;
      expect(Math.abs(s.x)).toBeLessThan(FELT_HALF);
      expect(Math.abs(s.z)).toBeLessThan(FELT_HALF);
    }
  });
  test('the next tile to draw is live index 0', () => {
    const st = dealt();
    const layout = computeLayout(st, 0, OPTS);
    const next = st.wall[st.wall.length - 1]!;
    const slot = layout[tileId(next)]!;
    expect(slot.zone).toBe('wall');
    expect(slot.index).toBe(0);
  });
  test('drawing a tile leaves the rest of the wall in place (gap grows from the break)', () => {
    const st = dealt();
    const before = computeLayout(st, 0, OPTS);
    const drawnTile = st.wall[st.wall.length - 1]!;
    const after = computeLayout(
      { ...st, wall: st.wall.slice(0, -1), hands: { ...st.hands, 0: [...st.hands[0], drawnTile] } },
      0,
      OPTS,
    );
    for (const t of st.wall.slice(0, -1)) {
      const a = before[tileId(t)]!;
      const b = after[tileId(t)]!;
      expect([b.x, b.y, b.z]).toEqual([a.x, a.y, a.z]);
    }
    // The dealt tiles' former slots (next to the break) stay empty.
    const drawnSlot = before[tileId(drawnTile)]!;
    const occupied = after.some(
      (s) =>
        s && s.zone === 'wall' && s.x === drawnSlot.x && s.z === drawnSlot.z && s.y === drawnSlot.y,
    );
    expect(occupied).toBe(false);
  });
  test('gang replacements shrink the dead wall from its far end', () => {
    const st = dealt();
    const before = computeLayout(st, 0, OPTS);
    const taken = st.deadWall[0]!;
    const after = computeLayout(
      { ...st, deadWall: st.deadWall.slice(1), hands: { ...st.hands, 0: [...st.hands[0], taken] } },
      0,
      OPTS,
    );
    for (const t of st.deadWall.slice(1)) {
      const a = before[tileId(t)]!;
      const b = after[tileId(t)]!;
      expect([b.x, b.y, b.z]).toEqual([a.x, a.y, a.z]);
    }
  });
  test('standing tiles lean back away from their owner', () => {
    const st = dealt();
    const layout = computeLayout(st, 0, OPTS);
    const mine = layout.find((s) => s?.zone === 'hand')!;
    const opp = layout.find((s) => s?.zone === 'oppHand')!;
    expect(mine.tilt).toBeGreaterThan(0.3);
    expect(opp.tilt).toBeGreaterThan(0);
    expect(opp.tilt).toBeLessThan(mine.tilt);
  });
});

describe('fullWallLayout / tileSheetLayout', () => {
  test('full wall places all 136 tiles face down in the walls', () => {
    const st = dealt();
    const layout = fullWallLayout(st, 0);
    const placed = layout.filter((s) => s !== null);
    expect(placed).toHaveLength(136);
    expect(placed.every((s) => s!.base === 'flatDown')).toBe(true);
    // Every physical slot is used exactly once.
    const keys = new Set(
      placed.map((s) => `${s!.x.toFixed(3)}:${s!.y.toFixed(3)}:${s!.z.toFixed(3)}`),
    );
    expect(keys.size).toBe(136);
  });
  test("the dealer's first tiles fly out of the slots next to the break", () => {
    const st = dealt(5, 1);
    const full = fullWallLayout(st, 0);
    const live = computeLayout(st, 0, OPTS);
    // Remaining wall tiles keep their live positions in the full layout.
    for (const t of st.wall) {
      const a = live[tileId(t)]!;
      const b = full[tileId(t)]!;
      expect([b.x, b.z]).toEqual([a.x, a.z]);
    }
    // The dealer's first dealt tile occupies live slot 0.
    const first = full[tileId(st.hands[1][0]!)]!;
    expect(first.zone).toBe('wall');
    expect(first.index).toBe(0);
  });
  test('tile sheet shows every distinct face once', () => {
    const layout = tileSheetLayout();
    const placed = layout.filter((s) => s !== null);
    expect(placed).toHaveLength(34);
    expect(new Set(placed.map((s) => s!.id >> 2)).size).toBe(34);
  });
});

describe('held hand (phone portrait)', () => {
  const FRAME = {
    origin: [0, 40, 25] as [number, number, number],
    right: [1, 0, 0] as [number, number, number],
    up: [0, 0.3, -0.954] as [number, number, number],
    forward: [0, 0.954, 0.3] as [number, number, number],
    lean: 0.2,
    pxPerUnit: 48,
    rowPitch: TILE_H + 0.34,
  };
  test('heldRowSplit keeps ≤ 8 tiles on one row and halves larger hands', () => {
    expect(heldRowSplit(0)).toEqual([]);
    expect(heldRowSplit(8)).toEqual([8]);
    expect(heldRowSplit(13)).toEqual([7, 6]);
    expect(heldRowSplit(14)).toEqual([7, 7]);
    expect(heldRowSplit(11)).toEqual([6, 5]);
  });
  test('quatFromBasis round-trips the identity and a 90° yaw', () => {
    expect(quatFromBasis([1, 0, 0], [0, 1, 0], [0, 0, 1])).toEqual([0, 0, 0, 1]);
    // Rotating +90° about Y maps +Z (forward) onto +X.
    const q = quatFromBasis([0, 0, -1], [0, 1, 0], [1, 0, 0]);
    expect(q[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2, 5);
  });
  test('the hand leaves the table into the frame; melds lie flat right-aligned', () => {
    const s = dealt();
    const layout = computeLayout(s, 0, { ...OPTS, heldHand: FRAME });
    const hand = layout.filter((sl) => sl?.zone === 'hand');
    expect(hand).toHaveLength(s.hands[0].length);
    for (const sl of hand) {
      expect(sl!.quat).toBeDefined();
      expect(sl!.y).toBeGreaterThan(30);
      expect(Math.abs(sl!.x)).toBeLessThan(5);
    }
    // 14 tiles → 7 + 7: two distinct rows, drawn tile (last) on the front row.
    const ys = new Set(hand.map((sl) => Math.round(sl!.y * 10)));
    expect(ys.size).toBe(2);
    // The rest of the table is untouched.
    const wall = layout.filter((sl) => sl?.zone === 'wall');
    expect(wall.length).toBe(s.wall.length);
  });
  test('front row carries the drawn tile with its gap', () => {
    const s = dealt();
    const hand = s.hands[0];
    const drawn = tileId(hand[hand.length - 1]!);
    const slots = heldHandSlots(hand, hand.length - 1, FRAME, 0);
    const front = slots.filter((sl) => sl.index >= 7);
    expect(front).toHaveLength(7);
    const drawnSlot = slots.find((sl) => sl.id === drawn)!;
    const prev = front[front.length - 2]!;
    // Gap between the last regular tile and the drawn tile exceeds the pitch.
    expect(drawnSlot.x - prev.x).toBeGreaterThan(HAND_PITCH + 0.3);
  });
  test('own melds sit on the felt row at the right when the hand is held', () => {
    const s = dealt();
    const withMeld: GameState = {
      ...s,
      hands: { ...s.hands, 0: s.hands[0].slice(3) },
      melds: {
        ...s.melds,
        0: [{ kind: 'peng', tiles: s.hands[0].slice(0, 3), from: 1 }],
      },
    } as GameState;
    const layout = computeLayout(withMeld, 0, { ...OPTS, heldHand: FRAME });
    const melds = layout.filter((sl) => sl?.zone === 'meld' && sl.seat === 0);
    expect(melds).toHaveLength(3);
    for (const m of melds) {
      expect(m!.z).toBeCloseTo(MELD_Z, 5);
      expect(m!.x).toBeLessThanOrEqual(OWN_MELD_RIGHT + 0.01);
      expect(m!.x).toBeGreaterThan(5);
    }
  });
  test('tile sheet rows are each centred on the sheet axis', () => {
    const layout = tileSheetLayout();
    const honours = layout.filter((sl) => sl && sl.zone === 'sheet' && sl.id >= 27 * 4);
    const xs = honours.map((sl) => sl!.x);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 5);
  });
});

/** Seed 5 with a peng laid out for `seat`, claimed from the next seat. */
function withMeldFor(seat: Seat): GameState {
  const s = dealt();
  return {
    ...s,
    hands: { ...s.hands, [seat]: s.hands[seat].slice(3) },
    melds: {
      ...s.melds,
      [seat]: [{ kind: 'peng', tiles: s.hands[seat].slice(0, 3), from: (seat + 1) % 4 }],
    },
  } as GameState;
}

describe('low-camera side seats (phone landscape)', () => {
  test('sideSeatOut moves the side racks and their melds out together; far and own rows stay', () => {
    for (const seat of [1, 3] as Seat[]) {
      const st = withMeldFor(seat);
      const base = computeLayout(st, 0, OPTS);
      const out = computeLayout(st, 0, { ...OPTS, sideSeatOut: SIDE_SEAT_OUT_LOW });
      const rel = relOf(seat, 0);
      const sign = rel === 1 ? 1 : -1;
      for (const zone of ['oppHand', 'meld'] as const) {
        const a = base.filter((sl) => sl?.zone === zone && sl.seat === seat);
        const b = out.filter((sl) => sl?.zone === zone && sl.seat === seat);
        expect(a.length).toBeGreaterThan(0);
        expect(b).toHaveLength(a.length);
        for (const sl of b) {
          const src = a.find((x) => x!.id === sl!.id)!;
          expect(sl!.x - src.x).toBeCloseTo(sign * SIDE_SEAT_OUT_LOW, 6);
          expect(sl!.z).toBeCloseTo(src.z, 6);
        }
        // Still on the felt, clear of the rail.
        for (const sl of b) expect(Math.abs(sl!.x) + TILE_H / 2).toBeLessThan(FELT_HALF);
      }
      // The far seat and the user's row are untouched.
      for (const other of [0, 2] as Seat[]) {
        const a = base.filter((sl) => sl && sl.seat === other && sl.zone !== 'wall');
        const b = out.filter((sl) => sl && sl.seat === other && sl.zone !== 'wall');
        expect(b.map((sl) => [sl!.x, sl!.z])).toEqual(a.map((sl) => [sl!.x, sl!.z]));
      }
    }
  });
  test('sideMeldsNear puts the right seat’s melds at the near (+z) end, left seat unchanged', () => {
    const st = withMeldFor(1);
    const base = computeLayout(st, 0, OPTS);
    const near = computeLayout(st, 0, { ...OPTS, sideMeldsNear: true });
    const meldZ = (l: typeof base) =>
      l.filter((sl) => sl?.zone === 'meld' && sl.seat === 1).map((sl) => sl!.z);
    const rackZ = (l: typeof base) =>
      l.filter((sl) => sl?.zone === 'oppHand' && sl.seat === 1).map((sl) => sl!.z);
    // Default: melds beyond the rack's far end (−z). Near: beyond its near end (+z).
    expect(Math.max(...meldZ(base))).toBeLessThan(Math.min(...rackZ(base)));
    expect(Math.min(...meldZ(near))).toBeGreaterThan(Math.max(...rackZ(near)));
    // The row keeps its overall footprint (a rotated claimed tile is
    // TILE_H long along the row) and the meld's internal order.
    const extent = (l: typeof base) => {
      const row = l.filter(
        (sl) => (sl?.zone === 'meld' || sl?.zone === 'oppHand') && sl.seat === 1,
      );
      const edges = row.flatMap((sl) => {
        const half = Math.abs(Math.cos(sl!.yaw - Math.PI / 2)) > 0.5 ? TILE_W / 2 : TILE_H / 2;
        return [sl!.z - half, sl!.z + half];
      });
      return Math.max(...edges) - Math.min(...edges);
    };
    expect(extent(near)).toBeCloseTo(extent(base), 6);
    const order = (l: typeof base) =>
      l
        .filter((sl) => sl?.zone === 'meld' && sl.seat === 1)
        .sort((a, b) => a!.index - b!.index)
        .map((sl) => sl!.z);
    const dNear = order(near);
    const dBase = order(base);
    for (let i = 1; i < dNear.length; i++) {
      expect(Math.sign(dNear[i]! - dNear[i - 1]!)).toBe(Math.sign(dBase[i]! - dBase[i - 1]!));
    }
    // The left seat's melds are already at the near end and do not move.
    const st3 = withMeldFor(3);
    const a = computeLayout(st3, 0, OPTS).filter((sl) => sl?.zone === 'meld');
    const b = computeLayout(st3, 0, { ...OPTS, sideMeldsNear: true }).filter(
      (sl) => sl?.zone === 'meld',
    );
    expect(b.map((sl) => [sl!.x, sl!.z])).toEqual(a.map((sl) => [sl!.x, sl!.z]));
  });
});

describe('waiting-table walls', () => {
  test('whole stacks only, four centred runs as even as the count allows, odd tile hidden', () => {
    const s = dealt();
    // 3 racks of 13 → 97 tiles left: 48 stacks (12 per wall) and one hidden tile.
    const st: GameState = {
      ...s,
      hands: { 0: s.hands[0].slice(0, 13), 1: s.hands[1], 2: s.hands[2], 3: [] },
      wall: [...s.wall, ...s.hands[3], s.hands[0][13]!],
    } as GameState;
    const layout = computeLayout(st, 0, { ...OPTS, waitingWalls: true });
    const walls = layout.filter((sl) => sl?.zone === 'wall' || sl?.zone === 'deadWall');
    expect(walls).toHaveLength(96);
    expect(layout.filter((sl) => sl?.zone === 'deadWall')).toHaveLength(0);
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const mine = walls.filter((sl) => sl!.seat === seat);
      expect(mine).toHaveLength(24);
      // Every position holds exactly two tiles (a full stack).
      const byPos = new Map<string, number>();
      for (const sl of mine) {
        const k = `${sl!.x.toFixed(3)}:${sl!.z.toFixed(3)}`;
        byPos.set(k, (byPos.get(k) ?? 0) + 1);
      }
      expect([...byPos.values()].every((n) => n === 2)).toBe(true);
      // Centred on the wall's shifted midline: the run's centre is within
      // half a pitch of the 17-stack row's centre.
      const rel = relOf(seat, 0);
      const along = mine.map((sl) =>
        rel === 0 ? sl!.x : rel === 1 ? -sl!.z : rel === 2 ? -sl!.x : sl!.z,
      );
      const mid = (Math.min(...along) + Math.max(...along)) / 2;
      const rowMid = wallSlotPosition({ wallSeat: seat, stack: 8, level: 0, dead: false }, 0);
      const rowMidAlong =
        rel === 0 ? rowMid.x : rel === 1 ? -rowMid.z : rel === 2 ? -rowMid.x : rowMid.z;
      expect(Math.abs(mid - rowMidAlong)).toBeLessThanOrEqual(0.6);
    }
    // Racks are laid out as usual.
    expect(layout.filter((sl) => sl?.zone === 'oppHand')).toHaveLength(26);
    expect(layout.filter((sl) => sl?.zone === 'hand')).toHaveLength(13);
  });
  test('full walls with no racks stay 17 stacks a side', () => {
    const full = dealt();
    const ring: GameState = {
      ...full,
      hands: { 0: [], 1: [], 2: [], 3: [] },
      wall: [...full.wall, ...full.hands[0], ...full.hands[1], ...full.hands[2], ...full.hands[3]],
    } as GameState;
    const layout = computeLayout(ring, 0, { ...OPTS, waitingWalls: true });
    const walls = layout.filter((sl) => sl?.zone === 'wall');
    expect(walls).toHaveLength(136);
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      expect(walls.filter((sl) => sl!.seat === seat)).toHaveLength(2 * STACKS_PER_WALL);
    }
  });
});

describe('tile sheet', () => {
  test('tile sheet rows are each centred on the sheet axis (dup guard)', () => {
    const layout = tileSheetLayout();
    const honours = layout.filter((sl) => sl && sl.zone === 'sheet' && sl.id >= 27 * 4);
    const xs = honours.map((sl) => sl!.x);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 5);
  });
});
