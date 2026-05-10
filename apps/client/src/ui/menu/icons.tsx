import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

/**
 * Inline icons for the lobby `ModeCard` rows. same path data, swapped to
 * `react-native-svg` primitives. Strokes paint with `color` so the
 * parent's text color flows through.
 */

interface IconProps {
  size?: number;
  color?: string;
}

export function GlobeIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2.2} />
      <Path
        d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"
        stroke={color}
        strokeWidth={2.2}
      />
    </Svg>
  );
}

export function BotIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={7} width={18} height={13} rx={2} stroke={color} strokeWidth={2.2} />
      <Path d="M8 7V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3" stroke={color} strokeWidth={2.2} />
      <Circle cx={9} cy={13} r={1.4} stroke={color} strokeWidth={2.2} />
      <Circle cx={15} cy={13} r={1.4} stroke={color} strokeWidth={2.2} />
      <Path d="M9 17h6" stroke={color} strokeWidth={2.2} />
    </Svg>
  );
}

export function WifiIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0"
        stroke={color}
        strokeWidth={2.2}
      />
      <Line x1={12} y1={20} x2={12.01} y2={20} stroke={color} strokeWidth={2.2} />
    </Svg>
  );
}

export function BoxIcon({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2l9 4.5v9L12 20l-9-4.5v-9z" stroke={color} strokeWidth={2} />
      <Path d="M12 22V12" stroke={color} strokeWidth={2} />
      <Path d="M21 7l-9 5-9-5" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

export function PlayIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8 5v14l11-7L8 5z" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
    </Svg>
  );
}
