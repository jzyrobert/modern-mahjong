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
