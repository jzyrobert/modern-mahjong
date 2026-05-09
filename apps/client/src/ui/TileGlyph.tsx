import type { Honor, Tile as MTile } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import { WIND_GLYPH } from './winds';

/**
 * Mahjong tile face — classical Hong Kong physical-set styling. SVG
 * geometry for pin dots, bamboo sticks, the lotus 1-pin, and the
 * sparrow-on-twig 1-sou. Chinese-character glyphs (man numerals, 萬,
 * winds, red/green dragons) render as RN `<Text>` overlays absolutely-
 * positioned over the SVG — `react-native-svg`'s `SvgText` baseline
 * alignment is inconsistent across iOS / Android / web and the design
 * needs precise centring to read cleanly. The white dragon is drawn
 * as an empty rectangular frame (the canonical physical treatment) so
 * it stays in the SVG layer.
 *
 * Renders into the parent's full size; `width: '100%'` + `height: '100%'`.
 * The 36×50 reference viewBox matches the legacy `--tile-w` / `--tile-h`
 * geometry. Per-suit layouts come from a 44-wide × 60-tall reference
 * space (the handoff convention) and are mapped into the viewBox via
 * an outer `scale(W/44)` transform on each suit group.
 */
const W = 36;
const H = 50;
const CX = W / 2;
const CY = H / 2;
const SC = W / 44;

// Ink palette — hex approximations of the design handoff's `oklch(...)`
// values (RN-SVG's color parser doesn't accept oklch). These are the
// only colors used inside a tile face; everything else (face cream, side
// brown, back gradient) lives on the surrounding `Tile` shell.
const INK_BLACK = '#2a2418';
const INK_RED = '#b03220';
const INK_GREEN = '#266c40';
const INK_DEEP_GR = '#1a4f2c';
const INK_HIGHLIGHT = '#f7f1e3';
const INK_LOTUS_LITE = '#efe7c8';

const SERIF_FAMILY = 'Noto Serif TC';
const CHINESE_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

interface TileGlyphProps {
  t: MTile;
  /** Actual rendered tile width in CSS pixels. Drives the
   *  ManText / HonorText font sizes so character glyphs scale with
   *  the tile box instead of staying pinned to the 36×50 reference
   *  size. SVG geometry already scales via viewBox. */
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
  if (t.kind === 'honor' && t.honor === 'B') return <WhiteDragonFrame />;
  return null;
}

function renderTextOverlay(t: MTile, scale: number) {
  if (t.kind === 'suit' && t.suit === 'man') return <ManText rank={t.rank} scale={scale} />;
  if (t.kind === 'honor' && t.honor !== 'B') return <HonorText honor={t.honor} scale={scale} />;
  return null;
}

// ─── Layouts ────────────────────────────────────────────────────────
// Coordinates are in a 44-wide × 60-tall reference space (handoff
// convention). The outer `scale(W/44)` brings them into the 36×50
// viewBox without per-rank arithmetic.
//
// Sou-8 is the only entry that uses the third tuple element: outer
// four rods stay vertical (rot=0), inner pair tilts ±32° so the top
// forms an inverted W (`\/\/`) and the bottom an M (`/\/\`).

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

// Indices in the layout list that take the red ink — the 5-sou's
// centre rod, the 7-sou's top rod, and the 9-sou's middle column,
// matching traditional engraving conventions.
const SOU_RED: Record<number, ReadonlyArray<number>> = {
  5: [2],
  7: [0],
  9: [1, 4, 7],
};

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

// Per-rank ink indices into the layout list. Anything not claimed
// by `PIN_RED` or `PIN_BLACK` falls through to the green default.
const PIN_RED: Record<number, ReadonlyArray<number>> = {
  3: [1],
  5: [2],
  6: [2, 3, 4, 5],
  7: [0, 1, 2],
  9: [3, 4, 5],
};
const PIN_BLACK: Record<number, ReadonlyArray<number>> = {
  // Pin-8 is rendered all-black; expressing it as a black-index list
  // (rather than a special case in `PinSvg`) keeps the colour
  // dispatch uniform across ranks.
  8: [0, 1, 2, 3, 4, 5, 6, 7],
  9: [6, 7, 8],
};

// Three hourglass-pinch segments stacked edge-to-edge so the stick
// reads as one continuous piece of bamboo, plus three pinch highlights
// to articulate the joints. Total height is ~18 units in the 44×60
// reference space.
const BAMBOO_PATH =
  'M -2.4 -9 Q 0 -8.4 2.4 -9 Q 0.9 -6 2.4 -3 Q 0 -2.4 -2.4 -3 Q -0.9 -6 -2.4 -9 Z ' +
  'M -2.4 -3 Q 0 -2.4 2.4 -3 Q 0.9 0 2.4 3 Q 0 2.4 -2.4 3 Q -0.9 0 -2.4 -3 Z ' +
  'M -2.4 3 Q 0 2.4 2.4 3 Q 0.9 6 2.4 9 Q 0 8.4 -2.4 9 Q -0.9 6 -2.4 3 Z';

interface BambooStickProps {
  x: number;
  y: number;
  scale?: number;
  rot?: number;
  color?: string;
}

function BambooStick({ x, y, scale = 1, rot = 0, color = INK_GREEN }: BambooStickProps) {
  return (
    <G transform={`translate(${x},${y}) rotate(${rot}) scale(${scale})`}>
      <Path d={BAMBOO_PATH} fill={color} />
      <Circle cx={0} cy={-6} r={0.55} fill={INK_HIGHLIGHT} />
      <Circle cx={0} cy={0} r={0.55} fill={INK_HIGHLIGHT} />
      <Circle cx={0} cy={6} r={0.55} fill={INK_HIGHLIGHT} />
    </G>
  );
}

// Concentric ring + cream-coloured eye + ink core. The 0.55 / 0.25
// inner ratio holds together at the 22×30 SeatDiscardPile size without
// the rings collapsing into the outer fill.
function PinDot({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <G transform={`translate(${x},${y})`}>
      <Circle r={r} fill={color} />
      <Circle r={r * 0.55} fill={INK_HIGHLIGHT} />
      <Circle r={r * 0.25} fill={color} />
    </G>
  );
}

// ─── Pin 1 — lotus mandala ─────────────────────────────────────────
const LOTUS_PETAL = 'M 0 -16 Q 4 -10 0 -4 Q -4 -10 0 -16 Z';
const LOTUS_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function PinOne() {
  return (
    <G transform={`translate(${CX},${CY}) scale(${SC})`}>
      <Circle r={15} fill="none" stroke={INK_GREEN} strokeWidth={1} />
      {LOTUS_ANGLES.map((a) => (
        <Path
          key={a}
          d={LOTUS_PETAL}
          fill={INK_GREEN}
          transform={`rotate(${a})`}
          opacity={a % 90 === 0 ? 1 : 0.65}
        />
      ))}
      <Circle r={5} fill={INK_RED} />
      <Circle r={5} fill="none" stroke={INK_LOTUS_LITE} strokeWidth={0.8} />
      <Circle r={1.5} fill={INK_LOTUS_LITE} />
    </G>
  );
}

// ─── Sou 1 — sparrow on a twig ─────────────────────────────────────
function SouBird() {
  return (
    <G transform={`translate(${CX},${CY}) scale(${SC * 1.2})`}>
      {/* twig perch */}
      <Path d="M -14 14 L 14 14" stroke={INK_GREEN} strokeWidth={1.4} strokeLinecap="round" />
      <Path
        d="M -10 14 L -12 17 M 8 14 L 10 17"
        stroke={INK_GREEN}
        strokeWidth={1}
        strokeLinecap="round"
      />
      {/* legs */}
      <Line x1={-2} y1={11} x2={-2} y2={14} stroke={INK_BLACK} strokeWidth={0.9} />
      <Line x1={3} y1={11} x2={3} y2={14} stroke={INK_BLACK} strokeWidth={0.9} />
      {/* body */}
      <Ellipse cx={-1} cy={3} rx={9} ry={7} fill={INK_GREEN} />
      {/* wing */}
      <Path d="M -3 1 Q 4 -1 6 6 Q 0 8 -3 1 Z" fill={INK_DEEP_GR} />
      <Path d="M -1 3 Q 3 2 5 5" stroke={INK_HIGHLIGHT} strokeWidth={0.5} fill="none" />
      {/* head */}
      <Circle cx={-7} cy={-3} r={5} fill={INK_RED} />
      {/* eye */}
      <Circle cx={-8} cy={-4} r={0.9} fill="white" />
      <Circle cx={-8} cy={-4} r={0.45} fill={INK_BLACK} />
      {/* beak */}
      <Path d="M -12 -3 L -15 -2 L -12 -1 Z" fill={INK_BLACK} />
      {/* tail */}
      <Path d="M 8 4 L 13 2 L 13 7 L 8 6 Z" fill={INK_GREEN} />
    </G>
  );
}

// ─── Suit dispatchers ──────────────────────────────────────────────
function PinSvg({ rank }: { rank: number }) {
  if (rank === 1) return <PinOne />;
  const layout = PIN_LAYOUTS[rank] ?? [];
  const reds = PIN_RED[rank] ?? [];
  const blacks = PIN_BLACK[rank] ?? [];
  const r = rank <= 4 ? 5.5 : rank <= 6 ? 4.6 : 3.8;
  return (
    <G transform={`translate(${CX},${CY}) scale(${SC})`}>
      {layout.map(([x, y], i) => {
        const color = blacks.includes(i) ? INK_BLACK : reds.includes(i) ? INK_RED : INK_GREEN;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: layout is fixed per rank
          <PinDot key={i} x={x} y={y} r={r} color={color} />
        );
      })}
    </G>
  );
}

function SouSvg({ rank }: { rank: number }) {
  if (rank === 1) return <SouBird />;
  const layout = SOU_LAYOUTS[rank] ?? [];
  const reds = SOU_RED[rank] ?? [];
  // Smaller ranks need bigger rods (each is the only thing on the
  // tile); the 7×/8×/9× layouts use a slimmer rod so all 7-9 fit.
  const stickScale = rank <= 3 ? 1.0 : rank <= 6 ? 0.88 : 0.7;
  return (
    <G transform={`translate(${CX},${CY}) scale(${SC})`}>
      {layout.map(([x, y, rot = 0], i) => (
        <BambooStick
          // biome-ignore lint/suspicious/noArrayIndexKey: layout is fixed per rank
          key={i}
          x={x}
          y={y}
          rot={rot}
          color={reds.includes(i) ? INK_RED : INK_GREEN}
          scale={stickScale}
        />
      ))}
    </G>
  );
}

// ─── White dragon — empty frame ────────────────────────────────────
const WHITE_DRAGON_W = W * 0.56;
const WHITE_DRAGON_H = H * 0.62;
const WHITE_DRAGON_BORDER = W * 0.04;

function WhiteDragonFrame() {
  return (
    <Rect
      x={(W - WHITE_DRAGON_W) / 2}
      y={(H - WHITE_DRAGON_H) / 2}
      width={WHITE_DRAGON_W}
      height={WHITE_DRAGON_H}
      rx={WHITE_DRAGON_BORDER}
      fill="none"
      stroke={INK_BLACK}
      strokeWidth={WHITE_DRAGON_BORDER}
    />
  );
}

// ─── Man numeral + 萬 ──────────────────────────────────────────────
function ManText({ rank, scale }: { rank: number; scale: number }) {
  // Chinese numeral ((`一` … `九`)) sits in the upper third in INK_BLACK,
  // 萬 sits in the lower third in INK_RED. The flex-grown gap between
  // them keeps either line from crowding the other across all tile
  // sizes (down to the 22×30 SeatDiscardPile).
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
        paddingTop: '10%',
        paddingBottom: '14%',
        pointerEvents: 'none',
      }}
    >
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: SERIF_FAMILY,
          fontSize: 18 * scale,
          fontWeight: '700',
          color: INK_BLACK,
          lineHeight: 18 * scale,
          textAlign: 'center',
        }}
      >
        {CHINESE_NUM[rank]}
      </Text>
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: SERIF_FAMILY,
          fontSize: 12 * scale,
          fontWeight: '700',
          color: INK_RED,
          lineHeight: 12 * scale,
          textAlign: 'center',
        }}
      >
        萬
      </Text>
    </View>
  );
}

// ─── Wind / red+green dragon glyph ─────────────────────────────────
// 'B' (white dragon) is rendered by `WhiteDragonFrame` as an SVG
// rect — intentionally absent from this table.
const HONOR_GLYPH_INK: Record<Exclude<Honor, 'B'>, { glyph: string; color: string }> = {
  E: { glyph: WIND_GLYPH.E, color: INK_BLACK },
  S: { glyph: WIND_GLYPH.S, color: INK_BLACK },
  W: { glyph: WIND_GLYPH.W, color: INK_BLACK },
  N: { glyph: WIND_GLYPH.N, color: INK_BLACK },
  Z: { glyph: '中', color: INK_RED },
  F: { glyph: '發', color: INK_GREEN },
};

function HonorText({ honor, scale }: { honor: Exclude<Honor, 'B'>; scale: number }) {
  const { glyph, color } = HONOR_GLYPH_INK[honor];
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
          fontSize: 24 * scale,
          fontWeight: '700',
          color,
          lineHeight: 26 * scale,
        }}
      >
        {glyph}
      </Text>
    </View>
  );
}
