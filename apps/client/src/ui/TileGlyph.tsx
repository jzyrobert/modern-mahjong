import type { Tile as MTile } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path } from 'react-native-svg';

/**
 * Mahjong tile face. Native port of `_legacy/src/ui/TileGlyph.tsx` —
 * same visual language (procedural geometry for pin dots and bamboo
 * sticks, layered TC-serif character text for man / winds / dragons,
 * and the traditional bird for sou-1).
 *
 * Rendering split: react-native-svg for geometry (circles, ellipses,
 * paths). RN `<Text>` absolutely-positioned over the SVG for character
 * glyphs — `react-native-svg`'s `SvgText` baseline alignment is
 * inconsistent across iOS / Android / web, and we need precise
 * alignment so the design language reads cleanly on every platform.
 *
 * Renders into the parent's full size; `width: '100%'` + `height: '100%'`.
 * The 36×50 reference viewBox matches the legacy `--tile-w` / `--tile-h`
 * geometry.
 */
const W = 36;
const H = 50;
const CX = W / 2;
const CY = H / 2;
const MAN_FILL = '#7e2e21';
const SERIF_FAMILY = 'Noto Serif TC';

interface TileGlyphProps {
  t: MTile;
  /** Actual rendered tile width in CSS pixels. Drives the
   *  ManText / HonorText font sizes so character glyphs scale with
   *  the tile box instead of staying pinned to the 36×50 reference
   *  size. SVG geometry (pin / sou) already scales via viewBox. */
  width?: number;
}

export function TileGlyph({ t, width }: TileGlyphProps) {
  const scale = width !== undefined ? width / W : 1;
  return (
    <View style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {renderSvg(t)}
      </Svg>
      {renderTextOverlay(t, scale)}
    </View>
  );
}

function renderSvg(t: MTile) {
  if (t.kind === 'suit') {
    if (t.suit === 'pin') return <PinSvg rank={t.rank} />;
    if (t.suit === 'sou') return <SouSvg rank={t.rank} />;
  }
  // man + honors are pure-text — no SVG geometry needed
  return null;
}

function renderTextOverlay(t: MTile, scale: number) {
  if (t.kind === 'suit' && t.suit === 'man') return <ManText rank={t.rank} scale={scale} />;
  if (t.kind === 'honor') return <HonorText honor={t.honor} scale={scale} />;
  return null;
}

// 9-position grid layouts for pin/sou. Coordinates relative to viewBox
// centre, in the design's 60-unit reference space; rescaled to 36×50 below.
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

function PinSvg({ rank }: { rank: number }) {
  const layout = LAYOUTS[rank] ?? [];
  const r = rank <= 4 ? 4.5 : rank <= 6 ? 3.8 : 3.2;
  const sc = W / 60;
  return (
    <G transform={`translate(${CX},${CY}) scale(${sc})`}>
      {layout.map(([x, y], i) => (
        <PinDot
          // biome-ignore lint/suspicious/noArrayIndexKey: layout is fixed per rank
          key={i}
          x={x}
          y={y}
          r={r}
        />
      ))}
    </G>
  );
}

function PinDot({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <G transform={`translate(${x},${y})`}>
      <Circle r={r} fill="#1a5b9e" />
      <Circle r={r - 1.4} fill="none" stroke="#ece4d3" strokeWidth={0.8} />
      <Circle r={r - 2.6} fill="#a83b2a" opacity={0.8} />
    </G>
  );
}

function SouSvg({ rank }: { rank: number }) {
  if (rank === 1) {
    // 1-sou: traditional bird. Procedural geometry — body, head, eye,
    // wings, beak.
    const sc = W / 44;
    return (
      <G transform={`translate(${CX},${CY}) scale(${sc})`}>
        <Ellipse cx={0} cy={2} rx={10} ry={13} fill="#3e8749" />
        <Circle cx={0} cy={-9} r={6} fill="#aa3f30" />
        <Circle cx={2} cy={-10} r={1.2} fill="white" />
        <Path
          d="M -3 -2 Q -8 4 -10 8"
          stroke="#306835"
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M 3 -2 Q 8 4 10 8"
          stroke="#306835"
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
        />
        <Path d="M 0 -3 L 4 -6" stroke="#a17b1c" strokeWidth={1.5} strokeLinecap="round" />
      </G>
    );
  }
  const layout = LAYOUTS[rank] ?? [];
  const baseScale = rank <= 4 ? 0.75 : rank <= 6 ? 0.6 : 0.5;
  const sc = (baseScale * (W / 44)) / 0.75;
  return (
    <G transform={`translate(${CX},${CY}) scale(${sc})`}>
      {layout.map(([x, y], i) => (
        <BambooStick
          // biome-ignore lint/suspicious/noArrayIndexKey: layout is fixed per rank
          key={i}
          x={x}
          y={y}
          scale={0.75}
        />
      ))}
    </G>
  );
}

function BambooStick({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <G transform={`translate(${x},${y}) scale(${scale})`}>
      <Ellipse cx={0} cy={0} rx={3.2} ry={9} fill="#3e8749" />
      <Ellipse cx={0} cy={-3} rx={3.2} ry={2} fill="#5dba6c" opacity={0.6} />
      <Line x1={-3.2} y1={0} x2={3.2} y2={0} stroke="#284628" strokeWidth={0.6} />
    </G>
  );
}

function ManText({ rank, scale }: { rank: number; scale: number }) {
  // Position = percentage of parent height (matches legacy text Y values
  // CY - H*0.12 and CY + H*0.18 → ~38% and ~68% of H respectively).
  // Font sizes scale with the tile box; the 16/13 px reference values
  // are designed for the 36×50 reference tile, so multiplying by
  // `scale = width / 36` keeps the glyph proportional at any size.
  return (
    <>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '24%',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <Text
          allowFontScaling={false}
          style={{
            fontFamily: SERIF_FAMILY,
            fontSize: 16 * scale,
            fontWeight: '700',
            color: MAN_FILL,
            lineHeight: 18 * scale,
          }}
        >
          {rank}
        </Text>
      </View>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '54%',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <Text
          allowFontScaling={false}
          style={{
            fontFamily: SERIF_FAMILY,
            fontSize: 13 * scale,
            fontWeight: '600',
            color: MAN_FILL,
            lineHeight: 14 * scale,
          }}
        >
          萬
        </Text>
      </View>
    </>
  );
}

const WIND_GLYPHS: Record<string, string> = {
  E: '東',
  S: '南',
  W: '西',
  N: '北',
};

const DRAGONS: Record<string, { glyph: string; color: string }> = {
  Z: { glyph: '中', color: '#aa3f30' },
  F: { glyph: '發', color: '#3a7236' },
  B: { glyph: '白', color: '#525960' },
};

function HonorText({ honor, scale }: { honor: string; scale: number }) {
  let glyph: string | undefined;
  let color: string | undefined;
  if (honor in WIND_GLYPHS) {
    glyph = WIND_GLYPHS[honor];
    color = '#363b48';
  } else if (honor in DRAGONS) {
    const d = DRAGONS[honor]!;
    glyph = d.glyph;
    color = d.color;
  }
  if (!glyph || !color) return null;
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: SERIF_FAMILY,
          fontSize: 22 * scale,
          fontWeight: '700',
          color,
          lineHeight: 24 * scale,
        }}
      >
        {glyph}
      </Text>
    </View>
  );
}
