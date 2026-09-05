import { type GameState, type Seat, emptyState, startHand, tileId } from '@mahjong/game-logic';
import { type Quaternion, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import {
  Choreographer,
  dispenseDelay,
  flightFor,
  looksFreshlyDealt,
  slotQuaternion,
} from './choreography';
import { type TileSlot, computeLayout } from './layout';

function dealt(seed = 5, dealer: Seat = 0): GameState {
  return startHand(emptyState(), seed, dealer).state;
}
const OPTS = { sortMode: 'suit' as const, manualOrder: [], drawnTileId: null, reveal: false };

const standing: TileSlot = {
  id: 0,
  zone: 'hand',
  seat: 0,
  rel: 0,
  x: 0,
  y: 0.68,
  z: 10.55,
  base: 'standing',
  yaw: 0,
  tilt: 0.5,
  back: false,
  index: 0,
};

describe('slotQuaternion', () => {
  test('a standing tile leans its top away from the owner and its face up', () => {
    const q = slotQuaternion(standing);
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    const face = new Vector3(0, 0, 1).applyQuaternion(q);
    expect(up.z).toBeLessThan(0); // top edge toward the table centre (−z for rel 0)
    expect(face.y).toBeGreaterThan(0.3); // printed face tips up toward the camera
    expect(face.z).toBeGreaterThan(0.8); // …and still toward the owner
  });
  test('flat face-up points +Z (face) at the sky; face-down at the felt', () => {
    const up = new Vector3(0, 0, 1).applyQuaternion(
      slotQuaternion({ ...standing, base: 'flatUp', tilt: 0 }),
    );
    const down = new Vector3(0, 0, 1).applyQuaternion(
      slotQuaternion({ ...standing, base: 'flatDown', tilt: 0 }),
    );
    expect(up.y).toBeCloseTo(1);
    expect(down.y).toBeCloseTo(-1);
  });
  test('yaw rotates the far seat so its face points away from the camera', () => {
    const face = new Vector3(0, 0, 1).applyQuaternion(
      slotQuaternion({ ...standing, yaw: Math.PI, tilt: 0 }),
    );
    expect(face.z).toBeCloseTo(-1);
  });
});

describe('flightFor', () => {
  test('classifies the core transitions', () => {
    expect(flightFor('wall', 'hand', false).kind).toBe('draw');
    expect(flightFor('hand', 'discard', false).kind).toBe('discard');
    expect(flightFor('discard', 'meld', false).kind).toBe('claim');
    expect(flightFor(null, 'hand', false).kind).toBe('appear');
    expect(flightFor('hand', 'hand', false).kind).toBe('slide');
  });
  test('discards spin, draws arc, reduced motion collapses to ≤ 120 ms', () => {
    expect(flightFor('hand', 'discard', false).spin).toBeGreaterThan(0);
    expect(flightFor('wall', 'hand', false).arc).toBeGreaterThan(0);
    for (const kind of [
      flightFor('wall', 'hand', true),
      flightFor('hand', 'discard', true),
      flightFor('discard', 'meld', true),
    ]) {
      expect(kind.duration).toBeLessThanOrEqual(120);
      expect(kind.arc).toBe(0);
      expect(kind.spin).toBe(0);
    }
  });
});

describe('dispenseDelay / looksFreshlyDealt', () => {
  test('dealer goes first, later chunks wait longer, shuffling slows the pace', () => {
    const slot = (seat: Seat, index: number): TileSlot => ({ ...standing, seat, index });
    expect(dispenseDelay(slot(1, 0), 1, false, false)).toBeLessThan(
      dispenseDelay(slot(2, 0), 1, false, false),
    );
    expect(dispenseDelay(slot(1, 4), 1, false, false)).toBeGreaterThan(
      dispenseDelay(slot(0, 3), 1, false, false),
    );
    expect(dispenseDelay(slot(1, 8), 1, false, true)).toBeGreaterThan(
      dispenseDelay(slot(1, 8), 1, false, false),
    );
    expect(dispenseDelay(slot(3, 12), 0, true, true)).toBe(0);
  });
  test('a fresh deal has no discards or melds', () => {
    const st = dealt();
    expect(looksFreshlyDealt(st)).toBe(true);
    const hand = st.hands[0];
    expect(
      looksFreshlyDealt({
        ...st,
        hands: { ...st.hands, 0: hand.slice(1) },
        discards: { ...st.discards, 0: [hand[0]!] },
      }),
    ).toBe(false);
  });
});

describe('Choreographer', () => {
  test('first layout of a fresh deal dispenses hands out of the wall', () => {
    const st = dealt();
    const c = new Choreographer({ reducedMotion: false });
    const layout = computeLayout(st, 0, OPTS);
    c.setLayout(layout, st, 0, 1000);
    const handTiles = st.hands[0].map(tileId);
    for (const id of handTiles) {
      const t = c.tiles[id]!;
      const slot = layout[id]!;
      expect(t.visible).toBe(true);
      expect(t.flight?.kind).toBe('dispense');
      // Starts somewhere in the wall, flat, away from its hand slot.
      expect(t.pos.y).toBeLessThan(1.0);
      expect(t.pos.distanceTo(new Vector3(slot.x, slot.y, slot.z))).toBeGreaterThan(0.5);
    }
    // Wall tiles snap straight into place.
    const wallId = tileId(st.wall[0]!);
    expect(c.tiles[wallId]!.flight).toBeNull();
    expect(c.hasFlights()).toBe(true);
  });
  test('flights land exactly on their slot, then bounce briefly, then go quiet', () => {
    const st = dealt();
    const c = new Choreographer({ reducedMotion: false });
    const layout = computeLayout(st, 0, OPTS);
    c.setLayout(layout, st, 0, 0);
    // Step well past every dispense (delays ≤ ~1 s + 460 ms flights).
    let now = 0;
    for (let i = 0; i < 400; i++) {
      now += 16;
      c.update(0.016, now);
    }
    expect(c.hasFlights()).toBe(false);
    const id = tileId(st.hands[0][0]!);
    const slot = layout[id]!;
    expect(c.tiles[id]!.pos.x).toBeCloseTo(slot.x, 3);
    expect(c.tiles[id]!.pos.z).toBeCloseTo(slot.z, 3);
    // The whole scene goes idle once bounces decay.
    for (let i = 0; i < 60; i++) {
      now += 16;
      c.update(0.016, now);
    }
    expect(c.update(0.016, now + 16)).toBe(false);
  });
  test('bounce is bounded and frame-rate independent (no blow-up at 2 fps)', () => {
    const st = dealt();
    const c = new Choreographer({ reducedMotion: false });
    c.setLayout(computeLayout(st, 0, OPTS), st, 0, 0);
    let now = 0;
    let maxBounce = 0;
    for (let i = 0; i < 20; i++) {
      now += 500;
      c.update(0.1, now);
      for (const t of c.tiles) maxBounce = Math.max(maxBounce, Math.abs(t.bounceY));
    }
    expect(maxBounce).toBeLessThan(0.2);
    expect(c.tiles.every((t) => t.bounceY >= 0)).toBe(true);
  });
  test('a discard flies hand → river with spin; reduced motion snaps', () => {
    const st = dealt();
    const hand = st.hands[0];
    const discarded = hand[0]!;
    const next: GameState = {
      ...st,
      hands: { ...st.hands, 0: hand.slice(1) },
      discards: { ...st.discards, 0: [discarded] },
    };
    for (const reduced of [false, true]) {
      const c = new Choreographer({ reducedMotion: reduced });
      c.setLayout(computeLayout(st, 0, OPTS), st, 0, 0, { snap: true });
      c.setLayout(computeLayout(next, 0, OPTS), next, 0, 100);
      const t = c.tiles[tileId(discarded)]!;
      expect(t.flight?.kind).toBe('discard');
      if (reduced) expect(t.flight!.duration).toBeLessThanOrEqual(120);
      else expect(t.flight!.spin).toBeGreaterThan(0);
      c.update(0.016, 100 + t.flight!.duration + 1);
      expect(t.flight).toBeNull();
      expect(t.slot?.zone).toBe('discard');
    }
  });
  test('a new seed re-dispenses; the same seed only slides', () => {
    const st = dealt(5);
    const c = new Choreographer({ reducedMotion: false });
    c.setLayout(computeLayout(st, 0, OPTS), st, 0, 0, { snap: true });
    c.setLayout(computeLayout(st, 0, { ...OPTS, sortMode: 'num' }), st, 0, 50);
    expect(c.tiles.some((t) => t.flight?.kind === 'dispense')).toBe(false);
    const st2 = dealt(6);
    c.setLayout(computeLayout(st2, 0, OPTS), st2, 0, 100);
    expect(c.tiles.some((t) => t.flight?.kind === 'dispense')).toBe(true);
  });
  test('quaternion helper output is normalised', () => {
    const q: Quaternion = slotQuaternion(standing);
    expect(q.length()).toBeCloseTo(1);
  });
});

describe('gang replacement', () => {
  test('the replacement leaves the dead wall from its break end and is the tile that lands in the hand', () => {
    // The engine `shift()`s `deadWall[0]`; the layout maps `deadWall[j]`
    // from the break outward, so index 0 is the stack right across the
    // gap from the live wall's drawing end — the deck's tail (牌尾), the
    // physical "back of the wall" a 補牌 replacement is taken from. The
    // tile that flies is the one that arrives; no other wall tile moves.
    const st = dealt();
    const c = new Choreographer({ reducedMotion: true });
    const before = computeLayout(st, 0, OPTS);
    c.setLayout(before, st, 0, 1000);
    c.update(0.5, 1200);
    const taken = st.deadWall[0]!;
    const takenId = tileId(taken);
    const next: GameState = {
      ...st,
      deadWall: st.deadWall.slice(1),
      hands: { ...st.hands, 0: [...st.hands[0], taken] },
    };
    const after = computeLayout(next, 0, OPTS);
    c.setLayout(after, next, 0, 2000);
    const t = c.tiles[takenId]!;
    expect(t.flight?.kind).toBe('draw');
    // …out of the dead-wall slot it stood in.
    const from = before[takenId]!;
    expect(from.zone).toBe('deadWall');
    expect(t.flight!.from.pos.x).toBeCloseTo(from.x, 6);
    expect(t.flight!.from.pos.z).toBeCloseTo(from.z, 6);
    // …into the hand.
    expect(after[takenId]!.zone).toBe('hand');
    // The break end: no other dead tile sits closer to the live wall's
    // k = 0 slot (the two ends of the deck meet across the gap).
    const dead = before.filter((sl) => sl?.zone === 'deadWall');
    const liveNext = before.find((sl) => sl?.zone === 'wall' && sl.index === 0)!;
    const dist = (sl: { x: number; z: number }) => Math.hypot(sl.x - liveNext.x, sl.z - liveNext.z);
    expect(dist(from)).toBeCloseTo(Math.min(...dead.map((sl) => dist(sl!))), 6);
    // Every other wall tile stays put (no flight, same slot).
    for (const sl of before) {
      if (!sl || sl.id === takenId || (sl.zone !== 'wall' && sl.zone !== 'deadWall')) continue;
      const nt = c.tiles[sl.id]!;
      expect(nt.flight).toBeNull();
      expect(after[sl.id]!.x).toBeCloseTo(sl.x, 6);
      expect(after[sl.id]!.z).toBeCloseTo(sl.z, 6);
    }
  });
});
