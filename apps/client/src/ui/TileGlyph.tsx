import type { Tile as MTile } from '@mahjong/game-logic';

/**
 * SVG face for a mahjong tile. Drawn inside a 36×50 viewBox and scales to
 * whatever box the parent gives it. Replaces the older text-label rendering
 * (`1m`, `9p`, `Z`, …) with simplified glyphs:
 *
 * - Man: large Arabic numeral on top, red 萬 character below.
 * - Pin: N filled circles arranged in classic mahjong patterns.
 * - Sou: N green vertical bamboo bars (sou-1 is shown as a single thicker
 *   stroke; the traditional sou-1 bird sprite is left as a follow-up).
 * - Winds: 東/南/西/北 in black.
 * - Dragons: 中 red, 發 green, 白 rendered as a thin-bordered blank.
 *
 * Authentic per-rank pin arrangements look subtly different (the canonical
 * pin-5 has the center dot a different colour, pin-7 stacks oddly, etc.).
 * The simplified positions here trade visual fidelity for being a single
 * compact source file. Real glyph SVGs can drop in later if the tile face
 * needs to be more recognisable.
 */
export function TileGlyph({ t }: { t: MTile }) {
  return (
    <svg
      viewBox="0 0 36 50"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      // The wrapping button / span sets the accessible label; the glyph itself
      // is decorative.
      aria-hidden="true"
      style={{ display: 'block' }}
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

function ManFace({ rank }: { rank: number }) {
  return (
    <g>
      <text
        x="18"
        y="22"
        fontSize="18"
        fontWeight="700"
        textAnchor="middle"
        fill="#1a1a1a"
        fontFamily="system-ui, sans-serif"
      >
        {rank}
      </text>
      <text x="18" y="42" fontSize="14" textAnchor="middle" fill="#b22222" fontFamily="serif">
        萬
      </text>
    </g>
  );
}

const PIN_DOTS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[18, 25]],
  2: [
    [18, 12],
    [18, 38],
  ],
  3: [
    [10, 12],
    [18, 25],
    [26, 38],
  ],
  4: [
    [10, 12],
    [26, 12],
    [10, 38],
    [26, 38],
  ],
  5: [
    [10, 12],
    [26, 12],
    [18, 25],
    [10, 38],
    [26, 38],
  ],
  6: [
    [10, 12],
    [26, 12],
    [10, 25],
    [26, 25],
    [10, 38],
    [26, 38],
  ],
  7: [
    [10, 9],
    [26, 9],
    [10, 22],
    [26, 22],
    [10, 35],
    [18, 42],
    [26, 35],
  ],
  8: [
    [10, 12],
    [26, 12],
    [10, 22],
    [26, 22],
    [10, 32],
    [26, 32],
    [10, 42],
    [26, 42],
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

function PinFace({ rank }: { rank: number }) {
  const dots = PIN_DOTS[rank] ?? [];
  return (
    <g>
      {dots.map(([cx, cy], i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: PIN_DOTS layout is fixed per rank
          key={i}
          cx={cx}
          cy={cy}
          r="3.2"
          fill={i % 2 === 0 ? '#1f5fa8' : '#cf2a2a'}
        />
      ))}
    </g>
  );
}

function SouFace({ rank }: { rank: number }) {
  const cols = rank === 1 ? 1 : rank <= 3 ? 1 : rank <= 6 ? 2 : 3;
  const rows = Math.ceil(rank / cols);
  const bars: { x: number; y: number }[] = [];
  let placed = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (placed >= rank) break;
      const x = 18 - ((cols - 1) * 9) / 2 + c * 9;
      const y = 12 + r * (36 / Math.max(1, rows - 1 || 1));
      bars.push({ x, y });
      placed++;
    }
  }
  return (
    <g>
      {bars.map((b, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: bar order is deterministic from rank
          key={i}
          x={b.x - 2}
          y={b.y - 12}
          width="4"
          height="14"
          rx="1.5"
          fill="#1f7d3a"
        />
      ))}
    </g>
  );
}

const HONOR_GLYPHS: Record<string, { ch: string; fill: string }> = {
  E: { ch: '東', fill: '#1a1a1a' },
  S: { ch: '南', fill: '#1a1a1a' },
  W: { ch: '西', fill: '#1a1a1a' },
  N: { ch: '北', fill: '#1a1a1a' },
  Z: { ch: '中', fill: '#b22222' },
  F: { ch: '發', fill: '#1f7d3a' },
  B: { ch: '', fill: '#1a1a1a' },
};

function HonorFace({ honor }: { honor: string }) {
  const cfg = HONOR_GLYPHS[honor];
  if (!cfg) return null;
  if (honor === 'B') {
    // 白 is traditionally rendered as a blank face — just a thin frame.
    return (
      <rect x="6" y="9" width="24" height="32" fill="none" stroke="#1a1a1a" strokeWidth="1.6" />
    );
  }
  return (
    <text
      x="18"
      y="34"
      fontSize="22"
      textAnchor="middle"
      fill={cfg.fill}
      fontFamily="serif"
      fontWeight="700"
    >
      {cfg.ch}
    </text>
  );
}
