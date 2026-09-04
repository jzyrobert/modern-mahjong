import { TOTAL_TILES } from '@mahjong/game-logic';
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, test } from 'vitest';
import { TILE_D } from '../../tiles/geometry';
import { FELT_HALF, RAIL_H, RAIL_WIDTH, STACKS_PER_WALL, WALL_D, computeLayout } from '../layout';
import { LOBBY_PORTRAIT_ELEV_DEG, lobbyCameraFor, waitingTableState } from './LobbyTableBackdrop';

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
  test('portrait lobby camera: whole table across the width, near rail at the bottom, 58°', () => {
    for (const [w, h] of [
      [412, 915],
      [360, 780],
    ] as const) {
      const p = lobbyCameraFor(w, h, false);
      const elev = Math.atan2(p.position[1] - p.target[1], p.position[2] - p.target[2]);
      expect((elev * 180) / Math.PI).toBeCloseTo(LOBBY_PORTRAIT_ELEV_DEG, 4);
      const outer = FELT_HALF + RAIL_WIDTH;
      // Near rail's outer edge just above the bottom; its corners inside.
      expect(Math.abs(px(p, w, h, new Vector3(0, 0, outer)).y - (h - 10))).toBeLessThan(1);
      expect(px(p, w, h, new Vector3(outer, RAIL_H, outer)).x).toBeLessThanOrEqual(w - 7);
      expect(px(p, w, h, new Vector3(-outer, RAIL_H, outer)).x).toBeGreaterThanOrEqual(7);
      // The near wall's stacks sit whole above the rail, under 20 px a back
      // (round-4: 50 px slabs), with the plate well up the screen.
      const backW =
        px(p, w, h, new Vector3(1, 2 * TILE_D, WALL_D)).x -
        px(p, w, h, new Vector3(0, 2 * TILE_D, WALL_D)).x;
      expect(backW).toBeLessThan(20);
      expect(backW).toBeGreaterThan(12);
      expect(px(p, w, h, new Vector3(0, 0, 0)).y).toBeLessThan(h * 0.8);
    }
  });
});
