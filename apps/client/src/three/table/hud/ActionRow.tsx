import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import type { CSSProperties, ReactNode } from 'react';
import { ReadyHandBadge } from '../../../ui/match/ReadyHandBadge';
import type { SortMode } from '../../../ui/match/SortPicker';
import { TutorialTarget } from '../../../ui/tutorial/TargetRegistry';
import { GLASS, GlassButton, glassStyle } from './glass';

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'suit', label: 'Suit' },
  { id: 'num', label: 'Number' },
  { id: 'manual', label: 'Manual' },
];

interface SortSegmentProps {
  mode: SortMode;
  onChange: (m: SortMode) => void;
  compact: boolean;
}

/** Glass segmented sort picker — same labels + a11y as `SortPicker`. */
export function SortSegment({ mode, onChange, compact }: SortSegmentProps) {
  return (
    <fieldset
      aria-label="Hand sort mode"
      style={glassStyle({
        display: 'inline-flex',
        padding: 3,
        margin: 0,
        borderRadius: 12,
        gap: 2,
        pointerEvents: 'auto',
      })}
    >
      {SORT_OPTIONS.map((o) => {
        const active = mode === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-label={`Sort by ${o.label}`}
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className="mj-glass-btn"
            style={{
              appearance: 'none',
              border: 0,
              cursor: 'pointer',
              borderRadius: 9,
              padding: compact ? '0 9px' : '0 12px',
              minHeight: compact ? 32 : 38,
              fontFamily: GLASS.font,
              fontSize: compact ? 10 : 11,
              fontWeight: 800,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              color: active ? GLASS.goldInk : GLASS.text2,
              background: active ? GLASS.gold : 'transparent',
              transition: 'background 160ms ease-out, color 160ms ease-out',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </fieldset>
  );
}

interface ActionRowProps {
  seat: Seat;
  canTsumo: boolean;
  tsumoFaan: number | null;
  concealedGangTile: MTile | null;
  promotedGangTile: MTile | null;
  readyWaits: readonly MTile[];
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  onAction: (a: Action) => void;
  compact: boolean;
  /** Rendered at the left of the bottom row (the user's seat badge on portrait). */
  leading?: ReactNode;
  style?: CSSProperties | undefined;
}

/**
 * Bottom action row over the hand: sort picker, declare-win /
 * declare-gang / promote-gang CTAs (gold primaries), the ready-hand
 * badge. (The turn state lives in the status pill.) Everything is wrapped in the
 * `TutorialTarget` ids the lessons anchor to.
 */
export function ActionRow({
  seat,
  canTsumo,
  tsumoFaan,
  concealedGangTile,
  promotedGangTile,
  readyWaits,
  sortMode,
  onSortModeChange,
  onAction,
  compact,
  leading,
  style,
}: ActionRowProps) {
  const hasCta = canTsumo || concealedGangTile !== null || promotedGangTile !== null;
  const hasTop = hasCta || readyWaits.length > 0;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: compact ? 8 : 10,
        width: '100%',
        pointerEvents: 'none',
        ...style,
      }}
    >
      {hasTop ? (
        <div
          className="mj-hud-fade"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: compact ? 8 : 10,
          }}
        >
          {readyWaits.length > 0 ? (
            <TutorialTarget id="ready-hand-badge">
              <div style={{ pointerEvents: 'auto' }}>
                <ReadyHandBadge waits={readyWaits} />
              </div>
            </TutorialTarget>
          ) : null}
          {hasCta ? (
            <TutorialTarget id="tsumo-button">
              <div style={{ display: 'inline-flex', gap: 8, pointerEvents: 'auto' }}>
                {canTsumo ? (
                  <GlassButton
                    kind="primary"
                    minHeight={compact ? 40 : 44}
                    onClick={() => onAction({ t: 'declareWin', seat, selfDraw: true })}
                  >
                    {tsumoFaan !== null
                      ? `Declare win (tsumo, ${tsumoFaan} faan)`
                      : 'Declare win (tsumo)'}
                  </GlassButton>
                ) : null}
                {concealedGangTile ? (
                  <GlassButton
                    kind="primary"
                    minHeight={compact ? 40 : 44}
                    onClick={() =>
                      onAction({ t: 'declareGangConcealed', seat, tile: concealedGangTile })
                    }
                  >
                    Declare gang
                  </GlassButton>
                ) : null}
                {promotedGangTile ? (
                  <TutorialTarget id="promote-gang">
                    <GlassButton
                      kind="primary"
                      minHeight={compact ? 40 : 44}
                      onClick={() =>
                        onAction({ t: 'declareGangPromoted', seat, tile: promotedGangTile })
                      }
                    >
                      Promote gang
                    </GlassButton>
                  </TutorialTarget>
                ) : null}
              </div>
            </TutorialTarget>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: leading ? 'space-between' : 'center',
          gap: 8,
        }}
      >
        {leading ? <div style={{ minWidth: 0, flexShrink: 1 }}>{leading}</div> : null}
        <SortSegment mode={sortMode} onChange={onSortModeChange} compact={compact} />
      </div>
    </div>
  );
}
