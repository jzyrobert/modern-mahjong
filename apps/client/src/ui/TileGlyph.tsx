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

// Pin (dot) palette. Traditional Hong Kong / Japanese sets ink dots
// in dark green or red — `#2c5e3a` reads as "dark dot" without going
// flat black, `#b14d3a` matches the redHot used elsewhere on the felt.
const DOT_DARK = '#2c5e3a';
const DOT_RED = '#b14d3a';
const DOT_INNER = '#f4ecda';

// Pin-specific dot layouts. 60-unit reference space, rescaled below.
// Differs from sou for 7 (2-2-3 traditional pattern) and 8 (2×2
// over 2×2 cluster) — the canonical pin patterns aren't the same as
// the modern bamboo set's silhouettes.
const PIN_LAYOUTS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[0, 0]],
  2: [
    [0, -11],
    [0, 11],
  ],
  3: [
    [-11, -12],
    [0, 0],
    [11, 12],
  ],
  4: [
    [-10, -11],
    [10, -11],
    [-10, 11],
    [10, 11],
  ],
  5: [
    [-11, -12],
    [11, -12],
    [0, 0],
    [-11, 12],
    [11, 12],
  ],
  6: [
    [-10, -14],
    [10, -14],
    [-10, 0],
    [10, 0],
    [-10, 14],
    [10, 14],
  ],
  7: [
    // 3 dark dots in a row across the top, then a 2×2 red cluster
    // below — the canonical pin-7 split on traditional sets.
    [-13, -16],
    [0, -16],
    [13, -16],
    [-9, 4],
    [9, 4],
    [-9, 17],
    [9, 17],
  ],
  8: [
    // 2×2 dark cluster over 2×2 red cluster — matches the canonical
    // 4-over-4 pin pattern in the reference set.
    [-9, -16],
    [9, -16],
    [-9, -6],
    [9, -6],
    [-9, 6],
    [9, 6],
    [-9, 16],
    [9, 16],
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

// Per-rank dot color pattern — index aligns with PIN_LAYOUTS entries.
// 'D' = dark green, 'R' = red. The `R`s match traditional pin sets:
// centre-only on 5, lower 4 on 6/7, lower half on 8, top + bottom
// rows on 9. The 1-pin renders as a single ornate flower instead.
const PIN_COLORS: Record<number, ReadonlyArray<'D' | 'R'>> = {
  1: ['D'],
  2: ['D', 'D'],
  3: ['D', 'R', 'D'],
  4: ['D', 'D', 'D', 'D'],
  5: ['D', 'D', 'R', 'D', 'D'],
  6: ['D', 'D', 'R', 'R', 'R', 'R'],
  7: ['D', 'D', 'D', 'R', 'R', 'R', 'R'],
  8: ['D', 'D', 'D', 'D', 'R', 'R', 'R', 'R'],
  9: ['R', 'R', 'R', 'D', 'D', 'D', 'R', 'R', 'R'],
};

// Sou (bamboo stick) layouts — distinct from pin for 7/8/9 because
// the modern bamboo sets we modelled (image 2 reference) use 1+3+3
// and 1+3+3+1 diamond silhouettes that don't read on dot tiles.
const SOU_LAYOUTS: Record<number, ReadonlyArray<readonly [number, number]>> = {
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
    // Single red rod sits centered on top — the classic accent —
    // with a 2-col × 3-row block of dark rods below it.
    [0, -19],
    [-9, -7],
    [9, -7],
    [-9, 5],
    [9, 5],
    [-9, 17],
    [9, 17],
  ],
  8: [
    // Two columns of four rods stacked vertically. Replaces the prior
    // 1+3+3+1 silhouette with the symmetric 2×4 grid that physical sets
    // engrave.
    [-9, -19],
    [9, -19],
    [-9, -7],
    [9, -7],
    [-9, 5],
    [9, 5],
    [-9, 17],
    [9, 17],
  ],
  9: [
    [-12, -16],
    [0, -16],
    [12, -16],
    [-12, 0],
    [0, 0],
    [12, 0],
    [-12, 16],
    [0, 16],
    [12, 16],
  ],
};

function PinSvg({ rank }: { rank: number }) {
  if (rank === 1) return <PinOne />;
  const layout = PIN_LAYOUTS[rank] ?? [];
  const colors = PIN_COLORS[rank] ?? [];
  const r = rank <= 4 ? 5.4 : rank <= 6 ? 4.6 : 3.8;
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
          color={colors[i] === 'R' ? DOT_RED : DOT_DARK}
        />
      ))}
    </G>
  );
}

function PinDot({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  // Concentric-ring pattern matching physical pin tile inlay: solid
  // outer disk, cream gap, solid inner core. Reads as a stack of
  // nested circles at any tile size — the previous single-disk +
  // outline + accent looked muddy at the 22×30 discard size where
  // the inner accent collapsed into the outer fill.
  return (
    <G transform={`translate(${x},${y})`}>
      <Circle r={r} fill={color} />
      <Circle r={r * 0.62} fill={DOT_INNER} />
      <Circle r={r * 0.32} fill={color} />
    </G>
  );
}

function PinOne() {
  // Ornate 1-pin: outer dark ring, cream gap, 8-petal flower halo
  // alternating red and dark, then a red core. Evokes the chrysanthemum
  // motif on traditional 1-pin tiles without trying to engrave the
  // kanji + maker mark from the physical reference (which would
  // muddle below ~30 px tile width).
  const sc = W / 60;
  return (
    <G transform={`translate(${CX},${CY}) scale(${sc})`}>
      <Circle r={15} fill={DOT_DARK} />
      <Circle r={12.6} fill={DOT_INNER} />
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i / 8) * 2 * Math.PI - Math.PI / 2;
        const px = Math.cos(angle) * 8;
        const py = Math.sin(angle) * 8;
        const fill = i % 2 === 0 ? DOT_RED : DOT_DARK;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: petal index is fixed
          <Circle key={i} cx={px} cy={py} r={2.6} fill={fill} />
        );
      })}
      <Circle r={4} fill={DOT_DARK} />
      <Circle r={2.8} fill={DOT_RED} />
      <Circle r={1} fill={DOT_INNER} />
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
  const layout = SOU_LAYOUTS[rank] ?? [];
  const baseScale = rank <= 4 ? 0.75 : rank <= 6 ? 0.6 : 0.5;
  const sc = (baseScale * (W / 44)) / 0.75;
  // Traditional red-accent rules on physical Hong Kong / Japanese sets:
  //  · 5-sou — the centre "lucky" rod has been picked out in red since
  //    the early 20th century.
  //  · 7-sou — the lone top rod is red, balancing the 6 dark rods below.
  //  · 9-sou — every rod is red. This is the loudest tile in the set.
  const isRedRod = (i: number): boolean => {
    if (rank === 5) return i === 2;
    if (rank === 7) return i === 0;
    if (rank === 9) return true;
    return false;
  };
  return (
    <G transform={`translate(${CX},${CY}) scale(${sc})`}>
      {layout.map(([x, y], i) => (
        <BambooStick
          // biome-ignore lint/suspicious/noArrayIndexKey: layout is fixed per rank
          key={i}
          x={x}
          y={y}
          scale={0.75}
          accent={isRedRod(i)}
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
