import { PerspectiveCamera, Vector3 } from 'three';
import { type SpringState, springStep } from './tween';

/**
 * Camera rig. Presets are named views; `setPreset` eases position +
 * target with critically-damped springs so the transition never
 * overshoots. Parallax adds a small pointer-driven offset on top
 * (disabled on the `low` tier and under reduced motion).
 */
export interface CameraPreset {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export class CameraRig {
  readonly camera: PerspectiveCamera;
  private pos = { x: spring(0), y: spring(0), z: spring(0) };
  private tgt = { x: spring(0), y: spring(0), z: spring(0) };
  private fov: SpringState = spring(45);
  private goal: CameraPreset;
  private parallax = new Vector3();
  private parallaxGoal = new Vector3();
  parallaxEnabled = true;
  parallaxStrength = 0.35;
  halfLife = 0.22;
  private lastNow = 0;

  constructor(initial: CameraPreset, aspect: number) {
    this.camera = new PerspectiveCamera(initial.fov, aspect, 0.1, 100);
    this.goal = initial;
    this.snap(initial);
  }

  snap(p: CameraPreset): void {
    if (!presetIsFinite(p)) return;
    this.goal = p;
    this.pos.x.value = p.position[0];
    this.pos.y.value = p.position[1];
    this.pos.z.value = p.position[2];
    this.tgt.x.value = p.target[0];
    this.tgt.y.value = p.target[1];
    this.tgt.z.value = p.target[2];
    this.fov.value = p.fov;
    this.apply();
  }

  setPreset(p: CameraPreset): void {
    if (!presetIsFinite(p)) return;
    this.goal = p;
  }

  /**
   * A scratch camera parked at the *goal* preset (no spring lag, no
   * parallax), sharing this rig's aspect. Projections through it give
   * the rect a world point will settle at once the ease-in finishes —
   * the tutorial overlay keys its keep-outs off that, so a coach-mark
   * placed during the intro camera move never has to re-dock.
   */
  goalCamera(out: PerspectiveCamera = this.scratch): PerspectiveCamera {
    const g = this.goal;
    out.aspect = this.camera.aspect;
    out.fov = g.fov;
    out.near = this.camera.near;
    out.far = this.camera.far;
    out.position.set(g.position[0], g.position[1], g.position[2]);
    out.lookAt(g.target[0], g.target[1], g.target[2]);
    out.updateProjectionMatrix();
    out.updateMatrixWorld();
    return out;
  }
  private readonly scratch = new PerspectiveCamera(45, 1, 0.1, 100);

  /** Pointer in normalised device coords (-1..1). */
  setPointer(nx: number, ny: number): void {
    this.parallaxGoal.set(nx * this.parallaxStrength, ny * this.parallaxStrength * 0.5, 0);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Returns true while still moving. When `now` (ms) is given the
   * springs step by wall-clock time (capped at 0.5 s) instead of the
   * loop's clamped `dt`: on a software rasteriser running at 2–3 fps
   * the 0.1 s clamp would otherwise ease the camera at a third of real
   * speed and leave a preset change visibly mid-flight for seconds.
   */
  update(loopDt: number, now?: number): boolean {
    let dt = loopDt;
    if (now !== undefined) {
      if (this.lastNow !== 0) dt = Math.min(0.5, Math.max(0, (now - this.lastNow) / 1000));
      this.lastNow = now;
    }
    const g = this.goal;
    let live = false;
    live = springStep(this.pos.x, g.position[0], dt, this.halfLife) || live;
    live = springStep(this.pos.y, g.position[1], dt, this.halfLife) || live;
    live = springStep(this.pos.z, g.position[2], dt, this.halfLife) || live;
    live = springStep(this.tgt.x, g.target[0], dt, this.halfLife) || live;
    live = springStep(this.tgt.y, g.target[1], dt, this.halfLife) || live;
    live = springStep(this.tgt.z, g.target[2], dt, this.halfLife) || live;
    live = springStep(this.fov, g.fov, dt, this.halfLife) || live;
    if (this.parallaxEnabled) {
      const before = this.parallax.distanceToSquared(this.parallaxGoal);
      this.parallax.lerp(this.parallaxGoal, 1 - 2 ** (-dt / 0.15));
      if (before > 1e-6) live = true;
    }
    if (live) this.apply();
    return live;
  }

  /**
   * True once the preset springs (position, target, fov) are visibly at
   * rest — within `eps` world units of the goal. Parallax is excluded, so
   * a pointer wobble never counts as camera motion. The tutorial holds a
   * lesson's first coach card on this (via `core/sceneRects`), so it is
   * coarser than `update`'s own 1e-3 rest test: a 20-unit dolly is
   * sub-pixel long before the spring calls itself finished.
   */
  presetSettled(eps = 0.05): boolean {
    const g = this.goal;
    return (
      Math.abs(this.pos.x.value - g.position[0]) < eps &&
      Math.abs(this.pos.y.value - g.position[1]) < eps &&
      Math.abs(this.pos.z.value - g.position[2]) < eps &&
      Math.abs(this.tgt.x.value - g.target[0]) < eps &&
      Math.abs(this.tgt.y.value - g.target[1]) < eps &&
      Math.abs(this.tgt.z.value - g.target[2]) < eps &&
      Math.abs(this.fov.value - g.fov) < eps * 10
    );
  }

  private apply(): void {
    const c = this.camera;
    c.position.set(
      this.pos.x.value + this.parallax.x,
      this.pos.y.value + this.parallax.y,
      this.pos.z.value + this.parallax.z,
    );
    c.lookAt(this.tgt.x.value, this.tgt.y.value, this.tgt.z.value);
    if (Math.abs(c.fov - this.fov.value) > 1e-3) {
      c.fov = this.fov.value;
      c.updateProjectionMatrix();
    }
  }
}

function spring(v: number): SpringState {
  return { value: v, velocity: 0 };
}

/**
 * A preset with a NaN / Infinity component (a solve fed a 0×0 host
 * before layout) would poison the springs for good — refuse it and keep
 * the last good goal.
 */
function presetIsFinite(p: CameraPreset): boolean {
  return (
    p.position.every(Number.isFinite) && p.target.every(Number.isFinite) && Number.isFinite(p.fov)
  );
}
