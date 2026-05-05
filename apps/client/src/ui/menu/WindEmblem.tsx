import { Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

interface WindEmblemProps {
  /** Wind glyph to show on the emblem face — defaults to 東. */
  wind?: string;
  /** Width in px; height auto-derives from the tile aspect. */
  size?: number;
}

/**
 * Hero emblem on the lobby — a single ivory wind-tile with a deep-red
 * Chinese character on its face. Native port of
 * `_legacy/src/ui/menu/WindEmblem.tsx`. Decorative, no interaction.
 */
export function WindEmblem({ wind = '東', size = 100 }: WindEmblemProps) {
  const r = size * 0.14;
  const h = size * 1.32;
  return (
    <View
      style={{
        width: size,
        height: h,
        position: 'relative',
        // Match the SVG's rounded silhouette so the box-shadow (web) and
        // elevation (Android) cast a rounded shadow instead of a square
        // rectangle whose corners poked out around the tile.
        borderRadius: r,
        // RN drop-shadow lives on `shadow*` props (iOS) + `elevation` (Android)
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 18,
        elevation: 6,
      }}
    >
      <Svg width={size} height={h} viewBox={`0 0 ${size} ${h}`}>
        <Defs>
          <LinearGradient id="we-side" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0%" stopColor="#e3d8c0" />
            <Stop offset="100%" stopColor="#bfae8c" />
          </LinearGradient>
          {/* Face gradient straddles the lobby bg `#f1eadc` so the
              face reads as warm paper with subtle depth without
              looking like a different shade laid on the page. */}
          <LinearGradient id="we-face" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0%" stopColor="#f4ede0" />
            <Stop offset="100%" stopColor="#e6dec9" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={size * 0.05} width={size} height={size * 1.27} rx={r} fill="url(#we-side)" />
        <Rect x={0} y={0} width={size} height={size * 1.21} rx={r} fill="url(#we-face)" />
        <Rect
          x={2}
          y={2}
          width={size - 4}
          height={size * 1.21 - 4}
          rx={r - 1}
          fill="none"
          stroke="#cdc1ad"
          strokeWidth={1.2}
        />
      </Svg>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: size * 0.13,
        }}
        pointerEvents="none"
      >
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontWeight: '700',
            fontSize: size * 0.78,
            lineHeight: size * 0.78,
            color: '#b14d3a',
          }}
        >
          {wind}
        </Text>
      </View>
    </View>
  );
}
