import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

/**
 * Inline stroke icons for the lobby + replay library. Strokes paint
 * with `color` so the parent's text colour flows through. No emoji,
 * no bitmap assets (asset policy §5).
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

/** Right-chevron affordance for tappable rows. */
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

export function ChevronLeftIcon({ size = 12, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={Math.round(size * (16 / 12))} viewBox="0 0 12 16" fill="none">
      <Path
        d="M8 4L4 8l4 4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Mortarboard — the Tutorial card. */
export function TutorialIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M2 9l10-5 10 5-10 5L2 9z" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      <Path d="M6 11v4c0 1.5 3 3 6 3s6-1.5 6-3v-4" stroke={color} strokeWidth={2.2} />
      <Line x1={20} y1={9} x2={20} y2={14} stroke={color} strokeWidth={2.2} />
    </Svg>
  );
}

export function CheckIcon({ size = 12, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Die face (five pips) — used for the practice / dice motifs. */
export function DiceIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3} width={18} height={18} rx={4} stroke={color} strokeWidth={2.2} />
      <Circle cx={8} cy={8} r={1.4} fill={color} />
      <Circle cx={16} cy={8} r={1.4} fill={color} />
      <Circle cx={12} cy={12} r={1.4} fill={color} />
      <Circle cx={8} cy={16} r={1.4} fill={color} />
      <Circle cx={16} cy={16} r={1.4} fill={color} />
    </Svg>
  );
}

export function ImportIcon({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3v11" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Path
        d="M8 10l4 4 4-4"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke={color} strokeWidth={2.2} />
    </Svg>
  );
}

export function TrashIcon({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 7h16M10 11v6M14 11v6" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Path
        d="M6 7l1 13h10l1-13M9 7V4h6v3"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function TrophyIcon({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 4h10v5a5 5 0 0 1-10 0V4z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      <Path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" stroke={color} strokeWidth={2.2} />
      <Path d="M12 14v4M8 21h8M9 18h6" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function SoundIcon({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 9v6h4l5 4V5L8 9H4z" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      <Path
        d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function UserIcon({ size = 14, color = 'currentColor' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={2.2} />
      <Path d="M4 21a8 8 0 0 1 16 0" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}
