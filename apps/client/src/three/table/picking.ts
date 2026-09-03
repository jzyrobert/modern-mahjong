import { type Camera, Matrix4, Vector3 } from 'three';
import { TILE_D, TILE_H, TILE_W } from '../tiles/geometry';

/**
 * World → screen projection for the DOM hit-targets. Every tile the
 * user can tap (own hand, the next wall tile) gets a transparent
 * absolutely-positioned `<button>` whose rect is the 2D bounds of the
 * tile's projected box — that keeps `data-testid="own-hand-tile"` /
 * `wall-draw-next` meaningful for Playwright and screen readers while
 * the pixels come from WebGL.
 */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const CORNERS: Vector3[] = [];
for (const sx of [-1, 1]) {
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      CORNERS.push(new Vector3((sx * TILE_W) / 2, (sy * TILE_H) / 2, (sz * TILE_D) / 2));
    }
  }
}
const _v = new Vector3();
const _m = new Matrix4();

/**
 * Project a tile's object→world matrix through `camera` into CSS
 * pixels for a `width`×`height` viewport. Returns null when the whole
 * box is behind the camera.
 */
export function projectTileRect(
  matrixWorld: Matrix4,
  camera: Camera,
  width: number,
  height: number,
  out: ScreenRect = { left: 0, top: 0, width: 0, height: 0 },
): ScreenRect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const c of CORNERS) {
    _v.copy(c).applyMatrix4(matrixWorld).project(camera);
    if (_v.z > 1) continue;
    any = true;
    const sx = (_v.x * 0.5 + 0.5) * width;
    const sy = (-_v.y * 0.5 + 0.5) * height;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  if (!any) return null;
  out.left = minX;
  out.top = minY;
  out.width = maxX - minX;
  out.height = maxY - minY;
  return out;
}

/** Compose a tile matrix from position + quaternion + uniform scale. */
export function tileMatrix(
  pos: { x: number; y: number; z: number },
  quat: { x: number; y: number; z: number; w: number },
  scale = 1,
  out: Matrix4 = _m,
): Matrix4 {
  return out.compose(
    _v.set(pos.x, pos.y, pos.z),
    // biome-ignore lint/suspicious/noExplicitAny: Quaternion-like duck type
    quat as any,
    new Vector3(scale, scale, scale),
  );
}

/** Union of several rects (for the own-hand row / river hit regions). */
export function unionRects(rects: readonly ScreenRect[]): ScreenRect | null {
  if (rects.length === 0) return null;
  let l = Number.POSITIVE_INFINITY;
  let t = Number.POSITIVE_INFINITY;
  let r = Number.NEGATIVE_INFINITY;
  let b = Number.NEGATIVE_INFINITY;
  for (const rc of rects) {
    l = Math.min(l, rc.left);
    t = Math.min(t, rc.top);
    r = Math.max(r, rc.left + rc.width);
    b = Math.max(b, rc.top + rc.height);
  }
  return { left: l, top: t, width: r - l, height: b - t };
}

/** Grow a rect on every side (min touch size, halo padding). */
export function padRect(r: ScreenRect, pad: number, minW = 0, minH = 0): ScreenRect {
  const w = Math.max(minW, r.width + pad * 2);
  const h = Math.max(minH, r.height + pad * 2);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return { left: cx - w / 2, top: cy - h / 2, width: w, height: h };
}

export function rectsClose(a: ScreenRect | null, b: ScreenRect | null, eps = 0.75): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.left - b.left) < eps &&
    Math.abs(a.top - b.top) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps
  );
}
