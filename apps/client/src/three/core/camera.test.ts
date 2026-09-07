import { Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { CameraRig } from './camera';

const A = {
  position: [0, 20, 20] as [number, number, number],
  target: [0, 0, 0] as [number, number, number],
  fov: 45,
};
const B = {
  position: [0, 30, 10] as [number, number, number],
  target: [0, 0, 2] as [number, number, number],
  fov: 40,
};

describe('CameraRig.goalCamera', () => {
  test('sits at the goal preset while the live camera is still easing', () => {
    const rig = new CameraRig(A, 1.6);
    rig.setPreset(B);
    rig.update(0.016, 1000);
    rig.update(0.016, 1016);
    // The live camera has barely left A…
    expect(rig.camera.position.distanceTo(new Vector3(...A.position))).toBeLessThan(2);
    // …but the goal camera is already at B, looking at B's target.
    const g = rig.goalCamera();
    expect(g.position.toArray().map((v) => Math.round(v * 1000) / 1000)).toEqual(B.position);
    expect(g.fov).toBe(B.fov);
    expect(g.aspect).toBe(1.6);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(g.quaternion);
    const toTarget = new Vector3(...B.target).sub(g.position).normalize();
    expect(fwd.dot(toTarget)).toBeGreaterThan(0.9999);
  });

  test('a world point projects to the same screen spot through the goal camera as after settling', () => {
    const rig = new CameraRig(A, 1.6);
    rig.setPreset(B);
    const early = new Vector3(3, 0, 9).project(rig.goalCamera()).clone();
    for (let i = 0; i < 400; i++) rig.update(0.016, 1000 + i * 16);
    const settled = new Vector3(3, 0, 9).project(rig.camera);
    expect(settled.x).toBeCloseTo(early.x, 3);
    expect(settled.y).toBeCloseTo(early.y, 3);
  });
});

describe('CameraRig.presetSettled', () => {
  test('false while a preset eases, true once the springs are visibly at rest', () => {
    const rig = new CameraRig(A, 1.6);
    expect(rig.presetSettled()).toBe(true);
    rig.setPreset(B);
    expect(rig.presetSettled()).toBe(false);
    let now = 1000;
    for (let i = 0; i < 20 && !rig.presetSettled(); i++) {
      now += 100;
      rig.update(0.1, now);
    }
    // ~10 half-lives of 0.22 s bring a 14-unit move under 0.05 units.
    expect(now - 1000).toBeLessThanOrEqual(2000);
    expect(rig.presetSettled()).toBe(true);
  });

  test('parallax alone never counts as preset motion', () => {
    const rig = new CameraRig(A, 1.6);
    rig.parallaxEnabled = true;
    rig.setPointer(1, 1);
    expect(rig.update(0.016, 1000)).toBe(true); // the rig is live (parallax)…
    expect(rig.presetSettled()).toBe(true); // …but the preset is at rest.
  });
});

describe('CameraRig parallax ease', () => {
  const step = (rig: CameraRig, ms: number) => {
    let now = 1000;
    for (let t = 0; t < ms; t += 10) {
      now += 10;
      rig.update(0.01, now);
    }
  };
  test('the default half-life reaches half the goal offset in 0.15 s', () => {
    const rig = new CameraRig(A, 1.6);
    rig.parallaxStrength = 1;
    rig.setPointer(1, 0);
    step(rig, 150);
    // Camera x = preset x (0) + parallax; half-life 0.15 s → ≈ 0.5.
    expect(rig.camera.position.x).toBeCloseTo(0.5, 1);
  });
  test('a longer parallaxHalfLife drifts instead of tracking the pointer', () => {
    const slow = new CameraRig(A, 1.6);
    slow.parallaxStrength = 1;
    slow.parallaxHalfLife = 0.5;
    slow.setPointer(1, 0);
    step(slow, 150);
    // After 0.15 s the slow rig has covered ~19 % (1 − 2^(−0.3)), not 50 %.
    expect(slow.camera.position.x).toBeGreaterThan(0.15);
    expect(slow.camera.position.x).toBeLessThan(0.25);
    step(slow, 500);
    expect(slow.camera.position.x).toBeCloseTo(1 - 2 ** (-0.65 / 0.5), 1);
    // The offset is `strength` × pointer: the table's 0.08 is ≈ 5 px of
    // drift at the desktop camera's distance, far below the old 0.45.
    const table = new CameraRig(A, 1.6);
    table.parallaxStrength = 0.08;
    table.parallaxHalfLife = 0.5;
    table.setPointer(1, 1);
    step(table, 5000);
    // 5 s is ten half-lives. The rig stops re-applying the camera once the
    // residue is under 0.001 units, so read it to ±0.005.
    expect(table.camera.position.x).toBeCloseTo(0.08, 2);
    expect(table.camera.position.y - A.position[1]).toBeCloseTo(0.04, 2);
  });
});
