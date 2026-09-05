import type { CSSProperties, ReactNode } from 'react';
import { WALL_LOW_THRESHOLD } from '../../../ui/match/GameStatusBar';
import { TutorialTarget } from '../../../ui/tutorial/TargetRegistry';
import { GLASS, glassStyle, labelStyle } from './glass';

interface StatusPillProps {
  windGlyph: string;
  name: string;
  wallCount: number;
  /**
   * Tiles left in the dead wall (gang replacements), so the stacks still
   * standing when the live wall runs dry are accounted for — "0 left ·
   * 14 dead". Desktop shows it throughout; the compact pill (phone
   * landscape) only once the live count is low, where it matters and
   * where the row has the room (portrait leaves it to the plate).
   */
  deadCount?: number | undefined;
  isMyTurn: boolean;
  needsDraw: boolean;
  turnCountdown: number | null;
  onPress: () => void;
  compact: boolean;
  /**
   * Render the turn chip (default). Phone portrait passes false: the
   * turn state lives in the action tray under the hand (`TurnChip`),
   * so the chrome pill carries only the wind disc and the wall count.
   */
  showTurn?: boolean | undefined;
  /**
   * Register the turn segment as the `turn-countdown` lesson target
   * (default). The shell passes false while its footer turn chip carries
   * the same id — two live registrations of one id flip-flop the
   * registry on every commit and the coach-mark ring with them.
   */
  turnTarget?: boolean | undefined;
  style?: CSSProperties | undefined;
}

/**
 * Top status pill — the user's seat wind in a coral disc, display
 * name, live wall count and the turn indicator (with the countdown
 * when a turn timer is armed). Mirrors `GameStatusBar`'s content in
 * the glass language; the whole pill opens the players sheet.
 */
export function StatusPill({
  windGlyph,
  name,
  wallCount,
  deadCount,
  isMyTurn,
  needsDraw,
  turnCountdown,
  onPress,
  compact,
  showTurn = true,
  turnTarget = true,
  style,
}: StatusPillProps) {
  const low = wallCount <= WALL_LOW_THRESHOLD;
  return (
    <button
      type="button"
      aria-label="Open players panel"
      onClick={onPress}
      className="mj-glass-btn"
      style={glassStyle({
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 8 : 10,
        padding: compact ? '6px 12px 6px 6px' : '7px 16px 7px 7px',
        cursor: 'pointer',
        pointerEvents: 'auto',
        // Desktop: room for the 240 px name beside the count, the dead
        // tally and the turn segment — the chrome row's toast slot is
        // flex and the far seat's badge projects lower, so nothing is
        // crowded out.
        maxWidth: compact ? 260 : 620,
        minHeight: 44,
        ...style,
      })}
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          background: '#de7660',
          color: 'white',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: GLASS.serif,
          fontWeight: 700,
          fontSize: 15,
          flexShrink: 0,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        {windGlyph}
      </span>
      {compact ? null : (
        <>
          <span
            style={{
              fontWeight: 800,
              fontSize: 13,
              color: GLASS.text,
              // The pill has 460 px on desktop; 160 truncated most
              // generated names ("Quick…") with 300 px to spare.
              maxWidth: 240,
              minWidth: 0,
              flexShrink: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </span>
          <span
            style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.14)', flexShrink: 0 }}
          />
        </>
      )}
      <span
        aria-label={`${wallCount} tiles remaining in wall`}
        style={{
          ...labelStyle,
          letterSpacing: 1,
          color: low ? '#f0a08e' : GLASS.text2,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {wallCount} left
      </span>
      {deadCount !== undefined && deadCount > 0 && (!compact || low) ? (
        <span
          aria-label={`${deadCount} tiles in the dead wall`}
          style={{
            ...labelStyle,
            letterSpacing: 1,
            color: GLASS.gold,
            opacity: 0.85,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          · {deadCount} dead
        </span>
      ) : null}
      {isMyTurn && showTurn ? (
        <MaybeTarget enabled={turnTarget}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 9px',
              borderRadius: 999,
              background: 'rgba(216,168,90,0.16)',
              border: '1px solid rgba(216,168,90,0.5)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <span
              aria-label="Your turn"
              className="mj-pulse"
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                background: GLASS.gold,
                boxShadow: '0 0 8px rgba(216,168,90,0.9)',
              }}
            />
            <span
              aria-label={
                turnCountdown !== null
                  ? `${turnCountdown} seconds left in your turn`
                  : 'No turn timer'
              }
              style={{ ...labelStyle, letterSpacing: 1, color: GLASS.gold }}
            >
              {compact
                ? needsDraw
                  ? 'Draw'
                  : 'Discard'
                : needsDraw
                  ? 'Your turn · draw'
                  : 'Your turn · discard'}
              {turnCountdown !== null ? ` · ${turnCountdown}s` : ''}
            </span>
          </span>
        </MaybeTarget>
      ) : null}
    </button>
  );
}

/**
 * The pill's turn segment is the `turn-countdown` lesson target only
 * while the shell has no footer turn chip carrying that id (two live
 * registrations of one id flip-flop the registry — and the coach-mark
 * ring — on every commit). Otherwise the segment renders bare, so the
 * DOM holds exactly one element tagged with the id.
 */
function MaybeTarget({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return enabled ? (
    <TutorialTarget id="turn-countdown">{children}</TutorialTarget>
  ) : (
    <>{children}</>
  );
}
