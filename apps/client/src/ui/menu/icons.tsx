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

/**
 * Right-chevron affordance for tappable rows (Tutorial / LAN /
 * Replays in MobileLobby). Body-text weight (stroke 2) so the glyph
 * reads as quiet UI chrome rather than competing with the row's
 * title. Stroked from `color` so the parent's `color: COLORS.ink3`
 * flows through. `viewBox` is 12 wide / 16 tall so the chevron sits
 * vertically centred against the typical 12-13 px row title.
 */
export function ChevronRightIcon({ size = 12, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={Math.round(size * (16 / 12))} viewBox="0 0 12 16" fill="none">
      <Path
        d="M4 4l4 4-4 4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Mortarboard / cap icon — the Tutorial card. Two strokes form the
 *  diamond mortar plus a simple tassel; a horizontal underline hints
 *  at the cap's base. Same line-weight as the rest of the icon set
 *  so the row reads as a coherent group. */
export function TutorialIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M2 9l10-5 10 5-10 5L2 9z" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      <Path d="M6 11v4c0 1.5 3 3 6 3s6-1.5 6-3v-4" stroke={color} strokeWidth={2.2} />
      <Line x1={20} y1={9} x2={20} y2={14} stroke={color} strokeWidth={2.2} />
    </Svg>
  );
}
