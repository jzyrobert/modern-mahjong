import { CREAM, HAIRLINE, INK_3, SANS } from '../../native/theme.js';

interface MeldStripProps {
  /** Visual orientation — 'horiz' for the top opponent, 'vert' for the side opponents. */
  orientation: 'horiz' | 'vert';
}

/**
 * Reserved dashed slot where exposed melds will land for an opponent.
 * Keeps geometry consistent across seats so opponents don't reflow when
 * someone calls a meld. Ported from
 * `/tmp/design/design/app.jsx::OpponentSeat` (the empty-melds branch).
 *
 * Actual meld rendering is queued — see the "Reserved meld strip" entry
 * in TODO.md → Design port follow-ups. The engine has `state.melds[seat]:
 * Meld[]`; the renderer will read from that.
 */
export function MeldStrip({ orientation }: MeldStripProps) {
  const isHoriz = orientation === 'horiz';
  return (
    <div
      style={{
        width: isHoriz ? 100 : 36,
        height: isHoriz ? 36 : 100,
        borderRadius: 8,
        border: `1.5px dashed ${HAIRLINE}`,
        background: `${CREAM}40`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: SANS,
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: 1,
        color: INK_3,
        textTransform: 'uppercase',
        writingMode: isHoriz ? 'horizontal-tb' : 'vertical-rl',
        opacity: 0.6,
      }}
    >
      melds
    </div>
  );
}
