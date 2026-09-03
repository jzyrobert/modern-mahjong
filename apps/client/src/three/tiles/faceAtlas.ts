import { HONORS, type Tile, tileId } from '@mahjong/game-logic';
import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, type Texture } from 'three';

/**
 * 136-tile face atlas drawn on a canvas at mount. 34 distinct faces +
 * 1 back cell → 7 columns × 5 rows. Cell index = `tileId >> 2`
 * (suit faces 0..26 in man/pin/sou order, honors 27..33 in
 * E S W N Z F B order), `BACK_CELL` = 34.
 *
 * The drawing code mirrors `ui/TileGlyph.tsx` (same 36×50 reference
 * space, same ink palette, same layouts) so the 3D tiles read as the
 * same set the classic shells draw — see that file for the design
 * notes. Everything here is procedural (asset policy §5).
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
export const IVORY = '#f5efe0';
export const IVORY_EDGE = '#e6dcc6';

const SERIF = "'Noto Serif TC', 'Noto Serif CJK TC', 'Songti TC', 'PMingLiU', serif";
const CHINESE_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WIND_GLYPH: Record<string, string> = { E: '東', S: '南', W: '西', N: '北' };

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
}

let cached: AtlasResult | null = null;

export function buildFaceAtlas(opts: { backColor?: string } = {}): AtlasResult {
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * ATLAS_COLS;
  canvas.height = CELL_H * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  for (let cell = 0; cell < FACE_COUNT; cell++) {
    const col = cell % ATLAS_COLS;
    const row = Math.floor(cell / ATLAS_COLS);
    ctx.save();
    ctx.translate(col * CELL_W, row * CELL_H);
    drawFaceCell(ctx, cell);
    ctx.restore();
  }
  // Back cell
  {
    const col = BACK_CELL % ATLAS_COLS;
    const row = Math.floor(BACK_CELL / ATLAS_COLS);
    ctx.save();
    ctx.translate(col * CELL_W, row * CELL_H);
    ctx.fillStyle = opts.backColor ?? '#5a8cb0';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    ctx.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  cached = { texture, canvas };
  return cached;
}

/** Draws one face into a CELL_W×CELL_H cell at the current origin. */
export function drawFaceCell(ctx: CanvasRenderingContext2D, cell: number): void {
  // Ivory background with a faint edge vignette so the face reads as a
  // separate inlaid slab from the body colour in `materials.ts`.
  ctx.fillStyle = IVORY;
  ctx.fillRect(0, 0, CELL_W, CELL_H);
  const vg = ctx.createRadialGradient(
    CELL_W / 2,
    CELL_H / 2,
    CELL_W * 0.35,
    CELL_W / 2,
    CELL_H / 2,
    CELL_W * 0.85,
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(90,70,40,0.10)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, CELL_W, CELL_H);

  // Map the 36×50 reference space onto the cell.
  const s = CELL_W / 36;
  ctx.save();
  ctx.scale(s, s);
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
): void {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

function drawMan(ctx: CanvasRenderingContext2D, rank: number): void {
  text(ctx, CHINESE_NUM[rank] ?? '', 18, 15, 16, INK_BLACK, 800);
  text(ctx, '萬', 18, 35, 15, INK_RED, 800);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

const PIN_LAYOUTS: Record<number, [number, number][]> = {
  2: [
    [18, 14],
    [18, 36],
  ],
  3: [
    [10, 12],
    [18, 25],
    [26, 38],
  ],
  4: [
    [11, 14],
    [25, 14],
    [11, 36],
    [25, 36],
  ],
  5: [
    [10, 12],
    [26, 12],
    [18, 25],
    [10, 38],
    [26, 38],
  ],
  6: [
    [11, 11],
    [25, 11],
    [11, 25],
    [25, 25],
    [11, 39],
    [25, 39],
  ],
  7: [
    [9, 10],
    [18, 13],
    [27, 16],
    [11, 30],
    [25, 30],
    [11, 40],
    [25, 40],
  ],
  8: [
    [11, 9],
    [25, 9],
    [11, 20],
    [25, 20],
    [11, 30],
    [25, 30],
    [11, 41],
    [25, 41],
  ],
  9: [
    [10, 11],
    [18, 11],
    [26, 11],
    [10, 25],
    [18, 25],
    [26, 25],
    [10, 39],
    [18, 39],
    [26, 39],
  ],
};

function drawPin(ctx: CanvasRenderingContext2D, rank: number): void {
  if (rank === 1) {
    // Lotus-style big dot.
    dot(ctx, 18, 25, 11, INK_GREEN);
    ctx.fillStyle = INK_RED;
    ctx.beginPath();
    ctx.arc(18, 25, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#efe7c8';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(18, 25, 8, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  const pts = PIN_LAYOUTS[rank] ?? [];
  const r = rank <= 4 ? 4.4 : rank <= 6 ? 3.8 : 3.2;
  pts.forEach(([x, y], i) => {
    const color =
      rank === 2
        ? i === 0
          ? INK_GREEN
          : INK_RED
        : rank === 5 && i === 2
          ? INK_RED
          : i % 2
            ? INK_GREEN
            : INK_BLACK;
    dot(ctx, x, y, r, rank >= 7 && i < 3 && rank === 7 ? INK_RED : color);
  });
}

function stick(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - 1.6, y - h / 2, 3.2, h, 1.2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x - 0.5, y - h / 2 + 1, 1, h - 2);
}

function drawSou(ctx: CanvasRenderingContext2D, rank: number): void {
  if (rank === 1) {
    // Sparrow-on-twig simplified: a green oval body, red head, black beak.
    ctx.fillStyle = INK_GREEN;
    ctx.beginPath();
    ctx.ellipse(18, 27, 7, 10, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK_RED;
    ctx.beginPath();
    ctx.arc(21, 15, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK_BLACK;
    ctx.beginPath();
    ctx.moveTo(25, 15);
    ctx.lineTo(29, 14);
    ctx.lineTo(25, 17);
    ctx.fill();
    ctx.strokeStyle = INK_DEEP_GREEN;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(8, 42);
    ctx.lineTo(28, 40);
    ctx.stroke();
    return;
  }
  const h = rank <= 3 ? 14 : rank <= 6 ? 12 : 10;
  const layouts: Record<number, [number, number][]> = {
    2: [
      [18, 15],
      [18, 35],
    ],
    3: [
      [18, 13],
      [11, 35],
      [25, 35],
    ],
    4: [
      [11, 14],
      [25, 14],
      [11, 36],
      [25, 36],
    ],
    5: [
      [10, 13],
      [26, 13],
      [18, 25],
      [10, 37],
      [26, 37],
    ],
    6: [
      [10, 14],
      [18, 14],
      [26, 14],
      [10, 36],
      [18, 36],
      [26, 36],
    ],
    7: [
      [18, 11],
      [10, 25],
      [18, 25],
      [26, 25],
      [10, 39],
      [18, 39],
      [26, 39],
    ],
    8: [
      [9, 13],
      [15, 13],
      [21, 13],
      [27, 13],
      [9, 37],
      [15, 37],
      [21, 37],
      [27, 37],
    ],
    9: [
      [10, 11],
      [18, 11],
      [26, 11],
      [10, 25],
      [18, 25],
      [26, 25],
      [10, 39],
      [18, 39],
      [26, 39],
    ],
  };
  const pts = layouts[rank] ?? [];
  pts.forEach(([x, y], i) => {
    const red =
      (rank === 5 && i === 2) || (rank === 7 && i === 0) || (rank === 9 && i >= 3 && i <= 5);
    stick(ctx, x, y, h, red ? INK_RED : INK_GREEN);
  });
}

function drawHonor(ctx: CanvasRenderingContext2D, honor: string): void {
  if (honor === 'B') {
    // White dragon — empty frame.
    ctx.strokeStyle = '#3c6ea6';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.roundRect(8, 9, 20, 32, 1.5);
    ctx.stroke();
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.roundRect(10.5, 11.5, 15, 27, 1);
    ctx.stroke();
    return;
  }
  if (honor === 'Z') {
    text(ctx, '中', 18, 25, 24, INK_RED, 800);
    return;
  }
  if (honor === 'F') {
    text(ctx, '發', 18, 25, 24, INK_GREEN, 800);
    return;
  }
  text(ctx, WIND_GLYPH[honor] ?? honor, 18, 25, 24, INK_BLACK, 800);
}
