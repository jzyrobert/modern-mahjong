import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { padRect, projectTileRect, rectsClose, tileMatrix, unionRects } from './picking';

function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(50, 412 / 915, 0.1, 100);
  cam.position.set(0, 20, 20);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

describe('projectTileRect', () => {
  test('a tile at the origin projects to a centred rect', () => {
    const m = tileMatrix({ x: 0, y: 0, z: 0 }, new Quaternion(), 1, new Matrix4());
    const r = projectTileRect(m, camera(), 412, 915)!;
    expect(r).not.toBeNull();
    expect(r.left + r.width / 2).toBeCloseTo(206, 0);
    expect(r.width).toBeGreaterThan(5);
    expect(r.height).toBeGreaterThan(5);
  });
  test('nearer tiles project larger and lower on screen', () => {
    const cam = camera();
    const far = projectTileRect(
      tileMatrix({ x: 0, y: 0, z: -8 }, new Quaternion(), 1, new Matrix4()),
      cam,
      412,
      915,
    )!;
    const near = projectTileRect(
      tileMatrix({ x: 0, y: 0, z: 8 }, new Quaternion(), 1, new Matrix4()),
      cam,
      412,
      915,
    )!;
    expect(near.width).toBeGreaterThan(far.width);
    expect(near.top).toBeGreaterThan(far.top);
  });
  test('returns null for a tile behind the camera', () => {
    const m = tileMatrix({ x: 0, y: 20, z: 40 }, new Quaternion(), 1, new Matrix4());
    expect(projectTileRect(m, camera(), 412, 915)).toBeNull();
  });
  test('scale 0 collapses to a point-sized rect', () => {
    const m = tileMatrix({ x: 0, y: 0, z: 0 }, new Quaternion(), 0, new Matrix4());
    const r = projectTileRect(m, camera(), 412, 915)!;
    expect(r.width).toBeCloseTo(0);
    expect(r.height).toBeCloseTo(0);
  });
});

describe('rect helpers', () => {
  test('unionRects spans all inputs; empty → null', () => {
    expect(unionRects([])).toBeNull();
    const u = unionRects([
      { left: 10, top: 10, width: 10, height: 10 },
      { left: 30, top: 0, width: 5, height: 40 },
    ])!;
    expect(u).toEqual({ left: 10, top: 0, width: 25, height: 40 });
  });
  test('padRect grows around the centre and honours minimums', () => {
    const r = padRect({ left: 100, top: 100, width: 20, height: 10 }, 5, 0, 44);
    expect(r.width).toBe(30);
    expect(r.height).toBe(44);
    expect(r.left + r.width / 2).toBe(110);
    expect(r.top + r.height / 2).toBe(105);
  });
  test('rectsClose tolerates sub-pixel jitter only', () => {
    const a = { left: 1, top: 2, width: 3, height: 4 };
    expect(rectsClose(a, { ...a, left: 1.5 })).toBe(true);
    expect(rectsClose(a, { ...a, left: 2 })).toBe(false);
    expect(rectsClose(a, null)).toBe(false);
    expect(rectsClose(null, null)).toBe(true);
  });
  test('tileMatrix composes position + rotation', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const m = tileMatrix({ x: 1, y: 2, z: 3 }, q, 1, new Matrix4());
    const p = new Vector3().setFromMatrixPosition(m);
    expect([p.x, p.y, p.z]).toEqual([1, 2, 3]);
    const v = new Vector3(0, 0, 1).transformDirection(m);
    expect(v.x).toBeCloseTo(1);
  });
});
