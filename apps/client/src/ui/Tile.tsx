import { type Tile as MTile, tileLabel } from '@mahjong/game-logic';
import { memo } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useGame } from '../state/game';
import { FlipView } from './FlipBag';
import { TileGlyph } from './TileGlyph';
import { TILE_BACK_SKINS } from './match/skins';

interface TileProps {
  tile: MTile;
  faceDown?: boolean | undefined;
  selected?: boolean | undefined;
  /** Slightly raise the tile (used by the drawn-tile glow + hover states). */
  raised?: boolean | undefined;
  /** Soften brightness/saturation for dead/discarded states. */
  dim?: boolean | undefined;
  onPress?: (() => void) | undefined;
  /** Rotation in degrees — used to lay opponent hands flat. */
  rotate?: number | undefined;
  /** Tile width in px. Defaults to 36. */
  width?: number | undefined;
  /** Tile height in px. Defaults to 50. */
  height?: number | undefined;
  /** Optional outer style. */
  style?: ViewStyle;
  /** RN test id (used by Playwright via web target / Detox). */
  testID?: string | undefined;
  /** When set, wraps the tile body in `<FlipView>` so it auto-FLIPs via
   *  the FlipBag cache when its position changes (e.g. wall→hand on
   *  draw, hand→discard, discard→meld, between-hand dispense). Use the
   *  engine `tileId` so identity survives across components. Omit for
   *  decorative / static tile renders that shouldn't animate. */
  flipId?: string | undefined;
  /** How far this tile floats above its surface — drives an outer cast
   *  shadow on the wrapper. Defaults to `'flat'` (no shadow) for
   *  decorative / face-down strip tiles. `'discard'` sits close to the
   *  felt; `'hand'` reads as raised plastic above it. */
  elevation?: 'flat' | 'discard' | 'hand' | undefined;
  /** Which edge of the tile (in tile space, pre-rotation) carries the
   *  visible 3D thickness (the cream side strip the face rests on)
   *  plus the cast drop shadow. Defaults to `'bottom'` — face on top,
   *  thickness below, shadow cast downward, matching a viewer looking
   *  down at the tile with light from above.
   *
   *  `SeatDiscardPile` rotates each opponent's pile (top 180°, left
   *  90°, right -90°) so the bottom-of-tile side strip ends up
   *  pointing AWAY from the felt centre / player. Passing `'top'`
   *  there pre-flips the strip + shadow + glyph anchor so after the
   *  rotation the thickness reads toward the felt centre instead.
   *  Same prop drives left/right piles even though their rotated
   *  result is a vertical strip — the in-tile-space layout is
   *  identical, only the outer rotation differs. */
  shadowEdge?: 'bottom' | 'top' | undefined;
}

/** Directional cast shadow per `elevation` value. Y offsets are
 *  positive (shadow falls below the tile) when `shadowEdge: 'bottom'`,
 *  and negated when `shadowEdge: 'top'` so a 180° outer rotation
 *  still lands the cast shadow on the screen-bottom edge. */
const ELEVATION_SHADOW_OFFSET: Record<
  NonNullable<TileProps['elevation']>,
  { dy: number; blur: number; alpha: number } | null
> = {
  flat: null,
  discard: { dy: 1, blur: 2, alpha: 0.15 },
  hand: { dy: 2, blur: 4, alpha: 0.18 },
};

/**
 * Tile corner radius as a fraction of the rendered width. Matches the
 * SVG face's `rx` (so the rounded silhouette in vector + the rounded
 * shadow / border around the wrapper are the same shape). Any element
 * that draws a halo, border, or box-shadow around a tile body should
 * trace `width * TILE_CORNER_RADIUS_RATIO`; otherwise the decoration
 * squares off at the corners while the tile face stays rounded.
 */
export const TILE_CORNER_RADIUS_RATIO = 0.18;

/**
 * Renders a single tile face or back as layered SVG with a
 * `<TileGlyph>` overlay. When `flipId` is set, the tile is wrapped in
 * a `<FlipView>` so the surrounding `FlipBagProvider` can animate it
 * from its previous screen rect on layout — the layoutId-style FLIP
 * that drives wall→hand on draw, hand→discard, discard→meld, and the
 * between-hand dispense.
 *
 * The viewBox is 36×50 (matches the legacy reference); the outer
 * container scales via `width` / `height` props.
 *
 * Memoised so a tile only re-renders when its props change.
 */
function TileComponent({
  tile,
  faceDown,
  selected,
  raised,
  dim,
  onPress,
  rotate,
  width = 36,
  height = 50,
  style,
  testID,
  flipId,
  elevation = 'flat',
  shadowEdge = 'bottom',
}: TileProps) {
  // Subscribe to the user's tile-back skin so face-down tiles repaint
  // when the SettingsPanel changes it. The selector returns a string id
  // so unrelated settings changes (felt, sound) don't re-render every
  // tile — only flips of `tileBack` itself trigger a re-render.
  const tileBackId = useGame((s) => s.settings.tileBack);
  const lift = selected ? -10 : raised ? -4 : 0;
  // Compose the cast shadow from elevation + the gold raised-glow. RN's
  // `boxShadow` takes a comma-separated CSS-string just like the web
  // form, so multiple shadows stack naturally.
  const shadows: string[] = [];
  const elevationOffset = ELEVATION_SHADOW_OFFSET[elevation];
  if (elevationOffset) {
    const dy = shadowEdge === 'top' ? -elevationOffset.dy : elevationOffset.dy;
    shadows.push(`0px ${dy}px ${elevationOffset.blur}px rgba(0,0,0,${elevationOffset.alpha})`);
  }
  if (raised) shadows.push('0px 0px 8px rgba(220,159,79,0.7)');
  const wrapperStyle: ViewStyle = {
    width,
    height,
    // Match the SVG face's rx so the cast shadow follows the tile
    // silhouette rather than protruding past the rounded corners as
    // square chunks. No-op visually when no shadow is rendered.
    borderRadius: width * TILE_CORNER_RADIUS_RATIO,
    transform: [{ rotate: `${rotate ?? 0}deg` }, { translateY: lift }],
    opacity: dim ? 0.85 : 1,
    ...(shadows.length > 0 && { boxShadow: shadows.join(', ') }),
    ...style,
  };

  const body = (
    <View style={wrapperStyle} accessibilityLabel={faceDown ? 'Face-down tile' : tileLabel(tile)}>
      <TileBody
        width={width}
        height={height}
        faceDown={faceDown}
        selected={selected}
        tileBackId={tileBackId}
        shadowEdge={shadowEdge}
      />
      {!faceDown ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            // Glyph anchors to the face rect's vertical extent. The
            // face occupies the top 92% of the tile when shadowEdge is
            // 'bottom' (default) and the bottom 92% when 'top'; the
            // glyph follows so it stays centred on the visible face,
            // not floating into the side-strip thickness.
            top: shadowEdge === 'top' ? '8%' : 0,
            bottom: shadowEdge === 'top' ? 0 : '8%',
            pointerEvents: 'none',
          }}
        >
          <TileGlyph t={tile} width={width} />
        </View>
      ) : null}
    </View>
  );

  // Inner element is either the static body or a Pressable wrapping it.
  const inner = onPress ? (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {body}
    </Pressable>
  ) : (
    body
  );
  // FLIP wrapping: when the caller passes `flipId`, every layout pass
  // checks the FlipBag cache and animates from the previously-recorded
  // screen rect. Skipped when `flipId` is undefined so decorative
  // tiles (lobby ScatteredTiles, ScoringBreakdownModal preview) don't
  // ride the animation pipeline.
  if (flipId !== undefined) {
    return <FlipView flipId={flipId}>{inner}</FlipView>;
  }
  return inner;
}

export const Tile = memo(TileComponent);

interface TileBodyProps {
  width: number;
  height: number;
  faceDown: boolean | undefined;
  selected: boolean | undefined;
  /** TileBack skin id from `useGame.settings.tileBack`. Drives the
   *  back gradient stops; ignored when `faceDown` is false. */
  tileBackId: keyof typeof TILE_BACK_SKINS;
  /** Which edge carries the cream side-strip thickness. See `TileProps.shadowEdge`. */
  shadowEdge: 'bottom' | 'top';
}

/** Layered SVG: side rect, face/back rect, NE-light bevel overlay, hairline stroke, optional selection ring. */
const TileBody = memo(function TileBody({
  width,
  height,
  faceDown,
  selected,
  tileBackId,
  shadowEdge,
}: TileBodyProps) {
  const tileBack = TILE_BACK_SKINS[tileBackId];
  // Reference geometry — the legacy Tile uses 36×50 with rx ≈ 18% of width.
  const W = 36;
  const H = 50;
  const R = W * TILE_CORNER_RADIUS_RATIO;
  // Layout swap for `shadowEdge`:
  //   'bottom' (default) → side rect spans [0.04H, H], face spans [0, 0.92H].
  //                        Visible thickness sits at the bottom 8%.
  //   'top'              → side rect spans [0, 0.96H], face spans [0.08H, H].
  //                        Visible thickness sits at the top 8% — used when
  //                        the consumer rotates the wrapper 180° so the
  //                        visible thickness lands on the screen-bottom edge.
  const sideY = shadowEdge === 'top' ? 0 : H * 0.04;
  const faceY = shadowEdge === 'top' ? H * 0.08 : 0;
  // Stable gradient ids per render — they're scoped to this <Svg> so
  // duplicates across tiles don't conflict, but the ids must be unique
  // *within* the SVG element.
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <Defs>
        <LinearGradient id="mj-tile-face" x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0%" stopColor="#fcfaf2" />
          <Stop offset="60%" stopColor="#f4eede" />
          <Stop offset="100%" stopColor="#e3dac6" />
        </LinearGradient>
        {/* Side-face vertical gradient: lighter near the lid (the face
            edge), darker at the tile's outer rim. Two flavours are
            defined in every tile's <Defs> so the rect can pick the
            right direction by id. We can't share a single id and just
            flip y1/y2 by `shadowEdge` — SVG fragment lookups via
            `url(#id)` resolve against the document, not the local
            <svg>, so the first matching gradient in DOM order wins
            for every tile. With a single id, a top-opp tile's flipped
            gradient leaks into every other tile on the felt (or vice
            versa). Stable per-direction ids keep each rendering
            consistent regardless of which tile renders first. */}
        <LinearGradient id="mj-tile-side-down" x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0%" stopColor="#d8ccb1" />
          <Stop offset="100%" stopColor="#a89572" />
        </LinearGradient>
        <LinearGradient id="mj-tile-side-up" x1="0" x2="0" y1="1" y2="0">
          <Stop offset="0%" stopColor="#d8ccb1" />
          <Stop offset="100%" stopColor="#a89572" />
        </LinearGradient>
        <LinearGradient id="mj-tile-back" x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0%" stopColor={tileBack.top} />
          <Stop offset="100%" stopColor={tileBack.bottom} />
        </LinearGradient>
        {/* Diagonal NE→SW rim light. Stops cluster at the corners so
            most of the face surface stays untouched and the bevel
            reads as edge highlighting + edge shadow, not a full
            diagonal wash. Single overlay = cheap; runs on top of any
            face/back fill so it composes with every tile-back skin. */}
        <LinearGradient id="mj-tile-bevel" x1="1" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <Stop offset="8%" stopColor="#ffffff" stopOpacity="0" />
          <Stop offset="92%" stopColor="#000000" stopOpacity="0" />
          <Stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
        </LinearGradient>
      </Defs>
      {/* side (visible thickness — face is drawn over it on the opposite edge) */}
      <Rect
        x={0}
        y={sideY}
        width={W}
        height={H * 0.96}
        rx={R}
        fill={shadowEdge === 'top' ? 'url(#mj-tile-side-up)' : 'url(#mj-tile-side-down)'}
      />
      {/* face / back */}
      <Rect
        x={0}
        y={faceY}
        width={W}
        height={H * 0.92}
        rx={R}
        fill={faceDown ? 'url(#mj-tile-back)' : 'url(#mj-tile-face)'}
      />
      {/* NE-light rim bevel — overlays the face/back rect, follows the
          same rounded shape so it doesn't bleed past the corners. */}
      <Rect x={0} y={faceY} width={W} height={H * 0.92} rx={R} fill="url(#mj-tile-bevel)" />
      {/* hairline stroke */}
      <Rect
        x={1.2}
        y={faceY + 1.2}
        width={W - 2.4}
        height={H * 0.92 - 2.4}
        rx={R - 1}
        fill="none"
        stroke={faceDown ? 'rgba(255,255,255,0.18)' : '#cdc1ad'}
        strokeWidth={0.8}
      />
      {selected ? (
        <Rect
          x={-1}
          y={faceY - 1}
          width={W + 2}
          height={H * 0.92 + 2}
          rx={R + 1}
          fill="none"
          stroke="#d77b58"
          strokeWidth={2.5}
        />
      ) : null}
    </Svg>
  );
});
