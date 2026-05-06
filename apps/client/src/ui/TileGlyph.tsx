import type { Tile as MTile } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

/**
 * Mahjong tile face — procedural geometry for pin dots and bamboo
 * sticks, layered TC-serif character text for man / winds / dragons,
 * and the traditional bird for sou-1.
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
    // 1 + 3 + 3 — single rod top-centre over two rows of three.
    // Closer to the modern reference set (image 2) than the previous
    // 3 + 2 + 2 grid which left an awkward hole in the middle.
    [0, -16],
    [-11, -2],
    [0, -2],
    [11, -2],
    [-11, 12],
    [0, 12],
    [11, 12],
  ],
  8: [
    // 1 + 3 + 3 + 1 diamond — mirrors image 2's 8-sou silhouette
    // closer than the previous 4 × 2 column grid.
    [0, -18],
    [-11, -6],
    [0, -6],
    [11, -6],
    [-11, 8],
    [0, 8],
    [11, 8],
    [0, 20],
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
    // 1-sou: clean modern sparrow icon (image-2 reference). Round
    // body + slightly-forward head with a small triangular beak,
    // two visible legs/feet so it reads as perched. No tail
    // feathers fanning out — keeps the silhouette compact and
    // legible at the 22×30 SeatDiscardPile size where ornate
    // details muddle.
    const sc = W / 50;
    return (
      <G transform={`translate(${CX},${CY}) scale(${sc})`}>
        {/* Body — round, sits low on the tile. */}
        <Ellipse cx={0} cy={2} rx={7} ry={8} fill="#3e8749" />
        {/* Wing fold — single curve on body for plumage hint. */}
        <Path
          d="M -4 -1 Q 0 6 5 1"
          stroke="#284628"
          strokeWidth={1.3}
          fill="none"
          strokeLinecap="round"
        />
        {/* Head — leans slightly forward (right). */}
        <Circle cx={2} cy={-8} r={5} fill="#3e8749" />
        {/* Crest — small red tuft. */}
        <Path
          d="M 0 -13 Q 2 -15 4 -13"
          stroke="#aa3f30"
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
        />
        {/* Eye — pupil + glint. */}
        <Circle cx={3.5} cy={-9} r={1.1} fill="white" />
        <Circle cx={3.5} cy={-9} r={0.5} fill="#1a1a1a" />
        {/* Beak — pointing right. */}
        <Path d="M 7 -8 L 11 -7 L 7 -6 Z" fill="#d6a23a" />
        {/* Two legs + feet — perched stance. */}
        <Path d="M -3 9 L -3 14" stroke="#7a5a18" strokeWidth={1.3} strokeLinecap="round" />
        <Path d="M 3 9 L 3 14" stroke="#7a5a18" strokeWidth={1.3} strokeLinecap="round" />
        <Path d="M -5 14 L -1 14" stroke="#7a5a18" strokeWidth={1.2} strokeLinecap="round" />
        <Path d="M 1 14 L 5 14" stroke="#7a5a18" strokeWidth={1.2} strokeLinecap="round" />
      </G>
    );
  }
  const layout = LAYOUTS[rank] ?? [];
  const baseScale = rank <= 4 ? 0.75 : rank <= 6 ? 0.6 : 0.5;
  const sc = (baseScale * (W / 44)) / 0.75;
  // Traditional accent: 5-sou's centre rod is red — it's the
  // "lucky" tile that's been picked out in red on every Hong Kong /
  // Japanese mahjong set since the early 20th century. Match the
  // convention so users coming from physical sets recognise it.
  const accentIdx = rank === 5 ? 2 : -1;
  return (
    <G transform={`translate(${CX},${CY}) scale(${sc})`}>
      {layout.map(([x, y], i) => (
        <BambooStick
          // biome-ignore lint/suspicious/noArrayIndexKey: layout is fixed per rank
          key={i}
          x={x}
          y={y}
          scale={0.75}
          accent={i === accentIdx}
        />
      ))}
    </G>
  );
}

interface BambooStickProps {
  x: number;
  y: number;
  scale?: number;
  /** Render in the red lucky-rod palette instead of green. The
   *  5-sou centre rod sets this; everything else stays green. */
  accent?: boolean;
}

function BambooStick({ x, y, scale = 1, accent = false }: BambooStickProps) {
  // Single tall capsule with two horizontal joint lines and three
  // subtle highlights — reads as bamboo at desktop tile sizes and
  // stays legible at the 22×30 SeatDiscardPile size. Drawing
  // three separate rectangles muddied the silhouette at small
  // sizes; one outlined rod with internal joints holds together.
  const fill = accent ? '#c14a3a' : '#3e8749';
  const outline = accent ? '#7a2a20' : '#284628';
  const highlight = accent ? '#e88478' : '#7ed091';
  return (
    <G transform={`translate(${x},${y}) scale(${scale})`}>
      <Rect
        x={-2.8}
        y={-9}
        width={5.6}
        height={18}
        rx={2.4}
        ry={2.4}
        fill={fill}
        stroke={outline}
        strokeWidth={0.8}
      />
      {/* Joint lines — split the rod into three apparent segments. */}
      <Path d="M -2.4 -3 L 2.4 -3" stroke={outline} strokeWidth={0.7} strokeLinecap="round" />
      <Path d="M -2.4 3 L 2.4 3" stroke={outline} strokeWidth={0.7} strokeLinecap="round" />
      {/* Per-segment top highlights for a cylindrical sheen. */}
      <Ellipse cx={-0.8} cy={-7} rx={1} ry={1.4} fill={highlight} opacity={0.7} />
      <Ellipse cx={-0.8} cy={-1} rx={1} ry={1.4} fill={highlight} opacity={0.55} />
      <Ellipse cx={-0.8} cy={5} rx={1} ry={1.4} fill={highlight} opacity={0.45} />
    </G>
  );
}

function ManText({ rank, scale }: { rank: number; scale: number }) {
  // The number sits in the upper third, the 萬 glyph in the lower
  // third, with a flex-grown gap between them so neither line ever
  // crowds the other on small tiles. Font sizes scale with the tile
  // width (the 16/13 px reference values are tuned for the 36×50
  // reference tile); the percentage-based row layout below keeps
  // them from colliding even when the tile aspect drifts from the
  // reference (e.g. the 22×30 size used in `SeatDiscardPile`).
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: '12%',
        paddingBottom: '12%',
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
          lineHeight: 16 * scale,
          textAlign: 'center',
        }}
      >
        {rank}
      </Text>
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: SERIF_FAMILY,
          fontSize: 13 * scale,
          fontWeight: '600',
          color: MAN_FILL,
          lineHeight: 13 * scale,
          textAlign: 'center',
        }}
      >
        萬
      </Text>
    </View>
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
