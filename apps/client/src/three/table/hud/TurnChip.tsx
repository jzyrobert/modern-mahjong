import type { CSSProperties } from 'react';
import { TutorialTarget } from '../../../ui/tutorial/TargetRegistry';
import { GLASS, glassStyle, labelStyle } from './glass';

export interface TurnChipProps {
  /** It is the user's turn (draw or discard). */
  isMyTurn: boolean;
  needsDraw: boolean;
  turnCountdown: number | null;
  /** Whose turn it is otherwise (display name), or null between turns. */
  activeName: string | null;
  /** Seat colour of the active opponent (the badge disc colour). */
  activeColour: string | null;
  /** A claim window is open (the table waits on calls, not a turn). */
  claimsOpen: boolean;
  style?: CSSProperties | undefined;
}

/**
 * The portrait action tray's idle occupant: one glass pill that says
 * whose move it is. The user's turn is gold (pulsing dot, `Your turn ·
 * draw / discard`, the countdown when a timer is armed — this is the
 * `turn-countdown` tutorial target on phones, where the status pill in
 * the chrome row carries only the wind and the wall count); an
 * opponent's turn shows their seat colour and name; a claim window says
 * so. The tray swaps this for the claim strip / declare CTAs when the
 * player has a call, so the slot under the hand is never empty.
 */
export function TurnChip({
  isMyTurn,
  needsDraw,
  turnCountdown,
  activeName,
  activeColour,
  claimsOpen,
  style,
}: TurnChipProps) {
  const label = isMyTurn
    ? `Your turn · ${needsDraw ? 'draw' : 'discard'}${turnCountdown !== null ? ` · ${turnCountdown}s` : ''}`
    : claimsOpen
      ? 'Claim window'
      : activeName
        ? `${activeName}'s turn`
        : 'Waiting';
  const dot = isMyTurn ? GLASS.gold : claimsOpen ? '#f0a08e' : (activeColour ?? GLASS.text2);
  const chip = (
    <div
      data-testid="turn-chip"
      aria-label={
        isMyTurn
          ? turnCountdown !== null
            ? `Your turn, ${turnCountdown} seconds left`
            : 'Your turn'
          : label
      }
      style={glassStyle({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 9,
        padding: '0 16px 0 12px',
        minHeight: 40,
        borderRadius: 999,
        border: isMyTurn ? '1px solid rgba(216,168,90,0.6)' : GLASS.border,
        background: isMyTurn ? 'rgba(216,168,90,0.14)' : GLASS.bg,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        ...style,
      })}
    >
      <span
        className={isMyTurn ? 'mj-pulse' : undefined}
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: dot,
          boxShadow: isMyTurn ? '0 0 10px rgba(216,168,90,0.9)' : 'none',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          ...labelStyle,
          letterSpacing: 1.4,
          color: isMyTurn ? GLASS.gold : GLASS.text,
        }}
      >
        {label}
      </span>
    </div>
  );
  return isMyTurn ? <TutorialTarget id="turn-countdown">{chip}</TutorialTarget> : chip;
}
