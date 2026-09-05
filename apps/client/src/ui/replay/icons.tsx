import Svg, { Line, Path, Rect } from 'react-native-svg';

/**
 * Transport + chrome icons for the glass replay player — inline strokes
 * that paint with `color`, like `menu/icons.tsx` (asset policy §5: no
 * emoji, no bitmaps). The paper scrubber keeps its text glyphs.
 */
interface IconProps {
  size?: number;
  color?: string;
}

export function SkipBackIcon({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="6" y1="5" x2="6" y2="19" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M19 5v14L9 12l10-7z" fill={color} />
    </Svg>
  );
}

export function SkipForwardIcon({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="18" y1="5" x2="18" y2="19" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M5 5v14l10-7L5 5z" fill={color} />
    </Svg>
  );
}

export function StepBackIcon({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M16 5v14L6 12l10-7z" fill={color} />
    </Svg>
  );
}

export function StepForwardIcon({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8 5v14l10-7L8 5z" fill={color} />
    </Svg>
  );
}

export function PlayGlyphIcon({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8 5v14l11-7L8 5z" fill={color} />
    </Svg>
  );
}

export function PauseIcon({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="6" y="5" width="4" height="14" rx="1" fill={color} />
      <Rect x="14" y="5" width="4" height="14" rx="1" fill={color} />
    </Svg>
  );
}

/** Arrow up out of a tray — copy to clipboard. */
export function ExportIcon({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}
