import type { Tile as MTile } from '@mahjong/game-logic';

/**
 * SVG glyph for a mahjong tile face. Ported from the design comp at
 * `/tmp/design/design/tile.jsx`. Drawn inside a 36×50 viewBox so it fits the
 * existing CSS-var driven `--tile-w` / `--tile-h` sizing without changes.
 *
 * Layouts:
 * - Man (萬): big TC-serif numeral on top, smaller 萬 below — both deep red.
 * - Pin (筒): N concentric dots in classical mahjong patterns.
 * - Sou (索): N stylised bamboo sticks; sou-1 is the traditional bird.
 * - Winds: 東/南/西/北 in dark slate, TC serif.
 * - Dragons: 中 (red), 發 (green), 白 (slate) — TC serif at full body height.
 *
 * The accessible label is owned by the wrapping button in `Tile.tsx`; the
 * SVG itself is decorative.
 */
const W = 36;
const H = 50;
const CX = W / 2;
const CY = H / 2;

export function TileGlyph({ t }: { t: MTile }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {renderFace(t)}
    </svg>
  );
}

function renderFace(t: MTile) {
  if (t.kind === 'suit') {
    if (t.suit === 'man') return <ManFace rank={t.rank} />;
    if (t.suit === 'pin') return <PinFace rank={t.rank} />;
    return <SouFace rank={t.rank} />;
  }
  return <HonorFace honor={t.honor} />;
}

const MAN_FILL = 'oklch(0.4 0.18 25)';
const SERIF = "'Noto Serif TC', 'Noto Serif', serif";

function ManFace({ rank }: { rank: number }) {
  return (
    <g>
      <text
        x={CX}
        y={CY - H * 0.12}
        textAnchor="middle"
        fontFamily={SERIF}
        fontSize={W * 0.42}
        fontWeight="700"
        fill={MAN_FILL}
        dominantBaseline="middle"
      >
        {rank}
      </text>
      <text
        x={CX}
        y={CY + H * 0.18}
        textAnchor="middle"
        fontFamily={SERIF}
        fontSize={W * 0.36}
        fontWeight="600"
        fill={MAN_FILL}
        dominantBaseline="middle"
      >
        萬
      </text>
    </g>
  );
}

// Layouts for 1-9 numbered tiles. Coordinates are relative to the tile
// centre and assume the design's 60-unit reference width; they're rescaled
// to our 36×50 viewBox via the parent <g transform>.
const LAYOUTS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[0, 0]],
  2: [
    [0, -10],
    [0, 10],
  ],
  3: [
    [-10, -10],
    [0, 0],
    [10, 10],
  ],
  4: [
    [-10, -10],
    [10, -10],
    [-10, 10],
    [10, 10],
  ],
  5: [
    [-10, -10],
    [10, -10],
    [0, 0],
    [-10, 10],
    [10, 10],
  ],
  6: [
    [-10, -12],
    [10, -12],
    [-10, 0],
    [10, 0],
    [-10, 12],
    [10, 12],
  ],
  7: [
    [-10, -14],
    [0, -14],
    [10, -14],
    [-10, 0],
    [10, 0],
    [-10, 14],
    [10, 14],
  ],
  8: [
    [-10, -14],
    [10, -14],
    [-10, -3],
    [10, -3],
    [-10, 8],
    [10, 8],
    [-10, 18],
    [10, 18],
  ],
  9: [
    [-12, -14],
    [0, -14],
    [12, -14],
    [-12, 0],
    [0, 0],
    [12, 0],
    [-12, 14],
    [0, 14],
    [12, 14],
  ],
};

function PinDot({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle r={r} fill="oklch(0.45 0.18 230)" />
      <circle r={r - 1.4} fill="none" stroke="oklch(0.95 0.02 85)" strokeWidth="0.8" />
      <circle r={r - 2.6} fill="oklch(0.5 0.16 25)" opacity="0.8" />
    </g>
  );
}

function PinFace({ rank }: { rank: number }) {
  const layout = LAYOUTS[rank] ?? [];
  const r = rank <= 4 ? 4.5 : rank <= 6 ? 3.8 : 3.2;
  // The design's coordinates assume a 60-unit reference; scale to our 36px width.
  const sc = W / 60;
  return (
    <g transform={`translate(${CX},${CY}) scale(${sc})`}>
      {layout.map(([x, y], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: layout is fixed per rank
        <PinDot key={i} x={x} y={y} r={r} />
      ))}
    </g>
  );
}

function BambooStick({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <ellipse cx="0" cy="0" rx="3.2" ry="9" fill="oklch(0.55 0.13 150)" />
      <ellipse cx="0" cy="-3" rx="3.2" ry="2" fill="oklch(0.7 0.15 150)" opacity="0.6" />
      <line x1="-3.2" y1="0" x2="3.2" y2="0" stroke="oklch(0.35 0.1 150)" strokeWidth="0.6" />
    </g>
  );
}

function SouFace({ rank }: { rank: number }) {
  if (rank === 1) {
    // 1-sou is traditionally a bird.
    const sc = W / 44;
    return (
      <g transform={`translate(${CX},${CY}) scale(${sc})`}>
        <ellipse cx="0" cy="2" rx="10" ry="13" fill="oklch(0.55 0.13 150)" />
        <circle cx="0" cy="-9" r="6" fill="oklch(0.5 0.18 25)" />
        <circle cx="2" cy="-10" r="1.2" fill="white" />
        <path
          d="M -3 -2 Q -8 4 -10 8"
          stroke="oklch(0.4 0.1 150)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 3 -2 Q 8 4 10 8"
          stroke="oklch(0.4 0.1 150)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 0 -3 L 4 -6"
          stroke="oklch(0.5 0.18 80)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </g>
    );
  }
  const layout = LAYOUTS[rank] ?? [];
  const sc = (rank <= 4 ? 0.75 : rank <= 6 ? 0.6 : 0.5) * (W / 44);
  return (
    <g transform={`translate(${CX},${CY}) scale(${sc / 0.75})`}>
      {layout.map(([x, y], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: layout is fixed per rank
        <BambooStick key={i} x={x} y={y} scale={0.75} />
      ))}
    </g>
  );
}

const WINDS: Record<string, string> = {
  E: '東',
  S: '南',
  W: '西',
  N: '北',
};

const DRAGONS: Record<string, { glyph: string; color: string }> = {
  Z: { glyph: '中', color: 'oklch(0.5 0.18 25)' }, // red
  F: { glyph: '發', color: 'oklch(0.5 0.14 150)' }, // green
  B: { glyph: '白', color: 'oklch(0.4 0.02 230)' }, // slate
};

function HonorFace({ honor }: { honor: string }) {
  if (honor in WINDS) {
    return (
      <text
        x={CX}
        y={CY}
        textAnchor="middle"
        fontFamily={SERIF}
        fontSize={W * 0.55}
        fontWeight="700"
        fill="oklch(0.3 0.05 240)"
        dominantBaseline="central"
      >
        {WINDS[honor]}
      </text>
    );
  }
  const d = DRAGONS[honor];
  if (!d) return null;
  return (
    <text
      x={CX}
      y={CY}
      textAnchor="middle"
      fontFamily={SERIF}
      fontSize={W * 0.55}
      fontWeight="700"
      fill={d.color}
      dominantBaseline="central"
    >
      {d.glyph}
    </text>
  );
}
