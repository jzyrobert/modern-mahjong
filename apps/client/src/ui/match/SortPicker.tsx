import { Pressable, Text, View } from 'react-native';

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

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
  red: '#b14d3a',
};

/**
 * Three-way segmented picker for the user's hand sort mode. Native
 * port of `_legacy/src/ui/match/SortPicker.tsx`. The 'manual' option
 * is rendered but a no-op until Phase 5 wires up drag-to-reorder.
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
              backgroundColor: active ? '#fbe5d9' : pressed ? '#ece4d3' : 'transparent',
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
