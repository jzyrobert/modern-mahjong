import { FAAN_OPTIONS } from '@mahjong/game-logic';
import type { Action, RuleConfig } from '@mahjong/protocol';
import { useEffect, useState } from 'react';
import { HAIRLINE, PAPER } from '../native/theme.js';

interface RulePanelProps {
  rules: RuleConfig;
  isHost: boolean;
  onAction: (a: Action) => void;
}

export function RulePanel({ rules, isHost, onAction }: RulePanelProps) {
  const set = (patch: Partial<RuleConfig>) => onAction({ t: 'setRules', rules: patch });
  const disabled = !isHost;

  return (
    <fieldset
      style={{
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 6,
        padding: 12,
        margin: '12px 0',
        background: PAPER,
      }}
    >
      <legend style={{ padding: '0 6px', fontSize: 13, opacity: 0.85 }}>Rules</legend>

      <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 140 }}>Minimum faan</span>
          <select
            disabled={disabled}
            value={rules.faanMin}
            onChange={(e) => set({ faanMin: Number(e.target.value) as RuleConfig['faanMin'] })}
          >
            {FAAN_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={rules.allowSevenPairs}
            onChange={(e) => set({ allowSevenPairs: e.target.checked })}
          />
          <span>Allow 七對 (seven pairs)</span>
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            disabled={disabled}
            checked={rules.allowThirteenOrphans}
            onChange={(e) => set({ allowThirteenOrphans: e.target.checked })}
          />
          <span>Allow 十三幺 (thirteen orphans)</span>
        </label>

        <SecondsInput
          label="Turn timeout"
          disabled={disabled}
          ms={rules.turnTimeoutMs}
          min={5}
          max={120}
          onCommit={(ms) => set({ turnTimeoutMs: ms })}
        />
        <SecondsInput
          label="Claim window"
          disabled={disabled}
          ms={rules.claimWindowMs}
          min={1}
          max={15}
          onCommit={(ms) => set({ claimWindowMs: ms })}
        />
      </div>
      {!isHost && (
        <p style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>
          Only the lobby host can change rules.
        </p>
      )}
    </fieldset>
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

/**
 * Number input that only dispatches an action on blur — typing two characters
 * (e.g., "30") would otherwise emit one action per keystroke.
 */
function SecondsInput({ label, disabled, ms, min, max, onCommit }: SecondsInputProps) {
  const initial = Math.round(ms / 1000);
  const [draft, setDraft] = useState<number>(initial);

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const commit = () => {
    const clamped = Math.min(max, Math.max(min, draft || min));
    if (clamped !== draft) setDraft(clamped);
    if (clamped * 1000 !== ms) onCommit(clamped * 1000);
  };

  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ width: 140 }}>{label}</span>
      <input
        type="number"
        disabled={disabled}
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onBlur={commit}
        style={{ width: 64 }}
      />
      <span>seconds</span>
    </label>
  );
}
