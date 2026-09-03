import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { TABLE_CAMERA, cameraFor, classifyViewport, sheetCameraFor } from './cameraPresets';
import { FELT_HALF, HAND_Z, RAIL_WIDTH, STAND_Y } from './layout';

function ndc(
  preset: { position: number[]; target: number[]; fov: number },
  w: number,
  h: number,
  p: [number, number, number],
) {
  const cam = new PerspectiveCamera(preset.fov, w / h, 0.1, 100);
  cam.position.set(preset.position[0]!, preset.position[1]!, preset.position[2]!);
  cam.lookAt(preset.target[0]!, preset.target[1]!, preset.target[2]!);
  cam.updateMatrixWorld();
  return new Vector3(...p).project(cam);
}

describe('classifyViewport', () => {
  test('phones split on orientation, wide+tall is desktop', () => {
    expect(classifyViewport(412, 915)).toBe('phone-portrait');
    expect(classifyViewport(915, 412)).toBe('phone-landscape');
    expect(classifyViewport(1440, 900)).toBe('desktop');
    expect(classifyViewport(834, 1194)).toBe('desktop');
    expect(cameraFor(360, 800)).toBe(TABLE_CAMERA['phone-portrait']);
  });
});

describe('table presets keep the hand and the far rail in frame', () => {
  const cases: [string, number, number][] = [
    ['phone-portrait', 412, 915],
    ['phone-landscape', 915, 412],
    ['desktop', 1440, 900],
  ];
  for (const [name, w, h] of cases) {
    test(name, () => {
      const preset = TABLE_CAMERA[name as keyof typeof TABLE_CAMERA];
      // Hand row (14 tiles + drawn gap ≈ ±7.9) fully inside the viewport.
      const handR = ndc(preset, w, h, [7.9, STAND_Y, HAND_Z]);
      const handC = ndc(preset, w, h, [0, STAND_Y, HAND_Z]);
      expect(Math.abs(handR.x)).toBeLessThanOrEqual(1);
      expect(handC.y).toBeLessThan(0); // lower half of the screen
      expect(handC.y).toBeGreaterThan(-0.9);
      // Far rail visible below the top edge.
      const far = ndc(preset, w, h, [0, 0.5, -(FELT_HALF + RAIL_WIDTH)]);
      expect(far.y).toBeLessThan(0.95);
      expect(far.y).toBeGreaterThan(handC.y);
    });
  }
});

describe('sheetCameraFor', () => {
  test('fits the 9-column sheet at any aspect', () => {
    for (const [w, h] of [
      [412, 915],
      [915, 412],
      [1440, 900],
    ] as const) {
      const preset = sheetCameraFor(w, h);
      const edge = ndc(preset, w, h, [5.6, 0.68, 0]);
      expect(Math.abs(edge.x)).toBeLessThan(1);
      expect(preset.position[1]).toBeGreaterThan(5);
    }
  });
});
