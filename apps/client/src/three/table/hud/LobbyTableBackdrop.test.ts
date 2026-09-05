import { TOTAL_TILES } from '@mahjong/game-logic';
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { TILE_D, TILE_H } from '../../tiles/geometry';
import { FELT_HALF, RAIL_H, RAIL_WIDTH, STACKS_PER_WALL, WALL_D, computeLayout } from '../layout';
import {
  LOBBY_LANDSCAPE_FELT_BAND,
  LOBBY_LANDSCAPE_WALL_POINT,
  LOBBY_LANDSCAPE_WALL_PX,
  LOBBY_PORTRAIT_ELEV_DEG,
  LOBBY_PORTRAIT_FELT_BAND,
  LOBBY_PORTRAIT_WALL_PX,
  LOBBY_WALL_POINT,
  lobbyCameraFor,
  waitingTableState,
} from './LobbyTableBackdrop';

const OPTS = { sortMode: 'suit' as const, manualOrder: [], drawnTileId: null, reveal: false };

function px(preset: ReturnType<typeof lobbyCameraFor>, w: number, h: number, p: Vector3) {
  const cam = new PerspectiveCamera(preset.fov, w / h, 0.1, 200);
  cam.position.set(...preset.position);
  cam.lookAt(...preset.target);
  cam.updateMatrixWorld();
  const v = p.clone().project(cam);
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
}

describe('waiting table', () => {
  test('every tile sits in one of four full walls; no racks, no dead wall', () => {
    const st = waitingTableState();
    expect(st.wall).toHaveLength(TOTAL_TILES);
    expect(st.deadWall).toHaveLength(0);
    for (const seat of [0, 1, 2, 3] as const) expect(st.hands[seat]).toHaveLength(0);
    const layout = computeLayout(st, 0, { ...OPTS, waitingWalls: true });
    const walls = layout.filter((sl) => sl?.zone === 'wall');
    expect(walls).toHaveLength(TOTAL_TILES);
    for (const seat of [0, 1, 2, 3] as const)
      expect(walls.filter((sl) => sl!.seat === seat)).toHaveLength(2 * STACKS_PER_WALL);
    expect(layout.some((sl) => sl?.zone === 'oppHand' || sl?.zone === 'hand')).toBe(false);
  });
  test('portrait lobby camera: whole table across the width, near wall at the bottom, 58°', () => {
    for (const [w, h] of [
      [412, 915],
      [412, 700],
      [360, 640],
    ] as const) {
      const p = lobbyCameraFor(w, h, false);
      const elev = Math.atan2(p.position[1] - p.target[1], p.position[2] - p.target[2]);
      expect((elev * 180) / Math.PI).toBeCloseTo(LOBBY_PORTRAIT_ELEV_DEG, 4);
      const outer = FELT_HALF + RAIL_WIDTH;
      // Near wall's outer bottom edge just above the bottom, its front
      // faces and tops inside the felt band the glass stack leaves free
      // (round-6: the rail-anchored view showed only rail under a
      // full-height card stack); the rail corners inside the width.
      const wallBottom = px(p, w, h, new Vector3(...LOBBY_WALL_POINT)).y;
      expect(Math.abs(wallBottom - (h - LOBBY_PORTRAIT_WALL_PX))).toBeLessThan(1);
      const wallTop = px(p, w, h, new Vector3(0, 2 * TILE_D, WALL_D - TILE_H / 2)).y;
      expect(wallTop).toBeGreaterThan(h - LOBBY_PORTRAIT_FELT_BAND + 8);
      expect(wallBottom - wallTop).toBeGreaterThanOrEqual(20);
      expect(px(p, w, h, new Vector3(outer, RAIL_H, outer)).x).toBeLessThanOrEqual(w - 7);
      expect(px(p, w, h, new Vector3(-outer, RAIL_H, outer)).x).toBeGreaterThanOrEqual(7);
      // The near wall's stacks sit whole above the rail, under 20 px a back
      // (round-4: 50 px slabs), with the plate well up the screen.
      const backW =
        px(p, w, h, new Vector3(1, 2 * TILE_D, WALL_D)).x -
        px(p, w, h, new Vector3(0, 2 * TILE_D, WALL_D)).x;
      expect(backW).toBeLessThan(20);
      expect(backW).toBeGreaterThan(12);
      // The plate sits behind the glass panel, above the felt band.
      expect(px(p, w, h, new Vector3(0, 0, 0)).y).toBeLessThan(h - LOBBY_PORTRAIT_FELT_BAND);
    }
  });
  test('phone-landscape lobby camera: the near wall row fills the felt band under the panel', () => {
    for (const [w, h] of [
      [915, 412],
      [740, 360],
    ] as const) {
      const p = lobbyCameraFor(w, h, false);
      // Same perspective as the wide preset ([0, 14.5, 27] → [0, 0, 1.5]):
      // only the pan differs.
      expect(p.position[1]).toBe(14.5);
      expect(p.position[2] - p.target[2]).toBeCloseTo(27 - 1.5, 6);
      // The near wall's outer bottom edge sits just above the bottom …
      const wallBottom = px(p, w, h, new Vector3(...LOBBY_LANDSCAPE_WALL_POINT)).y;
      expect(Math.abs(wallBottom - (h - LOBBY_LANDSCAPE_WALL_PX))).toBeLessThan(1);
      // … and its front faces + tops land inside the band the glass
      // panel leaves free, so the band reads as a row of stacks on felt.
      const bandTop = h - LOBBY_LANDSCAPE_FELT_BAND;
      const wallFrontTop = px(p, w, h, new Vector3(0, 2 * TILE_D, WALL_D + 0.68)).y;
      expect(wallFrontTop).toBeGreaterThan(bandTop + 8);
      expect(wallBottom - wallFrontTop).toBeGreaterThanOrEqual(20);
      // Felt shows beyond the wall's ends (17 stacks ≈ 17.5 units of the
      // 23.8-unit felt), inside the viewport's width.
      expect(px(p, w, h, new Vector3(9.2, 0, WALL_D)).x).toBeLessThan(w - 40);
      expect(px(p, w, h, new Vector3(-FELT_HALF, 0, WALL_D)).x).toBeGreaterThan(-40);
      // The rail sits below the frame; the plate well up behind the panel.
      expect(px(p, w, h, new Vector3(0, RAIL_H, FELT_HALF + RAIL_WIDTH)).y).toBeGreaterThan(h);
      expect(px(p, w, h, new Vector3(0, 0, 0)).y).toBeLessThan(bandTop);
    }
    // Tall wide viewports (small desktops) keep the un-panned preset.
    expect(lobbyCameraFor(1024, 700, false)).toEqual({
      position: [0, 14.5, 27],
      target: [0, 0, 1.5],
      fov: 40,
    });
  });
});
