import type { Seat, Wind } from '@mahjong/game-logic';
import type { CSSProperties } from 'react';
import { type LobbyState, nameForSeat } from '../../../state/game';
import { oppIdentity } from '../../../ui/match/oppIdentity';
import { type Position, SEAT_COLOR } from '../../../ui/match/seatColor';
import { WIND_GLYPH } from '../../../ui/winds';
import { computeInitials } from '../../../util';
import { GLASS, glassStyle } from './glass';

export interface SeatBadgeModel {
  seat: Seat;
  position: Position;
  seatWind: Wind;
  score: number;
  isDealer: boolean;
  isActive: boolean;
  aboutToDraw: boolean;
  drawCountdown: number | null;
  turnCountdown: number | null;
  isYou: boolean;
}

interface SeatBadgeProps {
  model: SeatBadgeModel;
  lobby: LobbyState | null;
  compact: boolean;
  /**
   * Portrait seat strip: three badges share a 388 px row, so the name
   * clamps tighter and the dealer reads from the red wind glyph plus a
   * dot on the disc instead of the 莊 chip.
   */
  dense?: boolean | undefined;
  /**
   * Fills the width its flex parent grants (the portrait footer): the
   * name ellipsises to whatever is left after the disc, wind glyph and
   * dealer chip, so a long name never runs under the sort control.
   */
  fluid?: boolean | undefined;
  style?: CSSProperties | undefined;
}

/**
 * Glass seat badge — initials disc in the seat colour, name, seat wind,
 * score line (or the live countdown), dealer ribbon and an active-turn
 * gold ring. Content logic mirrors `PlayerBadge`; positions are set by
 * the shell (projected from each seat's world anchor).
 */
export function SeatBadge({
  model,
  lobby,
  compact,
  dense = false,
  fluid = false,
  style,
}: SeatBadgeProps) {
  const { name, botLabel } = oppIdentity(lobby, model.seat);
  const displayName = model.isYou ? nameForSeat(lobby, model.seat) : name;
  const initials = computeInitials(displayName);
  const colour = SEAT_COLOR[model.position];
  const cue = !model.isActive && model.aboutToDraw;
  const sub =
    cue && model.drawCountdown !== null
      ? `drawing in ${model.drawCountdown}s`
      : model.isActive && model.turnCountdown !== null
        ? `${model.turnCountdown}s left`
        : `${model.score} pt`;
  return (
    <div
      className="mj-hud-fade"
      aria-label={`${displayName}, ${model.seatWind} seat, ${model.score} points${model.isDealer ? ', dealer' : ''}${model.isActive ? ', active turn' : ''}`}
      style={glassStyle({
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: dense ? 6 : compact ? 8 : 10,
        padding: dense ? '4px 9px 4px 4px' : compact ? '5px 10px 5px 5px' : '6px 12px 6px 6px',
        borderRadius: 999,
        minWidth: 0,
        maxWidth: dense ? 132 : fluid ? '100%' : undefined,
        border: model.isActive
          ? '1px solid rgba(216,168,90,0.95)'
          : cue
            ? '1px solid rgba(216,168,90,0.55)'
            : GLASS.border,
        boxShadow: model.isActive
          ? '0 0 0 3px rgba(216,168,90,0.22), 0 12px 32px rgba(0,0,0,0.35)'
          : GLASS.shadow,
        transition: 'border-color 240ms ease-out, box-shadow 240ms ease-out',
        pointerEvents: 'none',
        ...style,
      })}
    >
      {model.isActive ? (
        <span
          className="mj-pulse"
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: 999,
            border: '2px solid rgba(216,168,90,0.75)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <span
        style={{
          position: 'relative',
          width: dense ? 24 : compact ? 26 : 30,
          height: dense ? 24 : compact ? 26 : 30,
          borderRadius: 999,
          background: colour,
          color: 'white',
          fontWeight: 800,
          fontSize: compact ? 10 : 12,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.18)',
        }}
      >
        {initials}
        {dense && model.isDealer ? (
          <span
            aria-label="Dealer"
            style={{
              position: 'absolute',
              right: -3,
              bottom: -3,
              width: 10,
              height: 10,
              borderRadius: 5,
              background: GLASS.red,
              border: '2px solid rgba(14,20,17,0.9)',
            }}
          />
        ) : null}
      </span>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          lineHeight: 1.15,
          minWidth: 0,
          flex: fluid ? '1 1 auto' : undefined,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span
            style={{
              fontWeight: 800,
              fontSize: compact ? 11 : 12,
              color: GLASS.text,
              maxWidth: fluid ? undefined : dense ? 56 : compact ? 96 : 110,
              minWidth: 0,
              flex: fluid ? '0 1 auto' : undefined,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </span>
          <span
            style={{
              fontFamily: GLASS.serif,
              fontSize: compact ? 11 : 13,
              fontWeight: 700,
              color: model.isDealer ? '#f0a08e' : GLASS.gold,
              flexShrink: 0,
            }}
          >
            {WIND_GLYPH[model.seatWind]}
          </span>
          {botLabel && !compact ? (
            <span style={{ fontSize: 9, fontWeight: 700, color: GLASS.text2, letterSpacing: 0.4 }}>
              {botLabel}
            </span>
          ) : null}
        </span>
        <span
          style={{
            fontSize: compact ? 9.5 : 10,
            fontWeight: 700,
            letterSpacing: 0.6,
            color:
              cue || (model.isActive && model.turnCountdown !== null) ? GLASS.gold : GLASS.text2,
            whiteSpace: 'nowrap',
          }}
        >
          {sub}
        </span>
      </span>
      {model.isDealer && !dense ? (
        <span
          aria-label="Dealer"
          style={{
            marginLeft: 2,
            flexShrink: 0,
            padding: '2px 6px',
            borderRadius: 6,
            background: GLASS.red,
            color: 'white',
            fontFamily: GLASS.serif,
            fontSize: compact ? 10 : 11,
            fontWeight: 700,
            boxShadow: '0 2px 6px rgba(177,77,58,0.45)',
          }}
        >
          莊
        </span>
      ) : null}
    </div>
  );
}
