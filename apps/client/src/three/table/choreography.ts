import { TOTAL_TILES } from '@mahjong/game-logic';
import type { GameState, Seat } from '@mahjong/game-logic';
import { Quaternion, Vector3 } from 'three';
import { type Ease, clamp01, easeInCubic, easeInOutCubic, easeOutCubic } from '../core/tween';
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

export type FlightKind =
  | 'draw'
  | 'discard'
  | 'claim'
  | 'slide'
  | 'dispense'
  | 'reveal'
  | 'rise'
  | 'vanish';

/**
 * How far a tile travels straight down to leave the table, world units:
 * past its own height so a standing tile (1.36 tall) and a second-level
 * wall tile (top at 1.24) both end fully under the felt plane, which
 * then hides them. Tiles that leave a layout mid-hand — the four walls
 * and the side seats' rows when the river zoom lays them out no more —
 * *sink* through the felt (`vanish`) instead of blinking off, and come
 * back up through it (`rise`) instead of popping in from nothing:
 * round-5 feedback called the instant hide / pop-in "jarring".
 */
export const SINK_DEPTH = 1.7;
/** Duration of a `vanish` sink, ms (eased in — the tile gathers speed as it goes). */
export const VANISH_MS = 360;

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
  if (prev === null) return { kind: 'rise', duration: d(320), arc: 0, spin: 0, ease: easeOutCubic };
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

/**
 * Where along a flight the tile's orientation has got to (0..1), given
 * the flight's raw time fraction `raw` and its eased position progress
 * `e`. Position and orientation share `e` for most flights; the two hand
 * ↔ table transitions front- or back-load the turn (a smoothstep over a
 * third of the flight time) so the tile never crosses the arc half-turned:
 *
 * - `draw` (wall → a hand): the tile stays back-up and flat, as it lay
 *   in the wall, through the arc and only stands up into the hand over
 *   the last third. A tile rolling face-out mid-air both leaked a hidden
 *   draw and, under the tutorial's veil, read as a dark floating slab.
 * - `discard` (a hand → the river): the tile turns face-up over the
 *   first third, so what crosses the arc to the river is the tile the
 *   table is about to read, not its back.
 */
export function rotationProgress(kind: FlightKind, raw: number, e: number): number {
  if (kind === 'draw') return smoothstep(clamp01((raw - DRAW_TURN_FROM) / (1 - DRAW_TURN_FROM)));
  if (kind === 'discard') return smoothstep(clamp01(raw / DISCARD_TURN_BY));
  return e;
}
const smoothstep = (t: number): number => t * t * (3 - 2 * t);
/** Time fraction of a `draw` flight at which the tile starts to stand up. */
export const DRAW_TURN_FROM = 0.65;
/** Time fraction of a `discard` flight by which the tile lies face-up. */
export const DISCARD_TURN_BY = 0.35;

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
        if (!t.visible) continue;
        if (o.snap || this.reducedMotion) {
          t.target = null;
          t.flight = null;
          t.scale = 0;
          t.visible = false;
          continue;
        }
        // Already on its way down.
        if (t.flight?.kind === 'vanish') continue;
        // Sink through the felt, then hide (`SINK_DEPTH`).
        const from = { pos: t.pos.clone(), quat: t.quat.clone() };
        const sunk = { pos: t.pos.clone().setY(t.pos.y - SINK_DEPTH), quat: t.quat.clone() };
        t.target = null;
        t.bounceAmp = 0;
        t.bounceY = 0;
        t.flight = {
          kind: 'vanish',
          from,
          to: sunk,
          start: now,
          duration: VANISH_MS * motionSlowMo(),
          arc: 0,
          spin: 0,
          ease: easeInCubic,
        };
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
        // Newly visible mid-hand (the walls coming back after a zoom, a
        // restore): rise up through the felt into place.
        const f = flightFor(null, ns.zone, this.reducedMotion);
        const from = { pos: to.pos.clone().setY(to.pos.y - SINK_DEPTH), quat: to.quat.clone() };
        t.visible = true;
        t.scale = 1;
        t.pos.copy(from.pos);
        t.quat.copy(from.quat);
        t.target = to;
        t.flight = {
          kind: f.kind,
          from,
          to,
          start: now,
          duration: f.duration * (this.reducedMotion ? 1 : motionSlowMo()),
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
        t.quat.slerpQuaternions(fl.from.quat, fl.to.quat, rotationProgress(fl.kind, raw, e));
        if (fl.spin !== 0) {
          _q.setFromAxisAngle(Y_AXIS, fl.spin * (1 - e));
          t.quat.premultiply(_q);
        }
        t.scale = 1;
        if (raw >= 1) {
          if (fl.kind === 'vanish') {
            // Under the felt: hide until a layout brings it back.
            t.visible = false;
            t.scale = 0;
            t.flight = null;
            t.target = null;
            continue;
          }
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
