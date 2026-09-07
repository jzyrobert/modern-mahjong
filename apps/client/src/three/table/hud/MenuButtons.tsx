import type { CSSProperties, ReactNode } from 'react';
import { TutorialTarget } from '../../../ui/tutorial/TargetRegistry';
import { GLASS, glassStyle } from './glass';

interface MenuButtonsProps {
  onOpenSettings: () => void;
  onOpenMenu: () => void;
  menuOpen: boolean;
  matchCode: string | null;
  viewers: number | null;
  compact: boolean;
  style?: CSSProperties | undefined;
  /** Extra control rendered before the gear (e.g. the river-zoom exit). */
  leading?: ReactNode;
  /** Button diameter, CSS px (44 default; landscape runs 40). */
  size?: number | undefined;
}

const GEAR =
  'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.4 3.5c0-.6-.1-1.1-.2-1.6l2-1.6-1.9-3.3-2.4 1a8 8 0 0 0-2.8-1.6L14.7 2H9.3l-.4 2.9a8 8 0 0 0-2.8 1.6l-2.4-1L1.8 8.8l2 1.6c-.1.5-.2 1-.2 1.6s.1 1.1.2 1.6l-2 1.6 1.9 3.3 2.4-1a8 8 0 0 0 2.8 1.6l.4 2.9h5.4l.4-2.9a8 8 0 0 0 2.8-1.6l2.4 1 1.9-3.3-2-1.6c.1-.5.2-1 .2-1.6Z';

/**
 * Top-right chrome: a direct Settings button (`open-settings`) and the
 * ☰ menu that hosts Settings / Game log / Players / Tile reference /
 * Scoring rules / Leave via the existing `MatchModals`.
 */
export function MenuButtons({
  onOpenSettings,
  onOpenMenu,
  menuOpen,
  matchCode,
  viewers,
  compact,
  style,
  leading,
  size = 44,
}: MenuButtonsProps) {
  const btn: CSSProperties = {
    appearance: 'none',
    width: size,
    height: size,
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    pointerEvents: 'auto',
    color: GLASS.text,
    fontSize: 18,
    fontWeight: 700,
    fontFamily: GLASS.font,
  };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}>
      {leading}
      {matchCode && !compact ? (
        <span
          style={glassStyle({
            borderRadius: 999,
            padding: '0 12px',
            height: size,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: GLASS.text2,
          })}
        >
          {viewers !== null && viewers > 0 ? (
            <span style={{ color: GLASS.success }}>● {viewers} watching</span>
          ) : null}
          <span>{matchCode}</span>
        </span>
      ) : null}
      <button
        type="button"
        data-testid="open-settings"
        aria-label="Settings"
        onClick={onOpenSettings}
        className="mj-glass-btn"
        style={glassStyle({ ...btn })}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d={GEAR} fill="currentColor" />
        </svg>
      </button>
      <TutorialTarget id="menu-pill">
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={onOpenMenu}
          className="mj-glass-btn"
          style={glassStyle({
            ...btn,
            border: menuOpen ? GLASS.borderGold : GLASS.border,
            color: menuOpen ? GLASS.gold : GLASS.text,
          })}
        >
          ☰
        </button>
      </TutorialTarget>
    </div>
  );
}
