import type { ReactNode } from 'react';
import { INK_3, MONO, SANS } from '../native/theme.js';

interface PrimaryButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  full?: boolean;
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
}

/**
 * Brand-red primary button with hover lift, shadow, and a disabled state.
 * Hover/focus/disabled visuals come from the `.mh-primary-btn` rules in
 * `src/styles.css` so we don't re-render the whole component on hover.
 */
export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  full = false,
  size = 'md',
  type = 'button',
}: PrimaryButtonProps) {
  const padding = size === 'lg' ? '12px 20px' : size === 'sm' ? '6px 12px' : '10px 16px';
  const fontSize = size === 'lg' ? 14 : size === 'sm' ? 11 : 13;
  return (
    <button
      type={type === 'submit' ? 'submit' : 'button'}
      className="mh-primary-btn"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding,
        fontSize,
        width: full ? '100%' : 'auto',
      }}
    >
      {children}
    </button>
  );
}

interface GhostButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  full?: boolean;
}

/**
 * Cream ghost button with hairline border. Hover visuals come from the
 * `.mh-ghost-btn` rules in `src/styles.css`.
 */
export function GhostButton({ children, onClick, disabled = false, full = false }: GhostButtonProps) {
  return (
    <button
      type="button"
      className="mh-ghost-btn"
      onClick={onClick}
      disabled={disabled}
      style={{ width: full ? '100%' : 'auto' }}
    >
      {children}
    </button>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  maxLength?: number;
  hint?: string;
  style?: React.CSSProperties;
}

/**
 * Cream-paper text input with focused brand-red ring. The focus ring comes
 * from the `.mh-text-field-input:focus-visible` rule in `src/styles.css`,
 * so we don't mutate `e.target.style` on focus/blur from JS.
 */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
  maxLength,
  hint,
  style,
}: TextFieldProps) {
  return (
    <label style={{ display: 'block', ...style }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: INK_3,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <input
        className="mh-text-field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        style={{
          fontFamily: mono ? MONO : SANS,
          fontSize: mono ? 16 : 14,
          letterSpacing: mono ? 3 : 0,
          textTransform: mono ? 'uppercase' : 'none',
        }}
      />
      {hint ? <div style={{ fontSize: 11, color: INK_3, marginTop: 6 }}>{hint}</div> : null}
    </label>
  );
}
