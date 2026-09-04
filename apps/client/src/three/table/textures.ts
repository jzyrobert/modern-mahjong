import type { Wind } from '@mahjong/game-logic';
import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { WIND_GLYPH } from '../../ui/winds';

/**
 * Procedural canvas textures for the table (asset policy §5: nothing
 * downloaded). All generators are deterministic (seeded LCG) so two
 * mounts render identically and screenshots are stable.
 */
const SERIF = "'Noto Serif TC', 'Noto Serif CJK TC', 'Songti TC', 'WenQuanYi Zen Hei', serif";
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return [c, ctx];
}

/**
 * Tiling cloth normal map — value noise smoothed twice, differentiated
 * into a tangent-space normal. Encodes a faint weave so the felt
 * catches the key light instead of reading as flat vinyl.
 */
export function buildFeltNormalMap(size = 256, strength = 1.0): Texture {
  const rnd = lcg(7);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = rnd();
  // Two box-blur passes (wrapping) → soft mounds; add a fine weave.
  const tmp = new Float32Array(size * size);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let acc = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = (x + dx + size) % size;
            const yy = (y + dy + size) % size;
            acc += h[yy * size + xx]!;
          }
        }
        tmp[y * size + x] = acc / 9;
      }
    }
    h.set(tmp);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave = 0.5 + 0.5 * Math.sin(x * 1.1) * Math.sin(y * 1.1);
      h[y * size + x] = h[y * size + x]! * 0.75 + weave * 0.25;
    }
  }
  const [c, ctx] = canvas2d(size, size);
  const img = ctx.createImageData(size, size);
  const k = 2.2 * strength;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)]!;
      const r = h[y * size + ((x + 1) % size)]!;
      const u = h[((y - 1 + size) % size) * size + x]!;
      const d = h[((y + 1) % size) * size + x]!;
      let nx = (l - r) * k;
      let ny = (d - u) * k;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * size + x) * 4;
      img.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}

/**
 * Greyscale multiplier for the felt colour: bright centre, ~22 %
 * darker toward the rail, with a faint cloth grain. Multiplies
 * `material.color`, so skin changes only touch the colour uniform.
 */
export function buildFeltShadeMap(size = 512): Texture {
  const [c, ctx] = canvas2d(size, size);
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.18,
    size / 2,
    size / 2,
    size * 0.72,
  );
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, '#e6e6e6');
  g.addColorStop(1, '#b4b4b4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const rnd = lcg(3);
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 4000; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    ctx.fillStyle = rnd() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}

/** Warm wood grain for the rail — streaks along u with gentle wobble. */
export function buildWoodMap(size = 512): Texture {
  const [c, ctx] = canvas2d(size, size / 4);
  const w = size;
  const h = size / 4;
  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#6b4224');
  base.addColorStop(0.5, '#5a3419');
  base.addColorStop(1, '#4b2a13');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const rnd = lcg(11);
  ctx.lineWidth = 1;
  for (let i = 0; i < 140; i++) {
    const y0 = rnd() * h;
    const amp = 1 + rnd() * 3;
    const freq = 0.004 + rnd() * 0.01;
    const phase = rnd() * Math.PI * 2;
    const dark = rnd() > 0.45;
    ctx.strokeStyle = dark
      ? `rgba(40,20,8,${0.12 + rnd() * 0.22})`
      : `rgba(190,130,80,${0.08 + rnd() * 0.14})`;
    ctx.lineWidth = 0.6 + rnd() * 1.6;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y =
        y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase) * amp * 0.3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Fine speckle.
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = rnd() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
  }
  ctx.globalAlpha = 1;
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}

export interface PlateInfo {
  prevailingWind: Wind;
  /** Live wall count; `null` between hands (the waiting table shows the wind only). */
  wallCount: number | null;
}

/**
 * Centre plate top: lacquer disc, gold ring, prevailing wind glyph and
 * the live wall count. Redrawn (cheaply) whenever either changes.
 */
export function drawPlate(ctx: CanvasRenderingContext2D, size: number, info: PlateInfo): void {
  const r = size / 2;
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(r, r * 0.85, r * 0.1, r, r, r);
  g.addColorStop(0, '#2a2622');
  g.addColorStop(0.75, '#1a1613');
  g.addColorStop(1, '#0f0c0a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  // Gold rings.
  ctx.strokeStyle = 'rgba(216,168,90,0.9)';
  ctx.lineWidth = size * 0.012;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.93, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(216,168,90,0.35)';
  ctx.lineWidth = size * 0.005;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.86, 0, Math.PI * 2);
  ctx.stroke();
  // Prevailing wind at the centre with the live wall count toward the
  // near rim; the dice rest on the far rim (canvas top), clear of both.
  ctx.fillStyle = '#efe6d2';
  ctx.font = `700 ${size * 0.34}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(WIND_GLYPH[info.prevailingWind], r, r * 1.02);
  // Wall count only — a caption under it would render at ~3 CSS px
  // on a phone; the status pill carries the "N left" wording.
  if (info.wallCount !== null) {
    ctx.fillStyle = 'rgba(216,168,90,0.95)';
    ctx.font = `800 ${size * 0.13}px ${SANS}`;
    ctx.fillText(`${info.wallCount}`, r, r * 1.5);
  }
}

export function buildPlateTexture(size = 512): {
  texture: Texture;
  ctx: CanvasRenderingContext2D;
  size: number;
} {
  const [c, ctx] = canvas2d(size, size);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  return { texture: tex, ctx, size };
}

/**
 * Dealer chip face: red lacquer disc with a thin gold ring and a white
 * 莊. The corners outside the disc stay plain lacquer — the chip's
 * side geometry samples the top-left corner.
 */
export function buildDealerMarkerTexture(): Texture {
  const size = 256;
  const [c, ctx] = canvas2d(size, size);
  const r = size / 2;
  ctx.fillStyle = '#9c3f2f';
  ctx.fillRect(0, 0, size, size);
  const g = ctx.createRadialGradient(r, r * 0.8, r * 0.1, r, r, r);
  g.addColorStop(0, '#c2604a');
  g.addColorStop(0.7, '#b14d3a');
  g.addColorStop(1, '#8e3a2c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(216,168,90,0.95)';
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.86, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fbf3e4';
  ctx.font = `700 ${size * 0.52}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('莊', r, r * 1.04);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}

/** Six die faces side by side (values 1..6 left→right), ivory + ink pips. */
export function buildDiceTexture(): Texture {
  const cell = 128;
  const [c, ctx] = canvas2d(cell * 6, cell);
  const pip = (fx: number, fy: number, i: number, red = false) => {
    ctx.fillStyle = red ? '#b03220' : '#2a2418';
    ctx.beginPath();
    ctx.arc(i * cell + cell * fx, cell * fy, cell * 0.085, 0, Math.PI * 2);
    ctx.fill();
  };
  const layouts: Record<number, [number, number][]> = {
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
  for (let v = 1; v <= 6; v++) {
    const i = v - 1;
    const g = ctx.createLinearGradient(i * cell, 0, i * cell, cell);
    g.addColorStop(0, '#f7f1e3');
    g.addColorStop(1, '#e6dcc6');
    ctx.fillStyle = g;
    ctx.fillRect(i * cell, 0, cell, cell);
    for (const [fx, fy] of layouts[v] ?? []) pip(fx, fy, i, v === 1 || v === 4);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}
