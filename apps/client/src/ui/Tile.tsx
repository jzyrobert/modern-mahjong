import { type Tile as MTile, tileLabel } from '@mahjong/game-logic';
import { memo } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useGame } from '../state/game';
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
}

/**
 * Native port of `_legacy/src/ui/Tile.tsx`. Renders a single tile face
 * or back as layered SVG with a `<TileGlyph>` overlay. Animations
 * (framer-motion's spring / `layoutId` / press scale) are deferred to
 * Phase 6 — for now Pressable handles the tap, no spring on transitions.
 *
 * The viewBox is 36×50 (matches the legacy reference); the outer
 * container scales via `width` / `height` props. Same proportions
 * as the legacy `--tile-w` / `--tile-h` CSS vars.
 *
 * Memoised so a tile only re-renders when its props change. The
 * legacy `shuffling`-driven slow-spring transition behaviour is
 * Phase 6 territory; for Phase 4 we keep it static.
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
}: TileProps) {
  // Subscribe to the user's tile-back skin so face-down tiles repaint
  // when the SettingsPanel changes it. The selector returns a string id
  // so unrelated settings changes (felt, autoSort) don't re-render every
  // tile — only flips of `tileBack` itself trigger a re-render.
  const tileBackId = useGame((s) => s.settings.tileBack);
  const lift = selected ? -10 : raised ? -4 : 0;
  const wrapperStyle: ViewStyle = {
    width,
    height,
    transform: [{ rotate: `${rotate ?? 0}deg` }, { translateY: lift }],
    opacity: dim ? 0.85 : 1,
    ...(raised && {
      shadowColor: '#dc9f4f',
      shadowOpacity: 0.7,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    }),
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
      />
      {!faceDown ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: '8%',
          }}
        >
          <TileGlyph t={tile} />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {body}
    </Pressable>
  );
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
}

/** Layered SVG: shadow rect, side rect, face/back rect, hairline stroke, optional selection ring. */
const TileBody = memo(function TileBody({
  width,
  height,
  faceDown,
  selected,
  tileBackId,
}: TileBodyProps) {
  const tileBack = TILE_BACK_SKINS[tileBackId];
  // Reference geometry — the legacy Tile uses 36×50 with rx ≈ 18% of width.
  const W = 36;
  const H = 50;
  const R = W * 0.18;
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
          <Stop offset="0%" stopColor="#fbf8f0" />
          <Stop offset="100%" stopColor="#e8e0cf" />
        </LinearGradient>
        <LinearGradient id="mj-tile-side" x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0%" stopColor="#d8ccb1" />
          <Stop offset="100%" stopColor="#bfae8c" />
        </LinearGradient>
        <LinearGradient id="mj-tile-back" x1="0" x2="0" y1="0" y2="1">
          <Stop offset="0%" stopColor={tileBack.top} />
          <Stop offset="100%" stopColor={tileBack.bottom} />
        </LinearGradient>
      </Defs>
      {/* drop shadow */}
      <Rect x={1} y={H * 0.08} width={W - 2} height={H * 0.95} rx={R} fill="rgba(80,60,40,0.18)" />
      {/* side */}
      <Rect x={0} y={H * 0.04} width={W} height={H * 0.96} rx={R} fill="url(#mj-tile-side)" />
      {/* face / back */}
      <Rect
        x={0}
        y={0}
        width={W}
        height={H * 0.92}
        rx={R}
        fill={faceDown ? 'url(#mj-tile-back)' : 'url(#mj-tile-face)'}
      />
      {/* hairline stroke */}
      <Rect
        x={1.2}
        y={1.2}
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
          y={-1}
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
