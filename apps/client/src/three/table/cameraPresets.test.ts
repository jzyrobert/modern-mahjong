import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { TILE_D, TILE_H } from '../tiles/geometry';
import {
  HELD_BOTTOM_PX,
  PORTRAIT_BAND_BIAS,
  PORTRAIT_BAND_GAP,
  PORTRAIT_BAND_TOP,
  PORTRAIT_STRIP_H,
  PORTRAIT_STRIP_TOP,
  PORTRAIT_X_HALF,
  TABLE_CAMERA,
  ZOOM_WALL_ANCHOR,
  ZOOM_WALL_ANCHOR_Y,
  cameraFor,
  classifyViewport,
  heldHandFrameFor,
  heldHandTopPx,
  portraitCameraAnchored,
  portraitCameraFor,
  projectPreset,
  riverZoomCameraFor,
  sheetCameraFor,
} from './cameraPresets';
import { FELT_HALF, HAND_Z, MELD_Z, OWN_HAND_Z, RAIL_WIDTH, STAND_Y, WALL_D } from './layout';

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
    expect(cameraFor(1440, 900)).toBe(TABLE_CAMERA.desktop);
    expect(cameraFor(915, 412)).toBe(TABLE_CAMERA['phone-landscape']);
    expect(cameraFor(360, 800)).toEqual(
      portraitCameraFor(360, 800, PORTRAIT_BAND_TOP, heldHandTopPx(360, 800) - PORTRAIT_BAND_GAP),
    );
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
      const preset = cameraFor(w, h);
      expect(classifyViewport(w, h)).toBe(name);
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

describe('heldHandFrameFor', () => {
  test('one held tile is ≥ 44 CSS px wide and the block sits above the action row', () => {
    const w = 412;
    const h = 915;
    const preset = cameraFor(w, h);
    const f = heldHandFrameFor(preset, w, h);
    expect(f.pxPerUnit).toBeGreaterThanOrEqual(44);
    // `forward` is the view axis; the hand sits ~20° below it, so the
    // direction to the camera is close but not identical.
    const toCam = [
      preset.position[0] - f.origin[0],
      preset.position[1] - f.origin[1],
      preset.position[2] - f.origin[2],
    ];
    const len = Math.hypot(...(toCam as [number, number, number]));
    const dot =
      (toCam[0]! * f.forward[0] + toCam[1]! * f.forward[1] + toCam[2]! * f.forward[2]) / len;
    expect(dot).toBeGreaterThan(0.9);
    // Baseline projects to HELD_BOTTOM_PX above the bottom edge.
    const cam = new PerspectiveCamera(preset.fov, w / h, 0.1, 200);
    cam.position.set(...preset.position);
    cam.lookAt(...preset.target);
    cam.updateMatrixWorld();
    const p = new Vector3(...f.origin).project(cam);
    const yPx = (-p.y * 0.5 + 0.5) * h;
    expect(yPx).toBeCloseTo(h - HELD_BOTTOM_PX, 0);
    // The ray through the hand misses the table: it hits y = 0 beyond the rail.
    const dir = new Vector3(...f.origin).sub(cam.position).normalize();
    const t = -cam.position.y / dir.y;
    const zHit = cam.position.z + dir.z * t;
    expect(zHit).toBeGreaterThan(14);
  });
  test('the hand is behind the key light so it casts no shadow on the felt', () => {
    const f = heldHandFrameFor(cameraFor(412, 915), 412, 915);
    const light = new Vector3(7, 18, 9);
    const dir = light.clone().normalize().negate();
    const depth = new Vector3(...f.origin).sub(light).dot(dir);
    expect(depth).toBeLessThan(4);
  });
  test('portrait frames the side rows edge to edge and centres the table in its band', () => {
    for (const [w, h] of [
      [412, 915],
      [360, 780],
      [430, 932],
    ] as const) {
      const preset = cameraFor(w, h);
      const cam = new PerspectiveCamera(preset.fov, w / h, 0.1, 200);
      cam.position.set(...preset.position);
      cam.lookAt(...preset.target);
      cam.updateMatrixWorld();
      const px = (x: number, y: number, z: number) => {
        const p = new Vector3(x, y, z).project(cam);
        return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
      };
      // Side seats' rows (hands + flat melds) stay inside the viewport
      // while the rails (|x| = 13) crop off-screen.
      expect(px(PORTRAIT_X_HALF, 0, 0).x).toBeLessThanOrEqual(w + 1);
      expect(px(-PORTRAIT_X_HALF, 0, 0).x).toBeGreaterThanOrEqual(-1);
      expect(px(13, 0, 0).x).toBeGreaterThan(w);
      // Table centre sits at the band's bias point (±4 px).
      const bandTop = PORTRAIT_BAND_TOP;
      const bandBottom = heldHandTopPx(w, h) - PORTRAIT_BAND_GAP;
      const centreY = bandTop + PORTRAIT_BAND_BIAS * (bandBottom - bandTop);
      expect(Math.abs(px(0, 0, 0).y - centreY)).toBeLessThan(4);
      // Far row below the seat strip, near row above the held hand.
      expect(px(0, 0, -HAND_Z - 0.7).y).toBeGreaterThan(bandTop);
      expect(px(0, 0, HAND_Z + 0.7).y).toBeLessThan(bandBottom);
      // A river tile is at least 17.5 CSS px wide on a 412 px phone.
      if (w === 412) expect(px(1, 0.3, 0).x - px(0, 0.3, 0).x).toBeGreaterThanOrEqual(17.5);
      // The side seats' flat melds (tucked to MELD_Z, reaching a flat
      // tile's half-height further out) stay ≥ 6 px inside the viewport
      // at their nearest corner, where perspective scale is largest
      // (round-3: the left meld was half-clipped at ±11.2).
      const meldNear = px(-(MELD_Z + TILE_H / 2), TILE_D, 8.0);
      expect(meldNear.x).toBeGreaterThanOrEqual(6);
      const handNear = px(-(HAND_Z + TILE_D / 2), 0, 7.5);
      expect(handNear.x).toBeGreaterThanOrEqual(6);
    }
  });
  test('river zoom frames the river block ≥ 25 px per tile and keeps the hand off the table', () => {
    const w = 412;
    const h = 915;
    const preset = riverZoomCameraFor(w, h);
    const cam = new PerspectiveCamera(preset.fov, w / h, 0.1, 200);
    cam.position.set(...preset.position);
    cam.lookAt(...preset.target);
    cam.updateMatrixWorld();
    const px = (x: number, y: number, z: number) => {
      const p = new Vector3(x, y, z).project(cam);
      return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
    };
    expect(px(1, 0.3, 0).x - px(0, 0.3, 0).x).toBeGreaterThanOrEqual(25);
    // Every river's furthest row (z ≈ ±7.6 in its owner's frame) is inside.
    expect(px(7.9, 0, 0).x).toBeLessThanOrEqual(w + 1);
    expect(px(0, 0, 7.9).y).toBeLessThan(heldHandTopPx(w, h) - PORTRAIT_BAND_GAP);
    // The far wall's near-top edge is pinned to the strip's bottom edge
    // so the whole far wall row hides behind the zoom header bar, and
    // the far river's last row clears the strip.
    const anchor = px(...ZOOM_WALL_ANCHOR);
    expect(Math.abs(anchor.y - ZOOM_WALL_ANCHOR_Y)).toBeLessThan(1);
    expect(px(0, 2 * TILE_D, -(WALL_D + TILE_H / 2)).y).toBeGreaterThan(PORTRAIT_STRIP_TOP - 6);
    expect(px(0, TILE_D, -7.6).y).toBeGreaterThan(PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H + 2);
    // The near wall's front edge leaves ≥ 60 px of free felt above the
    // held hand for the zoom-mode toast slot.
    const nearWallBottom = px(0, 0, WALL_D + TILE_H / 2).y;
    expect(heldHandTopPx(w, h) - PORTRAIT_BAND_GAP - nearWallBottom).toBeGreaterThanOrEqual(60);
    // Same elevation as the full view, so the held hand only translates.
    const full = cameraFor(w, h);
    const elev = (p: typeof preset) =>
      Math.atan2(p.position[1] - p.target[1], p.position[2] - p.target[2]);
    expect(elev(preset)).toBeCloseTo(elev(full), 5);
    // The held hand's ray still misses the table.
    const f = heldHandFrameFor(preset, w, h);
    const dir = new Vector3(...f.origin).sub(cam.position).normalize();
    const t = -cam.position.y / dir.y;
    expect(cam.position.z + dir.z * t).toBeGreaterThan(14);
  });
  test('landscape hand tiles meet the 44 px touch guideline', () => {
    const w = 915;
    const h = 412;
    const preset = cameraFor(w, h);
    const cam = new PerspectiveCamera(preset.fov, w / h, 0.1, 200);
    cam.position.set(...preset.position);
    cam.lookAt(...preset.target);
    cam.updateMatrixWorld();
    const px = (x: number, y: number, z: number) => {
      const p = new Vector3(x, y, z).project(cam);
      return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
    };
    expect(px(1, STAND_Y, OWN_HAND_Z).x - px(0, STAND_Y, OWN_HAND_Z).x).toBeGreaterThanOrEqual(44);
    // Hand bottom edge sits at (or a few px into) the footer row's top.
    expect(px(0, 0, OWN_HAND_Z + TILE_D / 2).y).toBeLessThan(h - 12 - 44 + 10);
    // Far wall's top edge below the chrome-row toast slot (6 + ~48 px);
    // side rows inside the viewport.
    expect(px(0, 2 * TILE_D, -(WALL_D + TILE_H / 2)).y).toBeGreaterThanOrEqual(50);
    expect(px(-PORTRAIT_X_HALF, 0, 0).x).toBeGreaterThan(0);
    // Free-felt band between a one-row river and the near wall's top
    // edge is tall enough for the dense claim strip (~58 px).
    const riverRow1Bottom = px(0, TILE_D, 2.6 + TILE_H / 2).y;
    const nearWallTop = px(0, 2 * TILE_D, WALL_D - TILE_H / 2).y;
    expect(nearWallTop - riverRow1Bottom).toBeGreaterThanOrEqual(58);
  });
  test('projectPreset matches three.js projection and anchored presets pin their point', () => {
    for (const [w, h] of [
      [412, 915],
      [915, 412],
      [1440, 900],
    ] as const) {
      const preset = cameraFor(w, h);
      for (const pt of [
        [0, 0, 0],
        [7.9, STAND_Y, OWN_HAND_Z],
        [-8.8, 1.2, -3.3],
      ] as const) {
        const v = ndc(preset, w, h, [pt[0], pt[1], pt[2]]);
        const q = projectPreset(preset, w, h, pt);
        expect(q.x).toBeCloseTo((v.x * 0.5 + 0.5) * w, 3);
        expect(q.y).toBeCloseTo((-v.y * 0.5 + 0.5) * h, 3);
      }
    }
    const anchored = portraitCameraAnchored(412, 915, 7.9, [0, 1.24, -8.12], 300);
    expect(Math.abs(projectPreset(anchored, 412, 915, [0, 1.24, -8.12]).y - 300)).toBeLessThan(
      0.01,
    );
    // Same scale + elevation as the centred portrait preset.
    const centred = portraitCameraFor(412, 915, 100, 700, 7.9);
    expect(anchored.position[1]).toBeCloseTo(centred.position[1], 6);
    expect(anchored.position[2] - anchored.target[2]).toBeCloseTo(
      centred.position[2] - centred.target[2],
      6,
    );
  });
});
