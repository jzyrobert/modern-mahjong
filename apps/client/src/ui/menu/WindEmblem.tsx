import { RED, SERIF } from '../../native/theme.js';

interface WindEmblemProps {
  /** Wind glyph to show on the emblem face — defaults to 東. */
  wind?: string;
  /** Width in px; height auto-derives from the tile aspect. */
  size?: number;
}

/**
 * Hero emblem on the lobby — a single ivory wind-tile with a deep-red
 * Chinese character on its face. Ported from
 * `/tmp/design/design/menu.jsx::WindEmblem`. Decorative, no interaction.
 */
export function WindEmblem({ wind = '東', size = 100 }: WindEmblemProps) {
  const r = size * 0.14;
  const h = size * 1.32;
  return (
    <div
      style={{
        width: size,
        height: h,
        position: 'relative',
        filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.18)) drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
      }}
    >
      <svg
        width={size}
        height={h}
        viewBox={`0 0 ${size} ${h}`}
        style={{ display: 'block' }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="we-side" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.92 0.02 85)" />
            <stop offset="100%" stopColor="oklch(0.78 0.03 85)" />
          </linearGradient>
          <linearGradient id="we-face" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.99 0.005 85)" />
            <stop offset="100%" stopColor="oklch(0.94 0.015 85)" />
          </linearGradient>
        </defs>
        <rect x={0} y={size * 0.05} width={size} height={size * 1.27} rx={r} fill="url(#we-side)" />
        <rect x={0} y={0} width={size} height={size * 1.21} rx={r} fill="url(#we-face)" />
        <rect
          x={2}
          y={2}
          width={size - 4}
          height={size * 1.21 - 4}
          rx={r - 1}
          fill="none"
          stroke="oklch(0.85 0.02 85)"
          strokeWidth="1.2"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: SERIF,
          fontWeight: 700,
          fontSize: size * 0.78,
          lineHeight: 1,
          color: RED,
          // The face sits in the upper portion of the tile (matches Tile.tsx geometry).
          paddingBottom: size * 0.13,
        }}
      >
        {wind}
      </div>
    </div>
  );
}
