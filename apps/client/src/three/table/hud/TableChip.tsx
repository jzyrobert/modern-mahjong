import type { Tile as MTile, Seat, Wind } from '@mahjong/game-logic';
import type { CSSProperties } from 'react';
import { TileGlyph } from '../../../ui/TileGlyph';
import { WIND_GLYPH } from '../../../ui/winds';
import { tileName } from './HitTargets';
import { GLASS, glassStyle, labelStyle } from './glass';

export interface TableChipProps {
  /** Newest discard of the hand, or null before the first one. */
  lastDiscard: { tile: MTile; from: Seat } | null;
  lastDiscardName: string | null;
  lastDiscardColour: string | null;
  lastDiscardIsYou: boolean;
  dealerName: string;
  dealerIsYou: boolean;
  prevailingWind: Wind;
  style?: CSSProperties | undefined;
}

/** Face glyph size in the chip, CSS px (a 36 : 50 tile). */
const GLYPH_W = 20;
const GLYPH_H = 28;

/**
 * The portrait action tray's second, resting occupant under the turn
 * chip: who pitched the newest discard and what it was, with the face
 * drawn at 20 × 28 CSS px — the one place on the phone where the last
 * discard is readable without zooming (the far river's tiles are ~22
 * px and upside down). Before the first discard it names the dealer
 * who opens and the prevailing wind, so the slot always carries table
 * state rather than void (round-4 #6). Pure display, never interactive;
 * the claim strip replaces the whole tray when the player has a call.
 */
export function TableChip({
  lastDiscard,
  lastDiscardName,
  lastDiscardColour,
  lastDiscardIsYou,
  dealerName,
  dealerIsYou,
  prevailingWind,
  style,
}: TableChipProps) {
  const label = lastDiscard
    ? `${lastDiscardIsYou ? 'You' : (lastDiscardName ?? `Seat ${lastDiscard.from}`)} discarded ${tileName(lastDiscard.tile)}`
    : `${dealerIsYou ? 'You open' : `${dealerName} opens`} · ${WIND_GLYPH[prevailingWind]} round`;
  return (
    <div
      data-testid="table-chip"
      aria-label={label}
      style={glassStyle({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 14px 0 12px',
        minHeight: 34,
        borderRadius: 999,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        ...style,
      })}
    >
      {lastDiscard ? (
        <>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: lastDiscardColour ?? GLASS.text2,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              ...labelStyle,
              letterSpacing: 1.2,
              color: GLASS.text2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 150,
            }}
          >
            {lastDiscardIsYou ? 'You' : lastDiscardName} discarded
          </span>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: GLYPH_W,
              height: GLYPH_H,
              borderRadius: 3,
              background: '#f6f0e1',
              boxShadow: '0 1px 2px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(0,0,0,0.08)',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <TileGlyph t={lastDiscard.tile} width={GLYPH_W} />
          </span>
          <span
            aria-hidden="true"
            style={{ fontSize: 12, fontWeight: 800, color: GLASS.text, letterSpacing: 0.3 }}
          >
            {tileName(lastDiscard.tile)}
          </span>
        </>
      ) : (
        <>
          <span
            aria-hidden="true"
            style={{
              fontFamily: GLASS.serif,
              fontSize: 15,
              fontWeight: 700,
              color: GLASS.gold,
              lineHeight: 1,
            }}
          >
            莊
          </span>
          <span style={{ ...labelStyle, letterSpacing: 1.2, color: GLASS.text2 }}>
            {dealerIsYou ? 'You open' : `${dealerName} opens`}
          </span>
          <span aria-hidden="true" style={{ color: 'rgba(255,255,255,0.28)' }}>
            ·
          </span>
          <span style={{ ...labelStyle, letterSpacing: 1.2, color: GLASS.text2 }}>
            <span style={{ fontFamily: GLASS.serif, color: GLASS.gold, fontSize: 13 }}>
              {WIND_GLYPH[prevailingWind]}
            </span>{' '}
            round
          </span>
        </>
      )}
    </div>
  );
}
