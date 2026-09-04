import { FAAN_OPTIONS } from '@mahjong/game-logic';
import type { Action, RuleConfig } from '@mahjong/protocol';
import { createContext, useContext, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useGame } from '../state/game';
import { COLORS, SWITCH_TRACK } from './colors';

interface RulePanelProps {
  rules: RuleConfig;
  isHost: boolean;
  onAction: (a: Action) => void;
  /** `paper` (default) is the classic cream card; `glass` is the dark
   *  translucent surface the Three.js HUD uses. Logic is identical. */
  theme?: RulePanelTheme;
  /** Glass only: start collapsed to a one-line summary with a
   *  disclosure (keeps the between-hand result card short on phones). */
  collapsible?: boolean;
}

export type RulePanelTheme = 'paper' | 'glass';

interface RulePalette {
  bg: string;
  border: string;
  heading: string;
  label: string;
  hint: string;
  chipActiveBg: string;
  chipActiveBorder: string;
  chipActiveFg: string;
  chipBg: string;
  chipPressedBg: string;
  chipBorder: string;
  chipFg: string;
  inputBg: string;
  inputBorder: string;
  inputFg: string;
  track: { false: string; true: string };
}

const PALETTES: Record<RulePanelTheme, RulePalette> = {
  paper: {
    bg: COLORS.paper,
    border: COLORS.hairline,
    heading: COLORS.ink,
    label: COLORS.ink,
    hint: COLORS.ink3,
    chipActiveBg: COLORS.accentSalmonSwatch,
    chipActiveBorder: COLORS.red,
    chipActiveFg: COLORS.red,
    chipBg: 'white',
    chipPressedBg: COLORS.creamLow,
    chipBorder: COLORS.hairline,
    chipFg: COLORS.ink,
    inputBg: COLORS.paperHi,
    inputBorder: COLORS.hairline,
    inputFg: COLORS.ink,
    track: SWITCH_TRACK,
  },
  glass: {
    bg: 'rgba(255,255,255,0.045)',
    border: 'rgba(255,255,255,0.1)',
    heading: 'rgba(255,255,255,0.62)',
    label: 'rgba(255,255,255,0.86)',
    hint: 'rgba(255,255,255,0.55)',
    chipActiveBg: '#d8a85a',
    chipActiveBorder: 'rgba(255,235,190,0.55)',
    chipActiveFg: '#2a2418',
    chipBg: 'rgba(255,255,255,0.05)',
    chipPressedBg: 'rgba(216,168,90,0.22)',
    chipBorder: 'rgba(216,168,90,0.4)',
    chipFg: 'rgba(255,255,255,0.9)',
    inputBg: 'rgba(0,0,0,0.3)',
    inputBorder: 'rgba(255,255,255,0.16)',
    inputFg: 'rgba(255,255,255,0.92)',
    track: { false: 'rgba(255,255,255,0.18)', true: '#d8a85a' },
  },
};

const PaletteContext = createContext<RulePalette>(PALETTES.paper);

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
export function RulePanel({
  rules,
  isHost,
  onAction,
  theme = 'paper',
  collapsible = false,
}: RulePanelProps) {
  const pal = PALETTES[theme];
  const [open, setOpen] = useState(!collapsible);
  const setSettings = useGame((s) => s.setSettings);
  const set = (patch: Partial<RuleConfig>) => {
    onAction({ t: 'setRules', rules: patch });
    // Mirror the persisted lobby prefs whenever the host edits a
    // field the prefs care about. Anything else (claim windows,
    // allow* flags) is per-match and doesn't need to stick.
    //
    // Read live `lobbyRulePrefs` here rather than from a render-time
    // closure: two same-frame edits (e.g. faanMin chip + turn-timer
    // toggle clicked in quick succession) would otherwise each merge
    // their patch onto the same stale snapshot and the second write
    // would clobber the first. `useGame.getState()` returns the most
    // recent store value synchronously, so the second `set` sees the
    // first's persisted result and composes correctly.
    const prefsPatch: Partial<{ faanMin: RuleConfig['faanMin']; turnTimeoutMs: number }> = {};
    if (patch.faanMin !== undefined) prefsPatch.faanMin = patch.faanMin;
    if (patch.turnTimeoutMs !== undefined) prefsPatch.turnTimeoutMs = patch.turnTimeoutMs;
    if (Object.keys(prefsPatch).length > 0) {
      const liveLobbyPrefs = useGame.getState().settings.lobbyRulePrefs;
      setSettings({ lobbyRulePrefs: { ...liveLobbyPrefs, ...prefsPatch } });
    }
  };
  const disabled = !isHost;
  const turnTimerOff = rules.turnTimeoutMs === TURN_TIMER_OFF;

  const glass = theme === 'glass';
  const summary = `Min ${rules.faanMin} faan · ${
    turnTimerOff ? 'no timer' : `${Math.round(rules.turnTimeoutMs / 1000)} s turns`
  }`;
  const heading = glass ? (
    <Text
      style={{
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: pal.heading,
      }}
    >
      Rules
    </Text>
  ) : (
    <Text style={{ fontSize: 13, fontWeight: '700', color: pal.heading, opacity: 0.85 }}>
      Rules
    </Text>
  );

  return (
    <PaletteContext.Provider value={pal}>
      <View
        style={{
          backgroundColor: pal.bg,
          borderColor: pal.border,
          borderWidth: 1,
          borderRadius: glass ? 14 : 8,
          padding: glass ? 12 : 14,
          marginVertical: glass ? 8 : 12,
          gap: 12,
        }}
      >
        {collapsible ? (
          <Pressable
            onPress={() => setOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={open ? 'Hide rules' : 'Show rules'}
            accessibilityState={{ expanded: open }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
              {heading}
              {!open ? (
                <Text style={{ fontSize: 12, fontWeight: '700', color: pal.label }}>{summary}</Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 12, fontWeight: '800', color: pal.hint }}>
              {open ? '▴' : '▾'}
            </Text>
          </Pressable>
        ) : (
          heading
        )}

        {open ? (
          <>
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
                      onPress={() => set({ faanMin: n })}
                      accessibilityRole="radio"
                      accessibilityLabel={`Minimum faan: ${n}`}
                      accessibilityState={{ selected: active, disabled }}
                      style={({ pressed }) => ({
                        borderWidth: 1,
                        borderColor: active ? pal.chipActiveBorder : pal.chipBorder,
                        backgroundColor: active
                          ? pal.chipActiveBg
                          : pressed && !disabled
                            ? pal.chipPressedBg
                            : pal.chipBg,
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
                          color: active ? pal.chipActiveFg : pal.chipFg,
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
              <Text style={{ fontSize: 11, color: pal.hint, opacity: 0.8, marginTop: 4 }}>
                Only the lobby host can change rules.
              </Text>
            )}
          </>
        ) : null}
      </View>
    </PaletteContext.Provider>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const pal = useContext(PaletteContext);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <Text style={{ width: 140, fontSize: 13, color: pal.label }}>{label}</Text>
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
  const pal = useContext(PaletteContext);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ flex: 1, fontSize: 13, color: pal.label }}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
        trackColor={pal.track}
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
  const pal = useContext(PaletteContext);
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
          // The Text label sits as a sibling, not a `labelFor` parent —
          // screen readers and Playwright's `getByLabel` wouldn't pick
          // it up without an explicit `accessibilityLabel`. Without
          // this, an agent driving the rule panel has to fall back to
          // positional selectors (`nth(0)`) which break when the
          // panel grows new fields. The label gets the unit suffix
          // ("seconds") to disambiguate from any future ms-input.
          accessibilityLabel={`${label} (seconds)`}
          testID="turn-timeout-seconds"
          style={{
            width: 64,
            paddingVertical: 6,
            paddingHorizontal: 8,
            borderRadius: 6,
            borderColor: pal.inputBorder,
            borderWidth: 1,
            backgroundColor: pal.inputBg,
            color: pal.inputFg,
            fontSize: 13,
            opacity: disabled ? 0.5 : 1,
          }}
        />
        <Text style={{ fontSize: 13, color: pal.hint }}>seconds</Text>
      </View>
    </Row>
  );
}
