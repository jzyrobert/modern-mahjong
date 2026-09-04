import { TOTAL_TILES } from '@mahjong/game-logic';
import type { GameState, Seat } from '@mahjong/game-logic';
import { Quaternion, Vector3 } from 'three';
import { type Ease, clamp01, easeInOutCubic, easeOutCubic, easeOutQuint } from '../core/tween';
import { type Layout, type TileSlot, type Zone, fullWallLayout } from './layout';

/**
 * Turns successive layouts into tile motion. `Choreographer.setLayout`
 * diffs the previous layout against the next and enqueues a *flight*
 * (timed arc with optional spin + flip) for every tile whose zone
 * changed, a critically-damped *slide* for tiles that only moved
 * within their zone (hand re-sort, river re-flow), and a staggered
 * *dispense* from the wall when a new hand is dealt. `update()` runs
 * in the render loop and never touches React.
 */
export interface Pose {
  pos: Vector3;
  quat: Quaternion;
}

export type FlightKind = 'draw' | 'discard' | 'claim' | 'slide' | 'dispense' | 'reveal' | 'appear';

interface Flight {
  kind: FlightKind;
  from: Pose;
  to: Pose;
  start: number;
  duration: number;
  /** Peak lift of the parabolic arc, world units. */
  arc: number;
  /** Extra spin about world Y that unwinds over the flight, radians. */
  spin: number;
  ease: Ease;
}

export interface TileMotionState {
  visible: boolean;
  pos: Vector3;
  quat: Quaternion;
  /** Scale multiplier (0 while hidden / appearing). */
  scale: number;
  /** Settle bounce — vertical offset, evaluated in closed form from `bounceAt`. */
  bounceY: number;
  /** Amplitude of the landing bounce (0 = none) and when it started. */
  bounceAmp: number;
  bounceAt: number;
  target: Pose | null;
  flight: Flight | null;
  /** Slot this tile currently occupies (for hit-testing / hover). */
  slot: TileSlot | null;
}

export interface ChoreographyOptions {
  reducedMotion: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_MOTION_SLOWMO__: number | undefined;
}

/**
 * Test seam: stretch zone-transition flights (draw / discard / claim /
 * reveal) by this factor so a screenshot can catch a tile mid-arc on a
 * software rasteriser. Dispense, slides and pops are untouched so the
 * deal still settles in time. 1 in the app.
 */
function motionSlowMo(): number {
  const v = globalThis.__MAHJONG_TEST_MOTION_SLOWMO__;
  return typeof v === 'number' && v > 1 ? v : 1;
}

/** Landing-bounce duration, seconds. */
const BOUNCE_S = 0.6;

const _q = new Quaternion();
const _qYaw = new Quaternion();
const _qBase = new Quaternion();
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);

/** Quaternion for a slot: world yaw · base orientation. */
export function slotQuaternion(slot: TileSlot, out = new Quaternion()): Quaternion {
  if (slot.quat) return out.set(slot.quat[0], slot.quat[1], slot.quat[2], slot.quat[3]);
  _qYaw.setFromAxisAngle(Y_AXIS, slot.yaw);
  switch (slot.base) {
    case 'flatUp':
      _qBase.setFromAxisAngle(X_AXIS, -Math.PI / 2);
      break;
    case 'flatDown':
      _qBase.setFromAxisAngle(X_AXIS, Math.PI / 2);
      break;
    default:
      // Negative: the top edge leans away from the owner (see
      // `TileSlot.tilt`), tipping the face up toward the camera.
      _qBase.setFromAxisAngle(X_AXIS, -slot.tilt);
  }
  return out.copy(_qYaw).multiply(_qBase);
}

export function slotPose(slot: TileSlot): Pose {
  return { pos: new Vector3(slot.x, slot.y, slot.z), quat: slotQuaternion(slot) };
}

/** Motion recipe for a zone transition. Durations in ms. */
export function flightFor(
  prev: Zone | null,
  next: Zone,
  reducedMotion: boolean,
): { kind: FlightKind; duration: number; arc: number; spin: number; ease: Ease } {
  const rm = reducedMotion;
  const d = (ms: number) => (rm ? Math.min(ms, 120) : ms);
  if (prev === null)
    return { kind: 'appear', duration: d(260), arc: 0, spin: 0, ease: easeOutCubic };
  if ((prev === 'wall' || prev === 'deadWall') && (next === 'hand' || next === 'oppHand')) {
    return { kind: 'draw', duration: d(560), arc: rm ? 0 : 1.8, spin: 0, ease: easeInOutCubic };
  }
  if ((prev === 'hand' || prev === 'oppHand') && next === 'discard') {
    return {
      kind: 'discard',
      duration: d(520),
      arc: rm ? 0 : 1.4,
      spin: rm ? 0 : 0.9,
      ease: easeInOutCubic,
    };
  }
  if (prev === 'discard' && next === 'meld') {
    return { kind: 'claim', duration: d(520), arc: rm ? 0 : 0.7, spin: 0, ease: easeInOutCubic };
  }
  if (prev === 'oppHand' && (next === 'oppHand' || next === 'meld') && next !== prev) {
    return { kind: 'reveal', duration: d(480), arc: rm ? 0 : 0.5, spin: 0, ease: easeInOutCubic };
  }
  return { kind: 'slide', duration: d(420), arc: rm ? 0 : 0.35, spin: 0, ease: easeInOutCubic };
}

/** Is this the first layout of a freshly dealt hand? */
export function looksFreshlyDealt(state: GameState): boolean {
  if (state.phase !== 'turn' && state.phase !== 'dealing') return false;
  for (const s of [0, 1, 2, 3] as Seat[]) {
    if (state.discards[s].length > 0) return false;
    if (state.melds[s].length > 0) return false;
  }
  return true;
}

/** Dispense order: dealer first, then counter-clockwise, 4 tiles a go. */
export function dispenseDelay(slot: TileSlot, dealer: Seat, reducedMotion: boolean, slow: boolean) {
  if (reducedMotion) return 0;
  const seatOrder = (slot.seat - dealer + 4) % 4;
  const chunk = Math.floor(slot.index / 4);
  const pace = slow ? 1.6 : 1;
  return (chunk * 4 * 55 + seatOrder * 55 + (slot.index % 4) * 14) * pace;
}

export class Choreographer {
  readonly tiles: TileMotionState[] = [];
  private prevLayout: Layout | null = null;
  private prevSeed: number | null = null;
  reducedMotion: boolean;

  constructor(opts: ChoreographyOptions) {
    this.reducedMotion = opts.reducedMotion;
    for (let i = 0; i < TOTAL_TILES; i++) {
      this.tiles.push({
        visible: false,
        pos: new Vector3(),
        quat: new Quaternion(),
        scale: 0,
        bounceY: 0,
        bounceAmp: 0,
        bounceAt: 0,
        target: null,
        flight: null,
        slot: null,
      });
    }
  }

  /** Forget every tile and layout — the next `setLayout` is a first layout again. */
  reset(): void {
    for (const t of this.tiles) {
      t.visible = false;
      t.scale = 0;
      t.bounceY = 0;
      t.bounceAmp = 0;
      t.bounceAt = 0;
      t.target = null;
      t.flight = null;
      t.slot = null;
    }
    this.prevLayout = null;
    this.prevSeed = null;
  }

  /**
   * Apply a new layout. `state` drives the new-hand detection (seed
   * change) and the dispense order, `me` the dispense origin (tiles
   * fly out of the physical wall as seen from the viewer's seat);
   * `now` is `performance.now()`.
   */
  setLayout(
    next: Layout,
    state: GameState | null,
    me: Seat,
    now: number,
    opts: { shuffling?: boolean | undefined; snap?: boolean | undefined } = {},
  ): void {
    const prev = this.prevLayout;
    const newHand =
      state !== null &&
      ((this.prevSeed !== null && this.prevSeed !== state.seed) ||
        (prev === null && looksFreshlyDealt(state)));
    const dispenseFrom = newHand && state ? fullWallLayout(state, me) : null;
    this.apply(next, prev, now, {
      newHand,
      dispenseFrom,
      dealer: state?.dealer ?? 0,
      slow: opts.shuffling ?? false,
      snap: opts.snap ?? false,
    });
    this.prevLayout = next;
    if (state) this.prevSeed = state.seed;
  }

  private apply(
    next: Layout,
    prev: Layout | null,
    now: number,
    o: {
      newHand: boolean;
      dispenseFrom: Layout | null;
      dealer: Seat;
      slow: boolean;
      snap: boolean;
    },
  ): void {
    for (let id = 0; id < TOTAL_TILES; id++) {
      const t = this.tiles[id]!;
      const ns = next[id] ?? null;
      const ps = prev?.[id] ?? null;
      t.slot = ns;
      if (!ns) {
        if (t.visible) {
          // Fade out in place: shrink to nothing then hide.
          t.target = null;
          t.flight = null;
          t.scale = 0;
          t.visible = false;
        }
        continue;
      }
      const to = slotPose(ns);
      if (o.snap || (this.reducedMotion && !t.visible && !o.newHand)) {
        t.visible = true;
        t.scale = 1;
        t.pos.copy(to.pos);
        t.quat.copy(to.quat);
        t.target = to;
        t.flight = null;
        t.bounceY = 0;
        t.bounceAmp = 0;
        continue;
      }
      if (o.newHand && o.dispenseFrom) {
        const fromSlot = o.dispenseFrom[id];
        const from = fromSlot ? slotPose(fromSlot) : { pos: to.pos.clone(), quat: to.quat.clone() };
        // Tiles that end up in the wall don't move — snap them.
        if (ns.zone === 'wall' || ns.zone === 'deadWall') {
          t.visible = true;
          t.scale = 1;
          t.pos.copy(to.pos);
          t.quat.copy(to.quat);
          t.target = to;
          t.flight = null;
          continue;
        }
        const delay = dispenseDelay(ns, o.dealer, this.reducedMotion, o.slow);
        const dur = this.reducedMotion ? 120 : o.slow ? 620 : 460;
        t.visible = true;
        t.scale = 1;
        t.pos.copy(from.pos);
        t.quat.copy(from.quat);
        t.target = to;
        t.flight = {
          kind: 'dispense',
          from,
          to,
          start: now + delay,
          duration: dur,
          arc: this.reducedMotion ? 0 : 1.3,
          spin: 0,
          ease: easeInOutCubic,
        };
        continue;
      }
      if (!t.visible) {
        // Newly visible mid-hand (rare — e.g. a restore): pop in place.
        const f = flightFor(null, ns.zone, this.reducedMotion);
        t.visible = true;
        t.scale = 0;
        t.pos.copy(to.pos);
        t.quat.copy(to.quat);
        t.target = to;
        t.flight = {
          kind: f.kind,
          from: { pos: to.pos.clone(), quat: to.quat.clone() },
          to,
          start: now,
          duration: f.duration,
          arc: 0,
          spin: 0,
          ease: f.ease,
        };
        continue;
      }
      const zoneChanged = ps === null || ps.zone !== ns.zone || ps.base !== ns.base;
      if (zoneChanged) {
        const f = flightFor(ps?.zone ?? null, ns.zone, this.reducedMotion);
        const stagger =
          f.kind === 'reveal' && !this.reducedMotion ? Math.min(ns.index, 13) * 28 : 0;
        t.target = to;
        t.flight = {
          kind: f.kind,
          from: { pos: t.pos.clone(), quat: t.quat.clone() },
          to,
          start: now + stagger,
          duration: f.duration * (this.reducedMotion ? 1 : motionSlowMo()),
          arc: f.arc,
          spin: f.spin,
          ease: f.ease,
        };
        continue;
      }
      // Same zone: slide there (spring) unless a flight is mid-air, in
      // which case retarget the flight's destination.
      if (t.flight) {
        t.flight.to = to;
      }
      t.target = to;
    }
  }

  /** Advance all motion. Returns true while anything is still moving. */
  update(dt: number, now: number): boolean {
    let live = false;
    const k = 1 - 2 ** (-dt / 0.085);
    for (const t of this.tiles) {
      if (!t.visible) continue;
      const fl = t.flight;
      if (fl) {
        live = true;
        if (now < fl.start) continue;
        const raw = clamp01((now - fl.start) / fl.duration);
        const e = fl.ease(raw);
        t.pos.lerpVectors(fl.from.pos, fl.to.pos, e);
        t.pos.y += fl.arc * Math.sin(Math.PI * raw);
        t.quat.slerpQuaternions(fl.from.quat, fl.to.quat, e);
        if (fl.spin !== 0) {
          _q.setFromAxisAngle(Y_AXIS, fl.spin * (1 - e));
          t.quat.premultiply(_q);
        }
        if (fl.kind === 'appear') t.scale = easeOutQuint(raw);
        else t.scale = 1;
        if (raw >= 1) {
          t.pos.copy(fl.to.pos);
          t.quat.copy(fl.to.quat);
          t.scale = 1;
          if (
            !this.reducedMotion &&
            (fl.kind === 'discard' || fl.kind === 'draw' || fl.kind === 'dispense')
          ) {
            // Landing bounce — a short damped hop.
            t.bounceAmp = fl.kind === 'discard' ? 0.11 : 0.07;
            t.bounceAt = now;
          }
          t.flight = null;
        }
        continue;
      }
      if (t.target) {
        const dp = t.target.pos.distanceToSquared(t.pos);
        const dq = 1 - Math.abs(t.quat.dot(t.target.quat));
        if (dp > 1e-6 || dq > 1e-5) {
          live = true;
          t.pos.lerp(t.target.pos, k);
          t.quat.slerp(t.target.quat, k);
          if (
            t.target.pos.distanceToSquared(t.pos) < 4e-7 &&
            1 - Math.abs(t.quat.dot(t.target.quat)) < 4e-6
          ) {
            t.pos.copy(t.target.pos);
            t.quat.copy(t.target.quat);
          }
        }
        if (t.scale < 1) {
          t.scale = Math.min(1, t.scale + dt * 4);
          live = true;
        }
      }
      if (t.bounceAmp !== 0) {
        // Closed-form damped hop: frame-rate independent (an explicit
        // Euler spring blew up at the 2 fps a software rasteriser
        // manages), and strictly ≥ 0 so tiles never sink into the felt.
        const tb = (now - t.bounceAt) / 1000;
        if (tb >= BOUNCE_S) {
          t.bounceAmp = 0;
          t.bounceY = 0;
        } else {
          t.bounceY = t.bounceAmp * Math.exp(-tb * 7) * Math.abs(Math.sin(tb * 17));
          live = true;
        }
      }
    }
    return live;
  }

  /** True while any tile has a queued or in-progress flight. */
  hasFlights(): boolean {
    return this.tiles.some((t) => t.flight !== null);
  }

  /** Forward the current layout (for hit-testing). */
  get layout(): Layout | null {
    return this.prevLayout;
  }
}
