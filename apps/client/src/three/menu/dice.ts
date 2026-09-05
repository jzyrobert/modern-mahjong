import {
  type BufferGeometry,
  CanvasTexture,
  Color,
  InstancedMesh,
  LinearMipmapLinearFilter,
  MeshPhysicalMaterial,
  SRGBColorSpace,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DIE_SIZE } from './layout';

/**
 * Procedural dice for the menu hero (asset policy §5 — nothing is
 * downloaded). One rounded-box geometry whose per-face UVs are remapped
 * onto a 3 × 2 pip atlas drawn on a canvas, so both dice render as a
 * single InstancedMesh draw call with one material.
 */
export { DIE_SIZE };
export const DICE_ATLAS_COLS = 3;
export const DICE_ATLAS_ROWS = 2;
const CELL = 128;

/** Face order of `BoxGeometry` (and therefore RoundedBoxGeometry):
 *  +x, −x, +y, −y, +z, −z. Opposite faces sum to seven. */
export const DIE_FACE_VALUES: readonly number[] = [1, 6, 2, 5, 3, 4];

export function diceCellFor(value: number): [number, number] {
  const idx = value - 1;
  return [idx % DICE_ATLAS_COLS, Math.floor(idx / DICE_ATLAS_COLS)];
}

/** Pip positions per value in a unit square (0..1). */
export const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.26, 0.26],
    [0.5, 0.5],
    [0.74, 0.74],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  6: [
    [0.3, 0.24],
    [0.7, 0.24],
    [0.3, 0.5],
    [0.7, 0.5],
    [0.3, 0.76],
    [0.7, 0.76],
  ],
};

/**
 * Remap a BoxGeometry-derived geometry's per-face 0..1 UVs into atlas
 * cells. Vertices are laid out face-by-face in `BoxGeometry` order, so
 * face index = vertexIndex / verticesPerFace. Returns the same geometry.
 */
export function remapDiceUvs(geo: BufferGeometry): BufferGeometry {
  const uv = geo.getAttribute('uv');
  const perFace = uv.count / 6;
  for (let v = 0; v < uv.count; v++) {
    const face = Math.min(5, Math.floor(v / perFace));
    const value = DIE_FACE_VALUES[face] ?? 1;
    const [cx, cy] = diceCellFor(value);
    const u = uv.getX(v);
    const w = uv.getY(v);
    uv.setXY(v, (cx + u) / DICE_ATLAS_COLS, 1 - (cy + 1 - w) / DICE_ATLAS_ROWS);
  }
  uv.needsUpdate = true;
  return geo;
}

let geoCache: BufferGeometry | null = null;

export function diceGeometry(): BufferGeometry {
  if (geoCache) return geoCache;
  const g = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 2, DIE_SIZE * 0.14);
  geoCache = remapDiceUvs(g);
  return geoCache;
}

export function drawDiceAtlas(ctx: CanvasRenderingContext2D): void {
  for (let value = 1; value <= 6; value++) {
    const [cx, cy] = diceCellFor(value);
    const ox = cx * CELL;
    const oy = cy * CELL;
    ctx.fillStyle = '#f4ecdb';
    ctx.fillRect(ox, oy, CELL, CELL);
    const vg = ctx.createRadialGradient(
      ox + CELL / 2,
      oy + CELL / 2,
      CELL * 0.2,
      ox + CELL / 2,
      oy + CELL / 2,
      CELL * 0.75,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(80,60,30,0.14)');
    ctx.fillStyle = vg;
    ctx.fillRect(ox, oy, CELL, CELL);
    const red = value === 1 || value === 4;
    const r = value === 1 ? CELL * 0.17 : CELL * 0.085;
    for (const [px, py] of PIP_LAYOUT[value] ?? []) {
      ctx.fillStyle = red ? '#b03220' : '#2a2418';
      ctx.beginPath();
      ctx.arc(ox + px * CELL, oy + py * CELL, r, 0, Math.PI * 2);
      ctx.fill();
      // Tiny specular so the pips read as recessed enamel.
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(ox + px * CELL - r * 0.3, oy + py * CELL - r * 0.3, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

let texCache: CanvasTexture | null = null;

export function diceAtlasTexture(): CanvasTexture {
  if (texCache) return texCache;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * DICE_ATLAS_COLS;
  canvas.height = CELL * DICE_ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  drawDiceAtlas(ctx);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  texCache = tex;
  return tex;
}

export function createDice(count = 2): InstancedMesh {
  const mat = new MeshPhysicalMaterial({
    map: diceAtlasTexture(),
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    sheen: 0.1,
    sheenColor: new Color('#fff4dc'),
  });
  const mesh = new InstancedMesh(diceGeometry(), mat, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'dice';
  return mesh;
}
