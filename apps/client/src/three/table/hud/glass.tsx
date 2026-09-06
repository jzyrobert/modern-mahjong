import type { CSSProperties, ReactNode } from 'react';

/**
 * Glass-language primitives for the DOM HUD over the WebGL table.
 * Plain DOM (`div` / `button`) rather than RN primitives so we get
 * `backdrop-filter`, `:hover` transitions and real `<button>`
 * semantics for free. Web-only — this tree never renders on native.
 */
export const GLASS = {
  bg: 'rgba(14,20,17,0.62)',
  bgStrong: 'rgba(14,20,17,0.82)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderGold: '1px solid rgba(216,168,90,0.55)',
  shadow: '0 12px 40px rgba(0,0,0,0.35)',
  blur: 'blur(16px) saturate(140%)',
  text: 'rgba(255,255,255,0.92)',
  text2: 'rgba(255,255,255,0.62)',
  gold: '#d8a85a',
  goldInk: '#2a2418',
  red: '#b14d3a',
  success: '#3aa066',
  font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: "'Noto Serif TC', 'Noto Serif CJK TC', serif",
} as const;

export const glassStyle = (extra?: CSSProperties): CSSProperties => ({
  background: GLASS.bg,
  backdropFilter: GLASS.blur,
  WebkitBackdropFilter: GLASS.blur,
  border: GLASS.border,
  borderRadius: 16,
  boxShadow: GLASS.shadow,
  color: GLASS.text,
  fontFamily: GLASS.font,
  boxSizing: 'border-box',
  ...extra,
});

export const labelStyle: CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 2,
  fontWeight: 700,
  color: GLASS.text2,
  fontFamily: GLASS.font,
};

interface GlassPanelProps {
  children: ReactNode;
  style?: CSSProperties;
  pill?: boolean;
  testID?: string;
  className?: string;
}

export function GlassPanel({ children, style, pill, testID }: GlassPanelProps) {
  return (
    <div data-testid={testID} style={glassStyle({ borderRadius: pill ? 999 : 16, ...style })}>
      {children}
    </div>
  );
}

export type GlassButtonKind = 'primary' | 'secondary' | 'destructive' | 'ghost';

interface GlassButtonProps {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  kind?: GlassButtonKind;
  ariaLabel?: string;
  testID?: string;
  disabled?: boolean;
  style?: CSSProperties;
  /** Min height — 44 keeps the touch target honest on phones. */
  minHeight?: number;
  ariaPressed?: boolean;
}

export function GlassButton({
  children,
  onClick,
  kind = 'secondary',
  ariaLabel,
  testID,
  disabled,
  style,
  minHeight = 44,
  ariaPressed,
}: GlassButtonProps) {
  const base: CSSProperties = {
    appearance: 'none',
    cursor: disabled ? 'default' : 'pointer',
    minHeight,
    padding: '0 16px',
    borderRadius: 12,
    fontFamily: GLASS.font,
    fontWeight: 800,
    fontSize: 13,
    letterSpacing: 0.3,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: 'transform 160ms ease-out, filter 160ms ease-out, background 160ms ease-out',
    pointerEvents: 'auto',
    opacity: disabled ? 0.55 : 1,
    boxSizing: 'border-box',
    whiteSpace: 'nowrap',
  };
  const kinds: Record<GlassButtonKind, CSSProperties> = {
    primary: {
      background: 'linear-gradient(180deg, #e6ba6c 0%, #d8a85a 100%)',
      color: GLASS.goldInk,
      border: '1px solid rgba(255,235,190,0.55)',
      boxShadow: '0 8px 24px rgba(216,168,90,0.28), inset 0 1px 0 rgba(255,255,255,0.35)',
    },
    secondary: {
      background: GLASS.bg,
      backdropFilter: GLASS.blur,
      WebkitBackdropFilter: GLASS.blur,
      color: GLASS.text,
      border: GLASS.borderGold,
      boxShadow: GLASS.shadow,
    },
    destructive: {
      background: 'rgba(177,77,58,0.12)',
      color: '#f0a08e',
      border: '1px solid rgba(177,77,58,0.75)',
    },
    ghost: {
      background: 'transparent',
      color: GLASS.text2,
      border: '1px solid rgba(255,255,255,0.14)',
    },
  };
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      data-testid={testID}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className="mj-glass-btn"
      style={{ ...base, ...kinds[kind], ...style }}
    >
      {children}
    </button>
  );
}

/** Injected once — hover / press affordances for `.mj-glass-btn`. */
export const HUD_CSS = `
.mj-glass-btn:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.05)}
.mj-glass-btn:active:not(:disabled){transform:scale(0.97)}
.mj-hit:focus-visible{outline:2px solid #d8a85a;outline-offset:2px}
.mj-hud-fade{animation:mjFade 200ms cubic-bezier(.2,.7,.2,1)}
@keyframes mjFade{from{transform:translateY(8px)}to{transform:none}}
.mj-pulse{animation:mjPulse 1.6s ease-in-out infinite}
@keyframes mjPulse{0%,100%{opacity:.55}50%{opacity:1}}
.mj-win-stamp{animation:mjStamp 520ms cubic-bezier(.2,.8,.2,1) both}
@keyframes mjStamp{0%{transform:rotate(-8deg) scale(1.7)}60%{transform:rotate(-8deg) scale(.94)}100%{transform:rotate(-8deg) scale(1)}}
@media (prefers-reduced-motion: reduce){.mj-hud-fade,.mj-pulse,.mj-win-stamp{animation:none}}
`;
