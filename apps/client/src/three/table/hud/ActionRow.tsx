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
  /** Landscape footer: 30 px segments so the control stays ≤ 38 px tall. */
  dense?: boolean | undefined;
}

/** Glass segmented sort picker — same labels + a11y as `SortPicker`. */
export function SortSegment({ mode, onChange, compact, dense = false }: SortSegmentProps) {
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
              padding: compact ? '0 8px' : '0 12px',
              minHeight: dense ? 30 : compact ? 32 : 38,
              fontFamily: GLASS.font,
              fontSize: compact ? 10 : 11,
              fontWeight: 800,
              letterSpacing: compact ? 1.1 : 1.4,
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

export interface ActionCtasProps {
  seat: Seat;
  canTsumo: boolean;
  tsumoFaan: number | null;
  concealedGangTile: MTile | null;
  promotedGangTile: MTile | null;
  readyWaits: readonly MTile[];
  onAction: (a: Action) => void;
  compact: boolean;
}

export function hasActionCtas(p: ActionCtasProps): boolean {
  return (
    p.canTsumo ||
    p.concealedGangTile !== null ||
    p.promotedGangTile !== null ||
    p.readyWaits.length > 0
  );
}

/**
 * Declare-win / declare-gang / promote-gang CTAs (gold primaries) plus
 * the ready-hand badge, wrapped in the `TutorialTarget` ids lessons
 * anchor to. Rendered inline in the action row on desktop and in the
 * slot above the hand on phones (where the bottom row is full).
 */
export function ActionCtas(p: ActionCtasProps) {
  const { seat, canTsumo, tsumoFaan, concealedGangTile, promotedGangTile, readyWaits, compact } = p;
  if (!hasActionCtas(p)) return null;
  const hasCta = canTsumo || concealedGangTile !== null || promotedGangTile !== null;
  return (
    <div
      className="mj-hud-fade"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: compact ? 8 : 10,
        pointerEvents: 'none',
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
                onClick={() => p.onAction({ t: 'declareWin', seat, selfDraw: true })}
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
                  p.onAction({ t: 'declareGangConcealed', seat, tile: concealedGangTile })
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
                    p.onAction({ t: 'declareGangPromoted', seat, tile: promotedGangTile })
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
  );
}

interface ActionRowProps extends ActionCtasProps {
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  /** Rendered at the left of the bottom row (the user's seat badge on phones). */
  leading?: ReactNode;
  /** Phones render the CTAs above the hand instead — skip them here. */
  ctasExternal?: boolean;
  style?: CSSProperties | undefined;
  /** Landscape: 30 px sort segments (footer ≤ 40 px). */
  dense?: boolean | undefined;
  /**
   * `'end'` pins the sort control to the row's right edge and reserves
   * a centred slot for `centre` (desktop's claim strip); `'auto'` keeps
   * the phone layout (badge left, sort right, or sort centred alone).
   */
  sortAlign?: 'auto' | 'end' | 'replace' | undefined;
  /** Centred footer content (desktop / landscape claim strip). */
  centre?: ReactNode;
}

/**
 * Landscape claim footer: the user's badge is capped at this width so
 * the centred strip (`calc(100% − 2·(cap + gap))`) can never run under
 * it, and a three-option chi row still fits in the ~590 px that leaves
 * on a 915 px phone (≈ 540 px).
 */
export const FOOTER_LEADING_MAX = 176;

/**
 * Bottom action row over the hand: sort picker and (on desktop) the
 * declare-win / gang CTAs + ready-hand badge. The turn state lives in
 * the status pill.
 */
export function ActionRow(props: ActionRowProps) {
  const {
    sortMode,
    onSortModeChange,
    compact,
    leading,
    ctasExternal,
    style,
    dense = false,
    sortAlign = 'auto',
    centre,
  } = props;
  const sort = (
    <SortSegment mode={sortMode} onChange={onSortModeChange} compact={compact} dense={dense} />
  );
  // Desktop: the CTAs take the footer's centred slot whenever the claim
  // strip is not in it, level with the sort control, instead of a row
  // stacked above it. Stacked, the declare-win button's top edge ran
  // under the projected hand (its top at ~782 CSS px against tile
  // bottoms at ~790 on 1440×900) and the tutorial ring around it cut
  // across the tiles' glyphs.
  const ctasInFooter = !ctasExternal && sortAlign === 'end' && centre === undefined;
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
      {ctasExternal || ctasInFooter ? null : <ActionCtas {...props} />}
      {sortAlign === 'replace' ? (
        // Landscape claim window: the claim strip *replaces* the sort
        // control (irrelevant while a claim is pending) and sits centred
        // on the viewport in the footer row, so it never lies on the near
        // wall's tile backs; the badge keeps its corner.
        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-end',
            minHeight: dense ? 40 : 44,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              maxWidth: FOOTER_LEADING_MAX,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {leading}
          </div>
          <div
            style={{
              maxWidth: `calc(100% - ${2 * (FOOTER_LEADING_MAX + 12)}px)`,
              minWidth: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'flex-end',
              gap: 8,
            }}
          >
            {centre}
          </div>
        </div>
      ) : sortAlign === 'end' ? (
        // Three columns: [leading] [centre] [sort], bottom-aligned so a
        // taller centre strip grows upward from the row's baseline.
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'end',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center' }}>{leading}</div>
          <div style={{ minWidth: 0, display: 'flex', justifyContent: 'center' }}>
            {ctasInFooter ? <ActionCtas {...props} /> : centre}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{sort}</div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: leading ? 'space-between' : 'center',
            gap: 8,
          }}
        >
          {leading ? (
            <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center' }}>
              {leading}
            </div>
          ) : null}
          <div style={{ flex: 'none' }}>{sort}</div>
        </div>
      )}
    </div>
  );
}
