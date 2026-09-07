import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Procedural canvas textures for the settings preview (asset policy
 * §5 — nothing downloaded). Each builder returns a fresh
 * `CanvasTexture`; callers own disposal. Sizes are small (≤ 512²)
 * because the preview only ever covers a few hundred CSS px.
 */

/** Deterministic hash noise so every build looks identical. */
function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Bilinear value noise in [0,1] on a `cells`-wide lattice. */
function valueNoise(x: number, y: number, cells: number, seed: number): number {
  const gx = Math.floor(x * cells);
  const gy = Math.floor(y * cells);
  const fx = x * cells - gx;
  const fy = y * cells - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  // Wrap the lattice so the texture tiles seamlessly at u/v = 1.
  const x0 = ((gx % cells) + cells) % cells;
  const y0 = ((gy % cells) + cells) % cells;
  const x1 = (x0 + 1) % cells;
  const y1 = (y0 + 1) % cells;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Cloth normal map: soft woven bumps plus fine grain. Tiles seamlessly
 * because the lattice noise wraps at the texture edge (integer cell
 * counts). Blue channel is full so flat areas stay flat.
 */
export function buildClothNormal(size = 256): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const height = (u: number, v: number): number => {
    const uu = u - Math.floor(u);
    const vv = v - Math.floor(v);
    const weave = Math.sin(uu * Math.PI * 2 * 48) * Math.sin(vv * Math.PI * 2 * 48) * 0.35;
    const soft = valueNoise(uu, vv, 8, 11) * 0.6;
    const grain = valueNoise(uu, vv, 64, 23) * 0.25;
    return weave + soft + grain;
  };
  const eps = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const dx = (height(u + eps, v) - height(u - eps, v)) * 1.6;
      const dy = (height(u, v + eps) - height(u, v - eps)) * 1.6;
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, 128 + dx * 127));
      data[i + 1] = Math.max(0, Math.min(255, 128 + dy * 127));
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = NoColorSpace;
  return tex;
}

/**
 * Grayscale multiplier that darkens the felt toward the rail — the
 * material's `color` (the skin tint) multiplies through it, so a skin
 * change is a uniform write, never a redraw.
 */
export function buildFeltVignette(size = 256): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.18,
    size / 2,
    size / 2,
    size * 0.72,
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Faint cloth speckle so large flat areas don't band.
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = (valueNoise(x / size, y / size, 32, 7) - 0.5) * 14;
      const i = (y * size + x) * 4;
      d[i] = Math.max(0, Math.min(255, d[i]! + n));
      d[i + 1] = d[i]!;
      d[i + 2] = d[i]!;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = NoColorSpace;
  return tex;
}

/**
 * Warm lacquered wood for the rail: long-grain streaks along U with
 * low-frequency tone drift and a few darker knots-in-passing. Wraps
 * horizontally.
 */
export function buildWoodGrain(width = 512, height = 128): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const img = ctx.createImageData(width, height);
  const d = img.data;
  const base = [0x5e, 0x38, 0x22]; // #5e3822
  const light = [0x84, 0x56, 0x34]; // #845634
  const dark = [0x38, 0x1e, 0x12]; // #381e12
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      // Grain lines: stretched noise, 12× finer across than along.
      const wobble = valueNoise(u, v, 4, 3) * 0.08;
      const grain = valueNoise(u, v, 12, 5);
      const streak = 0.5 + 0.5 * Math.sin((v + wobble) * Math.PI * 2 * 18 + grain * 6);
      const tone = valueNoise(u, v, 3, 9);
      const t = streak * 0.55 + tone * 0.45;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const mid = base[c]! + (light[c]! - base[c]!) * (tone - 0.5) * 0.8;
        d[i + c] = Math.max(0, Math.min(255, mid + (t - 0.5) * (mid - dark[c]!) * 0.7));
      }
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
