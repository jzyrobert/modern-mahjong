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

  constructor(initial: CameraPreset, aspect: number) {
    this.camera = new PerspectiveCamera(initial.fov, aspect, 0.1, 100);
    this.goal = initial;
    this.snap(initial);
  }

  snap(p: CameraPreset): void {
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
    this.goal = p;
  }

  /** Pointer in normalised device coords (-1..1). */
  setPointer(nx: number, ny: number): void {
    this.parallaxGoal.set(nx * this.parallaxStrength, ny * this.parallaxStrength * 0.5, 0);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Returns true while still moving. */
  update(dt: number): boolean {
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
