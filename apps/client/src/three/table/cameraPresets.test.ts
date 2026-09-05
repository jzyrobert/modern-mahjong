import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { TILE_D, TILE_H } from '../tiles/geometry';
import {
  DICE_LESSON_GAP,
  HELD_BOTTOM_PX,
  LANDSCAPE_ZOOM_ELEV_DEG,
  LANDSCAPE_ZOOM_HALF,
  LANDSCAPE_ZOOM_NEAR_POINT,
  PORTRAIT_APRON_MIN,
  PORTRAIT_BAND_BIAS,
  PORTRAIT_BAND_GAP,
  PORTRAIT_BAND_TOP,
  PORTRAIT_DICE_REGULAR_H,
  PORTRAIT_ELEV_DEG,
  PORTRAIT_ELEV_MIN_DEG,
  PORTRAIT_FAR_RAIL_GAP,
  PORTRAIT_FAR_RAIL_POINT,
  PORTRAIT_RIVER_SCALE,
  PORTRAIT_STRIP_H,
  PORTRAIT_STRIP_TOP,
  PORTRAIT_X_HALF,
  RESULT_PANEL_H_ESTIMATE,
  TABLE_CAMERA,
  ZOOM_ELEV_DEG,
  ZOOM_FAR_RIVER_GAP,
  ZOOM_FAR_RIVER_POINT,
  ZOOM_FAR_RIVER_Y,
  ZOOM_HEADER_BOTTOM,
  ZOOM_NEAR_RIVER_GAP,
  ZOOM_NEAR_RIVER_POINT,
  ZOOM_X_HALF_MIN,
  cameraFor,
  classifyViewport,
  diceLessonCardH,
  heldHandFrameFor,
  heldHandParkedBaseline,
  heldHandTilePx,
  heldHandTopPx,
  landscapeZoomCameraFor,
  portraitCameraAnchored,
  portraitCameraFor,
  portraitDiceBandShort,
  portraitDiceDenseH,
  portraitDiceLessonTop,
  portraitElevationFor,
  portraitMetrics,
  projectPreset,
  resultCaptionNeed,
  resultPanelPinsTop,
  riverZoomCameraFor,
  riverZoomFrameFor,
  sheetCameraFor,
} from './cameraPresets';
import {
  FELT_HALF,
  HAND_Z,
  MELD_Z,
  OWN_HAND_Z,
  RAIL_WIDTH,
  STAND_Y,
  WALL_D,
  riverMetrics,
} from './layout';

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
    // Portrait keeps the centred fit's scale + elevation and only pans
    // (toward +z: table up) to pin the far rail under the seat strip.
    const fit = portraitCameraFor(
      360,
      800,
      PORTRAIT_BAND_TOP,
      heldHandTopPx(360, 800) - PORTRAIT_BAND_GAP,
    );
    const got = cameraFor(360, 800);
    expect(got.fov).toBe(fit.fov);
    expect(got.position[1]).toBeCloseTo(fit.position[1], 6);
    expect(got.position[2] - got.target[2]).toBeCloseTo(fit.position[2] - fit.target[2], 6);
    expect(got.target[2]).toBeGreaterThanOrEqual(fit.target[2] - 1e-6);
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

describe('cameraFor with a degenerate host', () => {
  test('a 0×0 or NaN measurement still yields a finite preset', () => {
    for (const [w, h] of [
      [0, 0],
      [1, 915],
      [Number.NaN, Number.NaN],
    ] as const) {
      const p = cameraFor(w, h);
      expect(p.position.every(Number.isFinite)).toBe(true);
      expect(p.target.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(p.fov)).toBe(true);
    }
  });
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
      // while the rails (|x| = 13) crop off-screen (a short phone zooms
      // out a little so the rail never runs under the hand — see
      // `cameraFor`).
      expect(px(PORTRAIT_X_HALF, 0, 0).x).toBeLessThanOrEqual(w + 1);
      expect(px(-PORTRAIT_X_HALF, 0, 0).x).toBeGreaterThanOrEqual(-1);
      if (h >= 900) expect(px(13, 0, 0).x).toBeGreaterThan(w);
      // The far rail's top edge is pinned PORTRAIT_FAR_RAIL_GAP under the
      // seat strip whenever the table leaves slack in the band (the
      // 412 / 430 px phones); a short phone whose table fills the band
      // keeps the centred fit, which never lifts the rail *above* the
      // pinned line. The table never sits lower than the centred fit.
      const bandTop = PORTRAIT_BAND_TOP;
      const bandBottom = heldHandTopPx(w, h) - PORTRAIT_BAND_GAP;
      const centreY = bandTop + PORTRAIT_BAND_BIAS * (bandBottom - bandTop);
      const railY = PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H + PORTRAIT_FAR_RAIL_GAP;
      const farRail = px(...PORTRAIT_FAR_RAIL_POINT).y;
      const nearRailBottom = px(0, 0, FELT_HALF + RAIL_WIDTH).y;
      // Pinned whenever pinning leaves the minimum apron; otherwise the
      // table is height-bound and sits as low as the apron allows.
      const pinned = Math.abs(farRail - railY) < 1;
      const heightBound = nearRailBottom > bandBottom - PORTRAIT_APRON_MIN - 1;
      expect(pinned || heightBound).toBe(true);
      if (w === 412) expect(pinned).toBe(true);
      expect(farRail).toBeGreaterThan(bandTop - PORTRAIT_STRIP_H);
      // The table centre lands inside the band (the pinned view sits a
      // little below the centred fit by design — the apron closes).
      expect(px(0, 0, 0).y).toBeGreaterThan(bandTop);
      expect(px(0, 0, 0).y).toBeLessThan(centreY + 40);
      // The near rail's bottom edge stays clear of the held hand, and on
      // the reference phone the apron between them is a deliberate
      // 24–44 px (contact shadow + breathing room), not a void band.
      expect(nearRailBottom).toBeLessThan(bandBottom);
      if (w === 412) {
        const apron = heldHandTopPx(w, h) - nearRailBottom;
        expect(apron).toBeGreaterThanOrEqual(24);
        expect(apron).toBeLessThanOrEqual(44);
      }
      // Far row below the seat strip, near row above the held hand.
      expect(px(0, 0, -HAND_Z - 0.7).y).toBeGreaterThan(bandTop);
      expect(px(0, 0, HAND_Z + 0.7).y).toBeLessThan(bandBottom);
      // A river tile (drawn at PORTRAIT_RIVER_SCALE) is at least 22 CSS px
      // wide on a 412 px phone — readable, not guessable.
      if (w === 412)
        expect((px(1, 0.3, 0).x - px(0, 0.3, 0).x) * PORTRAIT_RIVER_SCALE).toBeGreaterThanOrEqual(
          22,
        );
      // The side seats' flat melds (in the rack line at MELD_Z, reaching
      // a flat tile's half-height further out) stay inside the viewport
      // at their nearest corner, where perspective scale is largest
      // (round-3: the left meld was half-clipped at ±11.2).
      const meldNear = px(-(MELD_Z + TILE_H / 2), TILE_D, 8.0);
      expect(meldNear.x).toBeGreaterThanOrEqual(2);
      const handNear = px(-(HAND_Z + TILE_D / 2), 0, 7.5);
      expect(handNear.x).toBeGreaterThanOrEqual(6);
    }
  });
  test('river zoom is an 84° plan view over the four rivers, header to held hand', () => {
    // Round-FB4: "zooming into the table should present a more top-down
    // close-up view of the discard tiles". Every phone gets the same
    // view; only the distance gives ground (see the short-phone suite).
    const farEdge = riverMetrics(PORTRAIT_RIVER_SCALE).farEdge;
    for (const [w, h] of [
      [412, 915],
      [412, 700],
      [360, 640],
    ] as const) {
      const { preset, xHalf } = riverZoomFrameFor(w, h);
      expect(riverZoomCameraFor(w, h)).toEqual(preset);
      const cam = new PerspectiveCamera(preset.fov, w / h, 0.1, 200);
      cam.position.set(...preset.position);
      cam.lookAt(...preset.target);
      cam.updateMatrixWorld();
      const px = (x: number, y: number, z: number) => {
        const p = new Vector3(x, y, z).project(cam);
        return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
      };
      const elev = Math.atan2(
        preset.position[1] - preset.target[1],
        preset.position[2] - preset.target[2],
      );
      expect((elev * 180) / Math.PI).toBeCloseTo(ZOOM_ELEV_DEG, 4);
      // The far river's last row sits just under the zoom header (its top
      // face a px or two higher than its felt edge, never under the glass
      // by more than the gap), the far seat's rack behind the glass.
      expect(Math.abs(px(...ZOOM_FAR_RIVER_POINT).y - ZOOM_FAR_RIVER_Y)).toBeLessThan(1);
      expect(px(0, TILE_D, -farEdge).y).toBeGreaterThan(ZOOM_HEADER_BOTTOM - 3);
      expect(px(0, TILE_H, -HAND_Z).y).toBeLessThan(ZOOM_HEADER_BOTTOM - 20);
      // The near river's last row clears the held hand's band.
      const bandBottom = heldHandTopPx(w, h) - PORTRAIT_BAND_GAP;
      expect(px(...ZOOM_NEAR_RIVER_POINT).y).toBeLessThanOrEqual(
        bandBottom - ZOOM_NEAR_RIVER_GAP + 0.5,
      );
      // The side rivers' outer corners (nearest the camera, so the widest
      // projection) stay inside the viewport with a little felt.
      expect(px(farEdge, TILE_D, farEdge).x).toBeLessThanOrEqual(w - 4);
      expect(px(-farEdge, TILE_D, farEdge).x).toBeGreaterThanOrEqual(4);
      expect(xHalf).toBeGreaterThanOrEqual(ZOOM_X_HALF_MIN - 1e-9);
      // Face-on glyphs: a river tile projects at ≥ 0.97 of its 1.36 : 1
      // proportions (sin 84° ≈ 0.99 less a little perspective; the resting
      // 50–70° views foreshorten to 0.77–0.94).
      const tileW = px(1, TILE_D, 0).x - px(0, TILE_D, 0).x;
      const tileH = px(0, TILE_D, TILE_H / 2).y - px(0, TILE_D, -TILE_H / 2).y;
      expect(tileH / tileW).toBeGreaterThanOrEqual(TILE_H * 0.97);
      // The held hand's ray still misses the table, and the hand stays
      // behind the key light so it casts nothing onto the felt.
      const f = heldHandFrameFor(preset, w, h);
      const dir = new Vector3(...f.origin).sub(cam.position).normalize();
      const t = -cam.position.y / dir.y;
      expect(cam.position.z + dir.z * t).toBeGreaterThan(14);
      const light = new Vector3(7, 18, 9);
      const depth = new Vector3(...f.origin).sub(light).dot(light.clone().normalize().negate());
      expect(depth).toBeLessThan(4);
    }
    // The tall phone takes the tight frame: ≈ 33 px river tiles, 1.4× the
    // resting view (the round-4 frame at 70° gave 33.5 px at 0.94 height).
    const tall = riverZoomFrameFor(412, 915);
    expect(tall.xHalf).toBeCloseTo(ZOOM_X_HALF_MIN, 9);
    const tile = (p: ReturnType<typeof cameraFor>) =>
      (projectPreset(p, 412, 915, [1, 0.3, 0]).x - projectPreset(p, 412, 915, [0, 0.3, 0]).x) *
      PORTRAIT_RIVER_SCALE;
    expect(tile(tall.preset)).toBeGreaterThanOrEqual(32);
    expect(tile(tall.preset) / tile(cameraFor(412, 915))).toBeGreaterThanOrEqual(1.4);
    // Header geometry the solve assumes matches the shell's zoom bar.
    expect(ZOOM_HEADER_BOTTOM).toBe(PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H + 6);
    expect(ZOOM_FAR_RIVER_Y).toBe(ZOOM_HEADER_BOTTOM + ZOOM_FAR_RIVER_GAP);
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
  test('landscape river zoom frames the river block between the chrome and the footer at 62°', () => {
    const w = 915;
    const h = 412;
    const yTop = 8 + 38 + 6;
    const yBottom = h + 3;
    const preset = landscapeZoomCameraFor(w, h, yTop, yBottom);
    const cam = new PerspectiveCamera(preset.fov, w / h, 0.1, 200);
    cam.position.set(...preset.position);
    cam.lookAt(...preset.target);
    cam.updateMatrixWorld();
    const px = (x: number, y: number, z: number) => {
      const p = new Vector3(x, y, z).project(cam);
      return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
    };
    const elev = Math.atan2(
      preset.position[1] - preset.target[1],
      preset.position[2] - preset.target[2],
    );
    expect((elev * 180) / Math.PI).toBeCloseTo(LANDSCAPE_ZOOM_ELEV_DEG, 4);
    // The block's far edge lands under the chrome; the near wall's inner
    // top edge just off the bottom, so the footer pills sit on felt …
    expect(Math.abs(px(0, TILE_D / 2, -LANDSCAPE_ZOOM_HALF).y - yTop)).toBeLessThan(1);
    expect(Math.abs(px(...LANDSCAPE_ZOOM_NEAR_POINT).y - yBottom)).toBeLessThan(1);
    // (the rivers' third-row far edge at 1× is 6.38 — see `riverMetrics`).
    const footerTop = h - 5 - 40;
    expect(px(0, TILE_D, 6.4).y).toBeLessThan(footerTop);
    // … the block fits the width with room, and a river tile is ≥ 25 px
    // wide and ≥ 18 px tall (vs ~20 × 8 from the resting 31° camera).
    expect(px(-LANDSCAPE_ZOOM_HALF, 0, 0).x).toBeGreaterThan(40);
    expect(px(1, TILE_D, 0).x - px(0, TILE_D, 0).x).toBeGreaterThanOrEqual(25);
    expect(px(0, TILE_D, TILE_H / 2).y - px(0, TILE_D, -TILE_H / 2).y).toBeGreaterThanOrEqual(18);
    // The hand row leaves the frame below the footer; the far wall's
    // top edge sits above the chrome row's bottom.
    expect(px(0, STAND_Y, OWN_HAND_Z).y).toBeGreaterThan(h);
    expect(px(0, 2 * TILE_D, -(WALL_D - TILE_H / 2)).y).toBeLessThan(yTop);
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

describe('short phones (a phone in a browser)', () => {
  // 1080×1830 device px of browser viewport ≈ 412×700 CSS px; 360×640 is
  // the budget-phone floor. The tall 412×915 is the installed / fullscreen case.
  const px = (preset: ReturnType<typeof cameraFor>, w: number, h: number) => {
    const cam = new PerspectiveCamera(preset.fov, w / h, 0.1, 200);
    cam.position.set(...preset.position);
    cam.lookAt(...preset.target);
    cam.updateMatrixWorld();
    return (x: number, y: number, z: number) => {
      const p = new Vector3(x, y, z).project(cam);
      return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
    };
  };
  test('HUD metrics taper from the tall to the short values and stay whole px', () => {
    const tall = portraitMetrics(915);
    expect(tall).toEqual({
      trayH: 96,
      trayGap: 10,
      heldBottom: HELD_BOTTOM_PX,
      rowGap: 0.55,
      tileMax: 68,
    });
    const short = portraitMetrics(700);
    expect(short.trayH).toBe(84);
    expect(short.trayGap).toBe(8);
    expect(short.heldBottom).toBe(12 + 44 + 8 + 84 + 8);
    expect(short.rowGap).toBeCloseTo(0.3, 6);
    expect(short.tileMax).toBe(46);
    expect(portraitMetrics(640)).toEqual(short);
    const mid = portraitMetrics(780);
    expect(mid.trayH).toBeGreaterThan(84);
    expect(mid.trayH).toBeLessThan(96);
    expect(Number.isInteger(mid.trayH)).toBe(true);
    expect(portraitMetrics(Number.NaN)).toEqual(tall);
  });
  test('the camera pitches down instead of shrinking the table: rails flush, no void column', () => {
    for (const [w, h] of [
      [412, 700],
      [360, 640],
      [412, 780],
    ] as const) {
      const preset = cameraFor(w, h);
      const p = px(preset, w, h);
      const elev = portraitElevationFor(w, h);
      expect(elev).toBeGreaterThanOrEqual(PORTRAIT_ELEV_MIN_DEG);
      expect(elev).toBeLessThan(PORTRAIT_ELEV_DEG);
      const elevOf = Math.atan2(
        preset.position[1] - preset.target[1],
        preset.position[2] - preset.target[2],
      );
      expect((elevOf * 180) / Math.PI).toBeCloseTo(elev, 4);
      // The near rail's corners sit within 2 px of the viewport edges —
      // the table fills the width edge to edge, neither cropped nor
      // floating in a void column.
      const cornerR = p(FELT_HALF + RAIL_WIDTH, 0.55, FELT_HALF + RAIL_WIDTH).x;
      const cornerL = p(-(FELT_HALF + RAIL_WIDTH), 0.55, FELT_HALF + RAIL_WIDTH).x;
      expect(cornerR).toBeGreaterThanOrEqual(w - 3);
      expect(cornerR).toBeLessThanOrEqual(w + 3);
      expect(cornerL).toBeLessThanOrEqual(3);
      expect(cornerL).toBeGreaterThanOrEqual(-3);
      // Far rail below the seat strip's band top, near rail's bottom
      // above the held hand by the apron, four walls in between.
      const bandTop = PORTRAIT_BAND_TOP;
      const handTop = heldHandTopPx(w, h);
      expect(p(...PORTRAIT_FAR_RAIL_POINT).y).toBeGreaterThanOrEqual(bandTop - 1);
      const nearRailBottom = p(0, 0, FELT_HALF + RAIL_WIDTH).y;
      expect(nearRailBottom).toBeLessThanOrEqual(
        handTop - PORTRAIT_BAND_GAP - PORTRAIT_APRON_MIN + 1,
      );
      expect(p(0, 2 * TILE_D, WALL_D + TILE_H / 2).y).toBeLessThan(nearRailBottom);
      expect(p(0, 2 * TILE_D, -(WALL_D + TILE_H / 2)).y).toBeGreaterThan(bandTop);
      // The side seats' melds keep their nearest corner inside the frame.
      expect(p(-(MELD_Z + TILE_H / 2), TILE_D, 8.0).x).toBeGreaterThanOrEqual(2);
      // Held hand: ≥ 44 px wide (so ≥ 59 px tall) tiles, two rows above the tray.
      const tile = heldHandTilePx(w, h);
      expect(tile).toBeGreaterThanOrEqual(44);
      expect(tile * TILE_H).toBeGreaterThanOrEqual(40);
      expect(handTop).toBeGreaterThan(bandTop);
      expect(handTop + (2 * TILE_H + portraitMetrics(h).rowGap) * tile).toBeLessThanOrEqual(
        h - portraitMetrics(h).heldBottom + 1,
      );
    }
    // A river tile still reads on the reference short phone.
    const p = px(cameraFor(412, 700), 412, 700);
    expect((p(1, 0.3, 0).x - p(0, 0.3, 0).x) * PORTRAIT_RIVER_SCALE).toBeGreaterThanOrEqual(18);
  });
  test('the tall phone keeps the 70° width-bound view unchanged', () => {
    expect(portraitElevationFor(412, 915)).toBe(PORTRAIT_ELEV_DEG);
    expect(portraitElevationFor(430, 932)).toBe(PORTRAIT_ELEV_DEG);
    expect(heldHandTilePx(412, 915)).toBeCloseTo(heldHandTilePx(412), 6);
    expect(heldHandTopPx(412, 915)).toBeCloseTo(
      915 - HELD_BOTTOM_PX - (2 * TILE_H + 0.55) * heldHandTilePx(412),
      6,
    );
  });
  test('the river zoom backs off on short phones until the block clears the held hand', () => {
    // A plan view of the ±7.92 block is ~395 px tall at the tight scale;
    // a phone in a browser has ~290 px between the zoom header and the
    // hand, so the zoom is height-bound there: same 84° view, farther.
    for (const [w, h, minTile, minRatio] of [
      [412, 700, 25, 1.3],
      [360, 640, 20, 1.2],
    ] as const) {
      const { preset: zoom, xHalf } = riverZoomFrameFor(w, h);
      const p = px(zoom, w, h);
      const bandBottom = heldHandTopPx(w, h) - PORTRAIT_BAND_GAP;
      expect(xHalf).toBeGreaterThan(ZOOM_X_HALF_MIN + 1);
      // Height-bound: the near river's last row sits exactly at the gap.
      expect(
        Math.abs(p(...ZOOM_NEAR_RIVER_POINT).y - (bandBottom - ZOOM_NEAR_RIVER_GAP)),
      ).toBeLessThan(1);
      expect(Math.abs(p(...ZOOM_FAR_RIVER_POINT).y - ZOOM_FAR_RIVER_Y)).toBeLessThan(1);
      // Still a zoom, and face-on: a river tile grows over the resting view
      // and keeps its upright proportions where the resting 50–55° view
      // foreshortened it.
      const full = px(cameraFor(w, h), w, h);
      const tileZoom = (p(1, 0.3, 0).x - p(0, 0.3, 0).x) * PORTRAIT_RIVER_SCALE;
      const tileFull = (full(1, 0.3, 0).x - full(0, 0.3, 0).x) * PORTRAIT_RIVER_SCALE;
      expect(tileZoom).toBeGreaterThanOrEqual(minTile);
      expect(tileZoom / tileFull).toBeGreaterThanOrEqual(minRatio);
      // Why the shell lays out no wall while zoomed: the near wall's outer
      // edge would land inside the held hand's band (round-5's regression
      // — stacks between the hand's rows); keeping it above the band at
      // 84° would leave ~1.2× (see `riverZoomFrameFor`).
      expect(p(0, 0, WALL_D + TILE_H / 2).y).toBeGreaterThan(bandBottom);
    }
  });
});

describe('short-phone opening-dice step', () => {
  test('the dice band is short on a phone in a browser and tall on the fullscreen phone', () => {
    expect(portraitDiceBandShort(412, 700)).toBe(true);
    expect(portraitDiceBandShort(360, 640)).toBe(true);
    expect(portraitDiceBandShort(412, 915)).toBe(false);
    // The predicate is the band test the dice card uses for its dense layout.
    const band = heldHandTopPx(412, 915) - (PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H);
    expect(band).toBeGreaterThanOrEqual(PORTRAIT_DICE_REGULAR_H + 16);
  });
  test('the dice card + lesson card pair is centred in the band under the strip', () => {
    const strip = PORTRAIT_STRIP_TOP + PORTRAIT_STRIP_H;
    // A phone in a browser: ~120 px of slack splits above the dice card
    // and below the caption instead of piling up under a top-pinned stack.
    const top = portraitDiceLessonTop(412, 700);
    const pair = portraitDiceDenseH(412) + DICE_LESSON_GAP + diceLessonCardH(412);
    const above = top - strip;
    const below = 700 - (top + pair);
    expect(above).toBeGreaterThan(40);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
    // The measured card height replaces the estimate.
    expect(portraitDiceLessonTop(412, 700, 0, portraitDiceDenseH(412) + 20)).toBe(top - 10);
    // A 360×640 phone's band is filled by the pair: the card stays 4 px
    // under the strip (the round-6 pinned-top layout).
    expect(portraitDiceLessonTop(360, 640)).toBe(strip + 4);
    // The device inset moves the strip and the card with it.
    expect(portraitDiceLessonTop(412, 700, 24)).toBe(top + 12);
  });
  test('the parked hand lies wholly below the viewport from the same preset', () => {
    for (const [w, h] of [
      [412, 700],
      [360, 640],
    ] as const) {
      const preset = cameraFor(w, h);
      const parked = heldHandFrameFor(preset, w, h, heldHandParkedBaseline(w, h));
      const held = heldHandFrameFor(preset, w, h);
      // Same plane, same scale and lean — only the baseline moves.
      expect(parked.pxPerUnit).toBeCloseTo(held.pxPerUnit, 6);
      expect(parked.rowPitch).toBeCloseTo(held.rowPitch, 6);
      expect(parked.right).toEqual(held.right);
      // The block's top row's top edge projects below the bottom edge.
      const tile = heldHandTilePx(w, h);
      const blockPx = (2 * TILE_H + portraitMetrics(h).rowGap) * tile;
      expect(heldHandParkedBaseline(w, h) - blockPx).toBeGreaterThanOrEqual(h + 24);
    }
  });
});

describe('portrait result card pin (hud/ResultVeil)', () => {
  test('bottom-pinned where a caption fits above; top-pinned on short, narrow phones', () => {
    // 412×700 phone in a browser: a ~313 px card leaves 363 px above ≥ 298.
    expect(resultPanelPinsTop(412, 700, 313)).toBe(false);
    expect(resultPanelPinsTop(412, 915, 313)).toBe(false);
    // 360×640 budget phone: a 349 px card leaves 267 px < 342 (seven body lines).
    expect(resultPanelPinsTop(360, 640, 349)).toBe(true);
    // Before the card is measured the estimate decides the same way.
    expect(resultPanelPinsTop(360, 640, null)).toBe(true);
    expect(resultPanelPinsTop(412, 700, null)).toBe(false);
    expect(RESULT_PANEL_H_ESTIMATE).toBeGreaterThan(300);
    expect(resultCaptionNeed(360)).toBeGreaterThan(resultCaptionNeed(412));
  });
});
