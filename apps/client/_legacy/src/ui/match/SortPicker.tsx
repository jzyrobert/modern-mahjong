import { INK, INK_3, PAPER, SANS } from '../../native/theme.js';

export type SortMode = 'suit' | 'num' | 'manual';

interface SortPickerProps {
  mode: SortMode;
  onChange: (mode: SortMode) => void;
}

const OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'suit', label: 'Suit' },
  { id: 'num', label: 'Number' },
  { id: 'manual', label: 'Manual' },
];

/**
 * Three-pill segmented toggle that drives how the user's hand is laid out.
 * Ported from `/tmp/design/design/app.jsx::SortPicker`.
 *
 * - `suit` → engine `sortHand` order (man → pin → sou → winds → dragons,
 *   ranks ascending within each suit).
 * - `num`  → numeric rank first, suits as tiebreak.
 * - `manual` → preserves the engine's hand array order. Drag-to-reorder is
 *   queued in TODO.md → Design port follow-ups.
 */
export function SortPicker({ mode, onChange }: SortPickerProps) {
  return (
    <div
      aria-label="Hand sort"
      style={{
        display: 'inline-flex',
        gap: 0,
        background: PAPER,
        padding: 3,
        borderRadius: 12,
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
      }}
    >
      {OPTIONS.map((o) => {
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            style={{
              padding: '5px 10px',
              border: 'none',
              borderRadius: 9,
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: 11,
              cursor: 'pointer',
              background: active ? 'white' : 'transparent',
              color: active ? INK : INK_3,
              boxShadow: active ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 160ms',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
