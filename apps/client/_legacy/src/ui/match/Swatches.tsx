import { INK_2 } from '../../native/theme.js';

export interface SwatchOption<T extends string> {
  id: T;
  name: string;
  background: string;
  shape: 'square' | 'tile';
}

/**
 * Generic row of selectable colour/material swatches. Used by the
 * `SettingsPanel` for both the felt-skin and tile-back-skin pickers.
 *
 * `shape='square'` renders a 36×36 rounded square with a soft inset; `'tile'`
 * renders a tile-proportioned 28×36 rectangle so the tile-back swatches
 * preview at the right aspect.
 */
export function SwatchRow<T extends string>({
  options,
  active,
  onChange,
}: {
  options: SwatchOption<T>[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map((o) => {
        const dimensions =
          o.shape === 'tile'
            ? { width: 28, height: 36, borderRadius: 6 }
            : { width: 36, height: 36, borderRadius: 10 };
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            title={o.name}
            aria-label={o.name}
            aria-pressed={active === o.id}
            style={{
              ...dimensions,
              border: active === o.id ? `2.5px solid ${INK_2}` : '2.5px solid transparent',
              background: o.background,
              cursor: 'pointer',
              boxShadow: o.shape === 'square' ? 'inset 0 -2px 0 rgba(0,0,0,0.1)' : 'none',
              padding: 0,
            }}
          />
        );
      })}
    </div>
  );
}
