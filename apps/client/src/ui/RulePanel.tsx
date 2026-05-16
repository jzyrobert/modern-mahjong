import { FAAN_OPTIONS } from '@mahjong/game-logic';
import type { Action, RuleConfig } from '@mahjong/protocol';
import { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useGame } from '../state/game';
import { COLORS } from './colors';

interface RulePanelProps {
  rules: RuleConfig;
  isHost: boolean;
  onAction: (a: Action) => void;
}

const TURN_TIMER_OFF = 0;
const TURN_TIMER_DEFAULT_MS = 20_000;

/**
 * Match-rules editor.
 * Faan-min becomes a row of selectable chips and turn-timer surfaces
 * as a switch + seconds input. Seven-pairs and thirteen-orphans no
 * longer have their own toggles — both shapes are always legal — and
 * the auto-sort behaviour setting is gone too (initial sort is always
 * `'suit'`; the SortPicker overrides immediately if the user wants
 * something else).
 *
 * Every host-side edit also writes faanMin + turnTimeoutMs into
 * `settings.lobbyRulePrefs` via `setSettings`, so the user's chosen
 * values stick across matches — the lobby's `useEffect` re-applies
 * them via `setRules` on the next match's first paint.
 */
export function RulePanel({ rules, isHost, onAction }: RulePanelProps) {
  const setSettings = useGame((s) => s.setSettings);
  const lobbyPrefs = useGame((s) => s.settings.lobbyRulePrefs);
  const set = (patch: Partial<RuleConfig>) => {
    onAction({ t: 'setRules', rules: patch });
    // Mirror the persisted lobby prefs whenever the host edits a
    // field the prefs care about. Anything else (claim windows,
    // allow* flags) is per-match and doesn't need to stick.
    const prefsPatch: Partial<typeof lobbyPrefs> = {};
    if (patch.faanMin !== undefined) prefsPatch.faanMin = patch.faanMin;
    if (patch.turnTimeoutMs !== undefined) prefsPatch.turnTimeoutMs = patch.turnTimeoutMs;
    if (Object.keys(prefsPatch).length > 0) {
      setSettings({ lobbyRulePrefs: { ...lobbyPrefs, ...prefsPatch } });
    }
  };
  const disabled = !isHost;
  const turnTimerOff = rules.turnTimeoutMs === TURN_TIMER_OFF;

  return (
    <View
      style={{
        backgroundColor: COLORS.paper,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        padding: 14,
        marginVertical: 12,
        gap: 12,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.ink, opacity: 0.85 }}>
        Rules
      </Text>

      <Row label="Minimum faan">
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Minimum faan"
          style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}
        >
          {FAAN_OPTIONS.map((n) => {
            const active = rules.faanMin === n;
            return (
              <Pressable
                key={n}
                disabled={disabled}
                onPress={() => set({ faanMin: n as RuleConfig['faanMin'] })}
                accessibilityRole="radio"
                accessibilityLabel={`Minimum faan: ${n}`}
                accessibilityState={{ selected: active, disabled }}
                style={({ pressed }) => ({
                  borderWidth: 1,
                  borderColor: active ? COLORS.red : COLORS.hairline,
                  backgroundColor: active
                    ? COLORS.accentSalmonSwatch
                    : pressed && !disabled
                      ? COLORS.creamLow
                      : 'white',
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  opacity: disabled ? 0.6 : 1,
                })}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: active ? '800' : '600',
                    color: active ? COLORS.red : COLORS.ink,
                  }}
                >
                  {n}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Row>

      <ToggleRow
        label="No turn timer (∞)"
        value={turnTimerOff}
        onChange={(v) => set({ turnTimeoutMs: v ? TURN_TIMER_OFF : TURN_TIMER_DEFAULT_MS })}
        disabled={disabled}
      />

      <SecondsInput
        key={turnTimerOff ? TURN_TIMER_DEFAULT_MS : rules.turnTimeoutMs}
        label="Turn timeout"
        disabled={disabled || turnTimerOff}
        ms={turnTimerOff ? TURN_TIMER_DEFAULT_MS : rules.turnTimeoutMs}
        min={5}
        max={120}
        onCommit={(ms) => set({ turnTimeoutMs: ms })}
      />

      {!isHost && (
        <Text style={{ fontSize: 11, color: COLORS.ink3, opacity: 0.6, marginTop: 4 }}>
          Only the lobby host can change rules.
        </Text>
      )}
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <Text style={{ width: 140, fontSize: 13, color: COLORS.ink }}>{label}</Text>
      <View style={{ flex: 1, minWidth: 120 }}>{children}</View>
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ flex: 1, fontSize: 13, color: COLORS.ink }}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
        trackColor={{ true: COLORS.green, false: COLORS.hairline }}
      />
    </View>
  );
}

interface SecondsInputProps {
  label: string;
  disabled: boolean;
  ms: number;
  min: number;
  max: number;
  onCommit: (ms: number) => void;
}

function SecondsInput({ label, disabled, ms, min, max, onCommit }: SecondsInputProps) {
  const [draft, setDraft] = useState(() => String(Math.round(ms / 1000)));

  const commit = () => {
    const parsed = Number(draft);
    const clamped = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min;
    setDraft(String(clamped));
    if (clamped * 1000 !== ms) onCommit(clamped * 1000);
  };

  return (
    <Row label={label}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={commit}
          editable={!disabled}
          keyboardType="numeric"
          style={{
            width: 64,
            paddingVertical: 6,
            paddingHorizontal: 8,
            borderRadius: 6,
            borderColor: COLORS.hairline,
            borderWidth: 1,
            backgroundColor: COLORS.paperHi,
            color: COLORS.ink,
            fontSize: 13,
            opacity: disabled ? 0.5 : 1,
          }}
        />
        <Text style={{ fontSize: 13, color: COLORS.ink3 }}>seconds</Text>
      </View>
    </Row>
  );
}
