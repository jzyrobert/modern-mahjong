import { Pressable, Text, View } from 'react-native';
import { COLORS } from '../colors';

export type SortMode = 'suit' | 'num' | 'manual';

interface SortPickerProps {
  mode: SortMode;
  onChange: (m: SortMode) => void;
}

const OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'suit', label: 'Suit' },
  { id: 'num', label: 'Number' },
  { id: 'manual', label: 'Manual' },
];

/**
 * Three-way segmented picker for the user's hand sort mode. In
 * 'manual' mode `HandTile`'s long-press / movement gesture writes
 * through `useGame.setManualOrder`; in 'suit' / 'number' mode the
 * engine order is sorted client-side before render.
 */
export function SortPicker({ mode, onChange }: SortPickerProps) {
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
