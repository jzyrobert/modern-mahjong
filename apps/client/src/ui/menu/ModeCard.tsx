import type { ReactNode } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { GlassCard } from './GlassCard';
import { MENU, TYPE } from './theme';

interface ModeCardProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  /** Gold-tinted icon swatch for the primary (Online) entry. */
  accent?: boolean;
  children: ReactNode;
  /** Phone cards use 12 (the legacy layout spec pins it); desktop 16. */
  radius?: number;
  /** Compact header for the phone layout. */
  compact?: boolean;
  quiet?: boolean;
  style?: ViewStyle | undefined;
  testID?: string | undefined;
}

/**
 * Glass mode card — icon swatch, title, one-line subtitle, then the
 * per-mode controls. Used for Online / Practice / Tutorial / LAN /
 * Replays on both layouts.
 */
export function ModeCard({
  title,
  subtitle,
  icon,
  accent = false,
  children,
  radius = 16,
  compact = false,
  quiet = false,
  style,
  testID,
}: ModeCardProps) {
  return (
    <GlassCard
      quiet={quiet}
      radius={radius}
      testID={testID}
      style={{
        padding: compact ? 14 : 20,
        gap: compact ? 10 : 14,
        ...style,
      }}
    >
      <CardHeader title={title} subtitle={subtitle} icon={icon} accent={accent} compact={compact} />
      {children}
    </GlassCard>
  );
}

export function IconSwatch({
  icon,
  accent = false,
  size = 40,
}: { icon: ReactNode; accent?: boolean; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        backgroundColor: accent ? MENU.goldTint : MENU.fill,
        borderColor: accent ? MENU.goldEdge : MENU.hairline,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {icon}
    </View>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  accent = false,
  compact = false,
  trailing,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  accent?: boolean;
  compact?: boolean;
  trailing?: ReactNode | undefined;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 10 : 12 }}>
      <IconSwatch icon={icon} accent={accent} size={compact ? 34 : 40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[TYPE.cardTitle, compact ? { fontSize: 15, lineHeight: 18 } : null]}>
          {title}
        </Text>
        <Text
          style={[
            TYPE.cardSubtitle,
            compact ? { fontSize: 11, lineHeight: 14 } : null,
            { marginTop: 2 },
          ]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
      {trailing}
    </View>
  );
}

/**
 * Column layout for the desktop lobby — cards flow into `columns`
 * independent vertical stacks (masonry-ish) so a tall Tutorial card
 * doesn't stretch its row neighbours' content. Columns stretch to the
 * tallest, so a `flex: 1` last card lets every column end on one line.
 */
export function Columns({
  columns,
  children,
  gap = 14,
  maxWidth = 1120,
  paddingHorizontal = 24,
}: {
  columns: ReactNode[][];
  children?: never;
  gap?: number;
  maxWidth?: number;
  paddingHorizontal?: number;
}) {
  return (
    <View style={{ maxWidth, width: '100%', alignSelf: 'center', paddingHorizontal }}>
      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap }}>
        {columns.map((col, i) => (
          <View key={`col-${i}-${col.length}`} style={{ flex: 1, minWidth: 0, gap }}>
            {col}
          </View>
        ))}
      </View>
    </View>
  );
}
