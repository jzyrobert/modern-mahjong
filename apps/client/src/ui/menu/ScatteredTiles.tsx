import { TILE_BACK_1, TILE_BACK_2 } from '../../native/theme.js';

interface MiniTileBackProps {
  w?: number;
  h?: number;
  rot?: number;
}

/**
 * Decorative face-down tile. Used by `ScatteredTiles` to ornament the
 * lobby; standalone so the menu doesn't drag in the full glyph engine.
 * Ported from `/tmp/design/design/menu.jsx::MiniTileBack`.
 */
function MiniTileBack({ w = 26, h = 36, rot = 0 }: MiniTileBackProps) {
  const r = w * 0.18;
  const sideId = `mtb-side-${w}-${rot}`;
  const backId = `mtb-back-${w}-${rot}`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block', transform: `rotate(${rot}deg)` }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={sideId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.92 0.02 85)" />
          <stop offset="100%" stopColor="oklch(0.78 0.03 85)" />
        </linearGradient>
        <linearGradient id={backId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={TILE_BACK_1} />
          <stop offset="100%" stopColor={TILE_BACK_2} />
        </linearGradient>
      </defs>
      <rect x={0} y={h * 0.04} width={w} height={h * 0.96} rx={r} fill={`url(#${sideId})`} />
      <rect x={0} y={0} width={w} height={h * 0.92} rx={r} fill={`url(#${backId})`} />
      <rect
        x={1.2}
        y={1.2}
        width={w - 2.4}
        height={h * 0.92 - 2.4}
        rx={r - 1}
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="0.8"
      />
      <circle
        cx={w / 2}
        cy={h * 0.46}
        r={w * 0.22}
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="1.2"
      />
      <circle cx={w / 2} cy={h * 0.46} r={w * 0.1} fill="rgba(255,255,255,0.18)" />
    </svg>
  );
}

interface ScatteredTile {
  left?: string;
  right?: string;
  top: string;
  rot: number;
  size: number;
}

const TILES: ScatteredTile[] = [
  { left: '4%', top: '12%', rot: -14, size: 0.9 },
  { left: '8%', top: '72%', rot: 8, size: 1.0 },
  { right: '5%', top: '18%', rot: 16, size: 0.85 },
  { right: '9%', top: '76%', rot: -6, size: 1.1 },
];

/**
 * Subtle floating tile-back ornaments scattered behind the lobby content.
 * Pure decoration — `pointerEvents: none` so they never block clicks.
 * Ported from `/tmp/design/design/menu.jsx::ScatteredTiles`.
 */
export function ScatteredTiles() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 0,
      }}
      aria-hidden="true"
    >
      {TILES.map((t) => {
        const pos: React.CSSProperties = { position: 'absolute', top: t.top, opacity: 0.55 };
        if (t.left !== undefined) pos.left = t.left;
        if (t.right !== undefined) pos.right = t.right;
        return (
          <div key={`${t.left ?? t.right}-${t.top}`} style={pos}>
            <MiniTileBack w={36 * t.size} h={50 * t.size} rot={t.rot} />
          </div>
        );
      })}
    </div>
  );
}
