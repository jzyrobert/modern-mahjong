import { FAAN_OPTIONS } from '@mahjong/game-logic';
import type { Action, RuleConfig } from '@mahjong/protocol';
import { useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';

interface RulePanelProps {
  rules: RuleConfig;
  isHost: boolean;
  onAction: (a: Action) => void;
}

const TURN_TIMER_OFF = 0;
const TURN_TIMER_DEFAULT_MS = 20_000;

const COLORS = {
  paper: '#f1ebe0',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
  ink: '#3a3328',
  ink3: '#918275',
  red: '#b14d3a',
  green: '#58c280',
};

/**
 * Match-rules editor. Native port of `_legacy/src/ui/RulePanel.tsx`.
 * Faan-min becomes a row of selectable chips, the boolean rule flags
 * become RN `Switch`es, and the seconds inputs become numeric
 * `TextInput`s — there's no native `<select>` / `<input type="number">`
 * on RN, and pulling in `@react-native-picker/picker` for one
 * three-option enum is overkill.
 */
export function RulePanel({ rules, isHost, onAction }: RulePanelProps) {
  const set = (patch: Partial<RuleConfig>) => onAction({ t: 'setRules', rules: patch });
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
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {FAAN_OPTIONS.map((n) => {
            const active = rules.faanMin === n;
            return (
              <Pressable
                key={n}
                disabled={disabled}
                onPress={() => set({ faanMin: n as RuleConfig['faanMin'] })}
                style={({ pressed }) => ({
                  borderWidth: 1,
                  borderColor: active ? COLORS.red : COLORS.hairline,
                  backgroundColor: active ? '#fbe5d9' : pressed && !disabled ? '#ece4d3' : 'white',
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
        label="Allow 七對 (seven pairs)"
        value={rules.allowSevenPairs}
        onChange={(v) => set({ allowSevenPairs: v })}
        disabled={disabled}
      />
      <ToggleRow
        label="Allow 十三幺 (thirteen orphans)"
        value={rules.allowThirteenOrphans}
        onChange={(v) => set({ allowThirteenOrphans: v })}
        disabled={disabled}
      />
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
      <SecondsInput
        key={rules.claimWindowMs}
        label="Claim window"
        disabled={disabled}
        ms={rules.claimWindowMs}
        min={1}
        max={15}
        onCommit={(ms) => set({ claimWindowMs: ms })}
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
