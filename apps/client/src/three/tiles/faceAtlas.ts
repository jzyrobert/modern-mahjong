import { HONORS, type Tile, tileId } from '@mahjong/game-logic';
import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from 'three';

/**
 * 136-tile face atlas drawn on a canvas at mount. 34 distinct faces +
 * 1 back cell → 7 columns × 5 rows. Cell index = `tileId >> 2`
 * (suit faces 0..26 in man/pin/sou order, honors 27..33 in
 * E S W N Z F B order), `BACK_CELL` = 34.
 *
 * The drawing code is a faithful port of `ui/TileGlyph.tsx` (same
 * 36×50 reference space, same 44×60 suit layouts, same ink palette,
 * same lotus / sparrow / bamboo geometry) so the 3D tiles read as the
 * same set the classic shells draw — see that file for the design
 * notes. Everything here is procedural (asset policy §5).
 *
 * Memory: 7 × 256 by 5 × 352 = 1792 × 1760 RGBA ≈ 12.6 MB (+⅓ mips)
 * — inside the 24 MB atlas budget. A 2× cell would be 50 MB, so
 * `scale` is capped at 1.25 (≈ 20 MB before mips) and only worth it on
 * desktop-class GPUs; the default stays 1.
 */
export const ATLAS_COLS = 7;
export const ATLAS_ROWS = 5;
export const CELL_W = 256;
export const CELL_H = 352;
export const BACK_CELL = 34;
export const FACE_COUNT = 34;

export const INK_BLACK = '#2a2418';
export const INK_RED = '#b03220';
export const INK_GREEN = '#266c40';
export const INK_DEEP_GREEN = '#1a4f2c';
export const INK_HIGHLIGHT = '#f7f1e3';
export const INK_LOTUS_LITE = '#efe7c8';
export const IVORY = '#f6f0e1';
export const IVORY_EDGE = '#e6dcc6';

const SERIF =
  "'Noto Serif TC', 'Noto Serif CJK TC', 'Songti TC', 'PMingLiU', 'WenQuanYi Zen Hei', serif";
const CHINESE_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WIND_GLYPH: Record<string, string> = { E: '東', S: '南', W: '西', N: '北' };

/** Reference viewBox of `TileGlyph.tsx`. */
const W = 36;
const H = 50;
const CX = W / 2;
const CY = H / 2;
/** Suit layouts are authored in a 44×60 space and scaled into 36×50. */
const SC = W / 44;

export function cellIndexFor(t: Tile): number {
  return tileId(t) >> 2;
}

/** Atlas UV offset for a cell, in [0,1] with V measured from the bottom. */
export function cellOffset(cell: number): [number, number] {
  const col = cell % ATLAS_COLS;
  const row = Math.floor(cell / ATLAS_COLS);
  return [col / ATLAS_COLS, 1 - (row + 1) / ATLAS_ROWS];
}

export const CELL_SCALE: [number, number] = [1 / ATLAS_COLS, 1 / ATLAS_ROWS];

export interface AtlasResult {
  texture: Texture;
  canvas: HTMLCanvasElement;
  /** Cell scale the atlas was rasterised at (1 = 256×352 cells). */
  scale: number;
}

const cache = new Map<number, AtlasResult>();

export interface AtlasOptions {
  backColor?: string | undefined;
  /** Raster scale per cell — 1 (default) or up to 1.25 on high tier. */
  scale?: number | undefined;
  /** Anisotropic filtering level for the texture. */
  anisotropy?: number | undefined;
}

export function buildFaceAtlas(opts: AtlasOptions = {}): AtlasResult {
  const scale = Math.min(1.25, Math.max(0.5, opts.scale ?? 1));
  const hit = cache.get(scale);
  if (hit) {
    if (opts.anisotropy && opts.anisotropy > hit.texture.anisotropy) {
      hit.texture.anisotropy = opts.anisotropy;
      hit.texture.needsUpdate = true;
    }
    return hit;
  }
  const cw = Math.round(CELL_W * scale);
  const ch = Math.round(CELL_H * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw * ATLAS_COLS;
  canvas.height = ch * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  for (let cell = 0; cell < FACE_COUNT; cell++) {
    const col = cell % ATLAS_COLS;
    const row = Math.floor(cell / ATLAS_COLS);
    ctx.save();
    ctx.translate(col * cw, row * ch);
    ctx.scale(scale, scale);
    drawFaceCell(ctx, cell);
    ctx.restore();
  }
  // Back cell — a neutral placeholder. The tile material swaps in the
  // skin gradient for back-cell instances (`TilePool.commit` writes a
  // sentinel offset), so this only shows if something samples it raw.
  {
    const col = BACK_CELL % ATLAS_COLS;
    const row = Math.floor(BACK_CELL / ATLAS_COLS);
    ctx.save();
    ctx.translate(col * cw, row * ch);
    ctx.fillStyle = opts.backColor ?? '#5a8cb0';
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = opts.anisotropy ?? 4;
  const result = { texture, canvas, scale };
  cache.set(scale, result);
  return result;
}

/**
 * Draws one face into a CELL_W×CELL_H cell at the current origin (the
 * caller applies any raster scale). Exported so the debug tile-sheet
 * and unit tests can rasterise a single cell.
 */
export function drawFaceCell(ctx: CanvasRenderingContext2D, cell: number): void {
  // Ivory face with a faint warm vignette so the printed face reads as
  // an inlaid slab against the body colour in `materials.ts`.
  ctx.fillStyle = IVORY;
  ctx.fillRect(0, 0, CELL_W, CELL_H);
  const vg = ctx.createRadialGradient(
    CELL_W / 2,
    CELL_H / 2,
    CELL_W * 0.4,
    CELL_W / 2,
    CELL_H / 2,
    CELL_W * 0.95,
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(90,70,40,0.12)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, CELL_W, CELL_H);

  // Map the 36×50 reference space onto the cell.
  const s = CELL_W / W;
  ctx.save();
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (cell < 27) {
    const suit = Math.floor(cell / 9);
    const rank = (cell % 9) + 1;
    if (suit === 0) drawMan(ctx, rank);
    else if (suit === 1) drawPin(ctx, rank);
    else drawSou(ctx, rank);
  } else {
    const honor = HONORS[cell - 27] ?? 'E';
    drawHonor(ctx, honor);
  }
  ctx.restore();
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 700,
  stroke = 0,
): void {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (stroke > 0) {
    // Synthetic emboldening: a round-joined stroke in the ink colour
    // under the fill thickens every stem by `stroke` reference units.
    ctx.strokeStyle = color;
    ctx.lineWidth = stroke;
    ctx.lineJoin = 'round';
    ctx.strokeText(s, x, y);
  }
  ctx.fillText(s, x, y);
}

// ─── Man numeral + 萬 ──────────────────────────────────────────────
// `ManText` in TileGlyph: numeral (18px, INK_BLACK) in the upper third
// with 10% top padding, 萬 (12px, INK_RED) in the lower third with 14%
// bottom padding, `space-between`. Line boxes → centres at y≈14 / 37.
/**
 * Extra stem weight for the 萬 faces' characters, in the 36-unit
 * reference space. A river tile on the width-bound portrait table is
 * ~24 CSS px across, so the atlas cell is minified ~10×: Noto Serif
 * TC's 700 hairlines (≈ 0.5 units) vanish into the mip chain and 六 /
 * 八 / 九 were told apart by silhouette, not read (round-4 #1). Stroking
 * the glyph 0.8 units (numeral) / 0.55 (萬) lifts the thinnest stems to
 * ≈ 1.3 / 1.05 units — a black-weight cut that still survives at ~1 CSS
 * px after minification. Dots, bamboo and the honours already read at
 * that size and keep the 700 cut.
 */
export const MAN_NUMERAL_STROKE = 0.8;
export const MAN_SUIT_STROKE = 0.55;
function drawMan(ctx: CanvasRenderingContext2D, rank: number): void {
  text(ctx, CHINESE_NUM[rank] ?? '', CX, 14.4, 18, INK_BLACK, 700, MAN_NUMERAL_STROKE);
  text(ctx, '萬', CX, 36.6, 12.5, INK_RED, 700, MAN_SUIT_STROKE);
}

// ─── Pin dots ──────────────────────────────────────────────────────
// Coordinates in the 44×60 space, centred on the tile.
const PIN_LAYOUTS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  2: [
    [0, -12],
    [0, 12],
  ],
  3: [
    [-10, -12],
    [0, 0],
    [10, 12],
  ],
  4: [
    [-9, -12],
    [9, -12],
    [-9, 12],
    [9, 12],
  ],
  5: [
    [-10, -12],
    [10, -12],
    [0, 0],
    [-10, 12],
    [10, 12],
  ],
  6: [
    [-10, -16],
    [10, -16],
    [-10, 2],
    [10, 2],
    [-10, 14],
    [10, 14],
  ],
  7: [
    [-12, -16],
    [0, -12],
    [12, -8],
    [-8, 5],
    [8, 5],
    [-8, 16],
    [8, 16],
  ],
  8: [
    [-10, -16.5],
    [10, -16.5],
    [-10, -5.5],
    [10, -5.5],
    [-10, 5.5],
    [10, 5.5],
    [-10, 16.5],
    [10, 16.5],
  ],
  9: [
    [-11, -14],
    [0, -14],
    [11, -14],
    [-11, 0],
    [0, 0],
    [11, 0],
    [-11, 14],
    [0, 14],
    [11, 14],
  ],
};

const PIN_RED: Record<number, ReadonlyArray<number>> = {
  3: [1],
  5: [2],
  6: [2, 3, 4, 5],
  7: [0, 1, 2],
  9: [3, 4, 5],
};
const PIN_BLACK: Record<number, ReadonlyArray<number>> = {
  8: [0, 1, 2, 3, 4, 5, 6, 7],
  9: [6, 7, 8],
};

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** Concentric ring + cream eye + ink core (TileGlyph `PinDot`). */
function pinDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  circle(ctx, x, y, r);
  ctx.fill();
  ctx.fillStyle = INK_HIGHLIGHT;
  circle(ctx, x, y, r * 0.55);
  ctx.fill();
  ctx.fillStyle = color;
  circle(ctx, x, y, r * 0.25);
  ctx.fill();
}

/** Pin 1 — lotus mandala (TileGlyph `PinOne`). */
function drawPinOne(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(CX, CY);
  ctx.scale(SC, SC);
  ctx.strokeStyle = INK_GREEN;
  ctx.lineWidth = 1;
  circle(ctx, 0, 0, 15);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = i * 45;
    ctx.save();
    ctx.rotate((a * Math.PI) / 180);
    ctx.globalAlpha = a % 90 === 0 ? 1 : 0.65;
    ctx.fillStyle = INK_GREEN;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.quadraticCurveTo(4, -10, 0, -4);
    ctx.quadraticCurveTo(-4, -10, 0, -16);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = INK_RED;
  circle(ctx, 0, 0, 5);
  ctx.fill();
  ctx.strokeStyle = INK_LOTUS_LITE;
  ctx.lineWidth = 0.8;
  circle(ctx, 0, 0, 5);
  ctx.stroke();
  ctx.fillStyle = INK_LOTUS_LITE;
  circle(ctx, 0, 0, 1.5);
  ctx.fill();
  ctx.restore();
}

function drawPin(ctx: CanvasRenderingContext2D, rank: number): void {
  if (rank === 1) {
    drawPinOne(ctx);
    return;
  }
  const layout = PIN_LAYOUTS[rank] ?? [];
  const reds = PIN_RED[rank] ?? [];
  const blacks = PIN_BLACK[rank] ?? [];
  const r = rank <= 4 ? 5.5 : rank <= 6 ? 4.6 : 3.8;
  ctx.save();
  ctx.translate(CX, CY);
  ctx.scale(SC, SC);
  layout.forEach(([x, y], i) => {
    const color = blacks.includes(i) ? INK_BLACK : reds.includes(i) ? INK_RED : INK_GREEN;
    pinDot(ctx, x, y, r, color);
  });
  ctx.restore();
}

// ─── Sou (bamboo) ──────────────────────────────────────────────────
type SouLayout = ReadonlyArray<readonly [number, number] | readonly [number, number, number]>;

const SOU_LAYOUTS: Record<number, SouLayout> = {
  2: [
    [0, -12],
    [0, 12],
  ],
  3: [
    [0, -13],
    [-10, 11],
    [10, 11],
  ],
  4: [
    [-8, -12],
    [8, -12],
    [-8, 12],
    [8, 12],
  ],
  5: [
    [-8, -14],
    [8, -14],
    [0, 0],
    [-8, 14],
    [8, 14],
  ],
  6: [
    [-9, -14],
    [0, -14],
    [9, -14],
    [-9, 14],
    [0, 14],
    [9, 14],
  ],
  7: [
    [0, -18],
    [-9, -3],
    [0, -3],
    [9, -3],
    [-9, 16],
    [0, 16],
    [9, 16],
  ],
  8: [
    [-11, -13, 0],
    [-5, -13, 32],
    [5, -13, -32],
    [11, -13, 0],
    [-11, 13, 0],
    [-5, 13, -32],
    [5, 13, 32],
    [11, 13, 0],
  ],
  9: [
    [-9, -18],
    [0, -18],
    [9, -18],
    [-9, 0],
    [0, 0],
    [9, 0],
    [-9, 18],
    [0, 18],
    [9, 18],
  ],
};

const SOU_RED: Record<number, ReadonlyArray<number>> = {
  5: [2],
  7: [0],
  9: [1, 4, 7],
};

/** One hourglass-pinch bamboo segment from `y0` to `y1` (TileGlyph `BAMBOO_PATH`). */
function bambooSegment(ctx: CanvasRenderingContext2D, y0: number, y1: number): void {
  const ym = (y0 + y1) / 2;
  ctx.moveTo(-2.4, y0);
  ctx.quadraticCurveTo(0, y0 + 0.6, 2.4, y0);
  ctx.quadraticCurveTo(0.9, ym, 2.4, y1);
  ctx.quadraticCurveTo(0, y1 - 0.6, -2.4, y1);
  ctx.quadraticCurveTo(-0.9, ym, -2.4, y0);
  ctx.closePath();
}

function bambooStick(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  rotDeg: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotDeg * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.beginPath();
  bambooSegment(ctx, -9, -3);
  bambooSegment(ctx, -3, 3);
  bambooSegment(ctx, 3, 9);
  ctx.fill();
  ctx.fillStyle = INK_HIGHLIGHT;
  for (const cy of [-6, 0, 6]) {
    circle(ctx, 0, cy, 0.55);
    ctx.fill();
  }
  ctx.restore();
}

/** Sou 1 — sparrow on a twig (TileGlyph `SouBird`). */
function drawSouBird(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(CX, CY);
  ctx.scale(SC * 1.2, SC * 1.2);
  // twig perch
  ctx.strokeStyle = INK_GREEN;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-14, 14);
  ctx.lineTo(14, 14);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-10, 14);
  ctx.lineTo(-12, 17);
  ctx.moveTo(8, 14);
  ctx.lineTo(10, 17);
  ctx.stroke();
  // legs
  ctx.strokeStyle = INK_BLACK;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-2, 11);
  ctx.lineTo(-2, 14);
  ctx.moveTo(3, 11);
  ctx.lineTo(3, 14);
  ctx.stroke();
  // body
  ctx.fillStyle = INK_GREEN;
  ctx.beginPath();
  ctx.ellipse(-1, 3, 9, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // wing
  ctx.fillStyle = INK_DEEP_GREEN;
  ctx.beginPath();
  ctx.moveTo(-3, 1);
  ctx.quadraticCurveTo(4, -1, 6, 6);
  ctx.quadraticCurveTo(0, 8, -3, 1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK_HIGHLIGHT;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(-1, 3);
  ctx.quadraticCurveTo(3, 2, 5, 5);
  ctx.stroke();
  // head
  ctx.fillStyle = INK_RED;
  circle(ctx, -7, -3, 5);
  ctx.fill();
  // eye
  ctx.fillStyle = 'white';
  circle(ctx, -8, -4, 0.9);
  ctx.fill();
  ctx.fillStyle = INK_BLACK;
  circle(ctx, -8, -4, 0.45);
  ctx.fill();
  // beak
  ctx.beginPath();
  ctx.moveTo(-12, -3);
  ctx.lineTo(-15, -2);
  ctx.lineTo(-12, -1);
  ctx.closePath();
  ctx.fill();
  // tail
  ctx.fillStyle = INK_GREEN;
  ctx.beginPath();
  ctx.moveTo(8, 4);
  ctx.lineTo(13, 2);
  ctx.lineTo(13, 7);
  ctx.lineTo(8, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSou(ctx: CanvasRenderingContext2D, rank: number): void {
  if (rank === 1) {
    drawSouBird(ctx);
    return;
  }
  const layout = SOU_LAYOUTS[rank] ?? [];
  const reds = SOU_RED[rank] ?? [];
  const stickScale = rank <= 3 ? 1.0 : rank <= 6 ? 0.88 : 0.7;
  ctx.save();
  ctx.translate(CX, CY);
  ctx.scale(SC, SC);
  layout.forEach((entry, i) => {
    const [x, y] = entry;
    const rot = entry[2] ?? 0;
    bambooStick(ctx, x, y, stickScale, rot, reds.includes(i) ? INK_RED : INK_GREEN);
  });
  ctx.restore();
}

// ─── Honors ────────────────────────────────────────────────────────
function drawHonor(ctx: CanvasRenderingContext2D, honor: string): void {
  if (honor === 'B') {
    // White dragon — empty rectangular frame (TileGlyph `WhiteDragonFrame`).
    const fw = W * 0.56;
    const fh = H * 0.62;
    const bw = W * 0.04;
    ctx.strokeStyle = INK_BLACK;
    ctx.lineWidth = bw;
    ctx.beginPath();
    ctx.roundRect((W - fw) / 2, (H - fh) / 2, fw, fh, bw);
    ctx.stroke();
    return;
  }
  if (honor === 'Z') {
    text(ctx, '中', CX, CY + 0.5, 24, INK_RED, 700);
    return;
  }
  if (honor === 'F') {
    text(ctx, '發', CX, CY + 0.5, 24, INK_GREEN, 700);
    return;
  }
  text(ctx, WIND_GLYPH[honor] ?? honor, CX, CY + 0.5, 24, INK_BLACK, 700);
}
