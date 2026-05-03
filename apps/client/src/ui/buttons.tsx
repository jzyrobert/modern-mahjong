import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  HAIRLINE,
  INK,
  INK_3,
  MONO,
  PAPER,
  PAPER_HI,
  RED,
  RED_HOT,
  SANS,
} from '../native/theme.js';

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
 * Ported from `/tmp/design/design/menu.jsx::PrimaryButton`.
 */
export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  full = false,
  size = 'md',
  type = 'button',
}: PrimaryButtonProps) {
  const [hover, setHover] = useState(false);
  const padding = size === 'lg' ? '12px 20px' : size === 'sm' ? '6px 12px' : '10px 16px';
  const fontSize = size === 'lg' ? 14 : size === 'sm' ? 11 : 13;
  return (
    <button
      type={type === 'submit' ? 'submit' : 'button'}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: disabled ? 'oklch(0.85 0.02 60)' : hover ? RED_HOT : RED,
        color: 'white',
        border: 'none',
        borderRadius: 10,
        padding,
        fontWeight: 800,
        fontSize,
        fontFamily: SANS,
        letterSpacing: 0.3,
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: disabled
          ? 'none'
          : '0 2px 6px oklch(0.55 0.18 28 / 0.32), inset 0 -2px 0 rgba(0,0,0,0.15)',
        opacity: disabled ? 0.6 : 1,
        transition: 'background .15s ease, transform .12s ease',
        transform: hover && !disabled ? 'translateY(-1px)' : 'none',
        width: full ? '100%' : 'auto',
        whiteSpace: 'nowrap',
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
 * Cream ghost button with hairline border. Ported from
 * `/tmp/design/design/menu.jsx::GhostButton`.
 */
export function GhostButton({
  children,
  onClick,
  disabled = false,
  full = false,
}: GhostButtonProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? PAPER : 'white',
        color: INK,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 10,
        padding: '10px 16px',
        fontWeight: 700,
        fontSize: 13,
        fontFamily: SANS,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background .15s ease, border-color .15s ease',
        width: full ? '100%' : 'auto',
        whiteSpace: 'nowrap',
      }}
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
 * Cream-paper text input with focused brand-red ring. Ported from
 * `/tmp/design/design/menu.jsx::TextField`.
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 8,
          border: `1px solid ${HAIRLINE}`,
          background: PAPER_HI,
          fontFamily: mono ? MONO : SANS,
          fontSize: mono ? 16 : 14,
          fontWeight: 600,
          color: INK,
          letterSpacing: mono ? 3 : 0,
          textTransform: mono ? 'uppercase' : 'none',
          outline: 'none',
          transition: 'border-color .15s ease, box-shadow .15s ease',
        }}
        onFocus={(e) => {
          e.target.style.borderColor = RED;
          e.target.style.boxShadow = '0 0 0 3px oklch(0.55 0.18 25 / 0.15)';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = HAIRLINE;
          e.target.style.boxShadow = 'none';
        }}
      />
      {hint ? <div style={{ fontSize: 11, color: INK_3, marginTop: 6 }}>{hint}</div> : null}
    </label>
  );
}
