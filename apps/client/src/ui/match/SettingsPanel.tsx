import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { type FeltSkin, type TileBackSkin, type UserSettings, useGame } from '../../state/game';
import { Modal } from '../Modal';
import { FELT_SKINS, TILE_BACK_SKINS } from './skins';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  cream: '#f1eadc',
  hairline: '#cdc1ad',
  red: '#b14d3a',
};

/**
 * In-match preferences modal. v1 covers the controls that
 * actually affect the active match: felt skin picker, tile-back skin
 * picker, auto-sort toggle, sound toggle, animations toggle. Turn-timer
 * editor, GameLog button, and the 136-tile reference grid are deferred
 * (turn-timer needs `state.rules` round-trip; the tile reference is
 * decorative).
 *
 * Felt + tile-back picks flow through `useGame.setSettings`, which
 * persists to localStorage on every write — the legacy
 * `expo-sqlite/localStorage` polyfill keeps it durable on native.
 */
export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const settings = useGame((s) => s.settings);
  const setSettings = useGame((s) => s.setSettings);

  return (
    <Modal open={open} title="Settings" onClose={onClose} maxWidth={520}>
      <ScrollView contentContainerStyle={{ padding: 18, gap: 18 }}>
        <Section title="Felt skin">
          <FeltSwatchRow value={settings.felt} onChange={(felt) => setSettings({ felt })} />
        </Section>

        <Section title="Tile back">
          <TileBackSwatchRow
            value={settings.tileBack}
            onChange={(tileBack) => setSettings({ tileBack })}
          />
        </Section>

        <Section title="Behaviour">
          <ToggleRow
            label="Auto-sort hand"
            hint="Re-sort by suit on every state update."
            value={settings.autoSort}
            onChange={(autoSort) => setSettings({ autoSort })}
          />
          <ToggleRow
            label="Sound effects"
            hint="Discard thud + win fanfare."
            value={settings.sound}
            onChange={(sound) => setSettings({ sound })}
          />
          <ToggleRow
            label="Animations"
            hint="Override the OS reduced-motion preference."
            value={settings.animations}
            onChange={(animations) => setSettings({ animations })}
          />
        </Section>
      </ScrollView>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 11, fontWeight: '900', color: COLORS.ink3, letterSpacing: 0.6 }}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function FeltSwatchRow({ value, onChange }: { value: FeltSkin; onChange: (v: FeltSkin) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {(Object.keys(FELT_SKINS) as FeltSkin[]).map((id) => {
        const skin = FELT_SKINS[id];
        const selected = value === id;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: 6,
              paddingRight: 10,
              borderRadius: 10,
              borderWidth: 2,
              borderColor: selected ? COLORS.red : COLORS.hairline,
              backgroundColor: pressed ? COLORS.cream : 'transparent',
            })}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                backgroundColor: skin.top,
                borderWidth: 2,
                borderColor: skin.bottom,
              }}
            />
            <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.ink }}>{skin.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TileBackSwatchRow({
  value,
  onChange,
}: { value: TileBackSkin; onChange: (v: TileBackSkin) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {(Object.keys(TILE_BACK_SKINS) as TileBackSkin[]).map((id) => {
        const skin = TILE_BACK_SKINS[id];
        const selected = value === id;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              padding: 6,
              paddingRight: 10,
              borderRadius: 10,
              borderWidth: 2,
              borderColor: selected ? COLORS.red : COLORS.hairline,
              backgroundColor: pressed ? COLORS.cream : 'transparent',
            })}
          >
            <View
              style={{
                width: 22,
                height: 30,
                borderRadius: 4,
                backgroundColor: skin.top,
                borderWidth: 2,
                borderColor: skin.bottom,
              }}
            />
            <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.ink }}>{skin.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface ToggleRowProps {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, hint, value, onChange }: ToggleRowProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.ink }}>{label}</Text>
        <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600' }}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

// Re-export for callers that just want the per-key types (used by
// `useGame.setSettings` typing).
export type { UserSettings };
