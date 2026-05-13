import { Pressable, Text, View } from 'react-native';
import { COLORS } from '../colors';

export type SortMode = 'suit' | 'num' | 'manual';

interface SortPickerProps {
  mode: SortMode;
  onChange: (m: SortMode) => void;
  /** Landscape mobile collapses the 3-button segmented picker into a
   *  single cycle button — saves ~120 px of horizontal room in the
   *  bottom row so the hand sits on a single line at 393 px tall.
   *  Tapping rotates through suit → num → manual → suit. */
  compact?: boolean;
}

const OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'suit', label: 'Suit' },
  { id: 'num', label: 'Number' },
  { id: 'manual', label: 'Manual' },
];

const COMPACT_GLYPH: Record<SortMode, string> = {
  suit: 'S',
  num: '#',
  manual: 'M',
};

const ORDER: readonly SortMode[] = ['suit', 'num', 'manual'];

/**
 * Three-way segmented picker for the user's hand sort mode. In
 * 'manual' mode `HandTile`'s long-press / movement gesture writes
 * through `useGame.setManualOrder`; in 'suit' / 'number' mode the
 * engine order is sorted client-side before render. The `compact`
 * variant collapses the segmented picker to a single cycle button —
 * see `MobileShell.tsx`'s landscape branch.
 */
export function SortPicker({ mode, onChange, compact = false }: SortPickerProps) {
  if (compact) {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] ?? 'suit';
    const meta = OPTIONS.find((o) => o.id === mode) ?? OPTIONS[0]!;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Sort mode: ${meta.label}. Tap to cycle.`}
        onPress={() => onChange(next)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingVertical: 6,
          paddingHorizontal: 10,
          borderRadius: 8,
          backgroundColor: pressed ? COLORS.creamLow : COLORS.paperHi,
          borderColor: COLORS.hairline,
          borderWidth: 1,
        })}
      >
        <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.ink, letterSpacing: 0.4 }}>
          ⇅
        </Text>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '800',
            color: COLORS.red,
            letterSpacing: 0.4,
          }}
        >
          {COMPACT_GLYPH[mode]}
        </Text>
      </Pressable>
    );
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        padding: 2,
      }}
    >
      {OPTIONS.map((o) => {
        const active = mode === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            style={({ pressed }) => ({
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: 6,
              backgroundColor: active
                ? COLORS.accentSalmonSwatch
                : pressed
                  ? COLORS.creamLow
                  : 'transparent',
            })}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: active ? '800' : '600',
                color: active ? COLORS.red : COLORS.ink,
                letterSpacing: 0.4,
              }}
            >
              {o.label.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
