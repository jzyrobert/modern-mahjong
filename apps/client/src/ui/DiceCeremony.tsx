import type { OpeningRolls, Seat } from '@mahjong/game-logic';
import { SEATS } from '@mahjong/game-logic';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { HAIRLINE, INK, INK_3, PAPER_HI, RED, SANS } from '../native/theme.js';
import { nameForSeat, useGame } from '../state/game.js';

/**
 * Pip positions on a d6 face. Coordinates are 1-indexed grid cells of a
 * 3×3 layout (`[row, col]`). Centered values use row=2 / col=2.
 */
const PIPS: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [
    [1, 1],
    [3, 3],
  ],
  3: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  4: [
    [1, 1],
    [1, 3],
    [3, 1],
    [3, 3],
  ],
  5: [
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 1],
    [3, 3],
  ],
  6: [
    [1, 1],
    [1, 3],
    [2, 1],
    [2, 3],
    [3, 1],
    [3, 3],
  ],
};

const DISMISS_MS = 3500;

export function DiceCeremony() {
  const rolls = useGame((s) => s.state?.openingRolls);
  const dealer = useGame((s) => s.state?.dealer);
  const [dismissed, setDismissed] = useState(false);

  // Each new hand allocates a fresh `openingRolls` reference, so this effect
  // resets the dismissed flag and starts a fresh auto-dismiss timer per hand.
  useEffect(() => {
    if (!rolls) return;
    setDismissed(false);
    const timer = setTimeout(() => setDismissed(true), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [rolls]);

  const visible = !!rolls && !dismissed && dealer !== undefined;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'oklch(0.2 0.02 60 / 0.5)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setDismissed(true)}
        >
          <Panel rolls={rolls} dealer={dealer} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Panel({ rolls, dealer }: { rolls: OpeningRolls; dealer: Seat }) {
  const lobby = useGame((s) => s.lobby);
  const rolling = SEATS.filter((s) => rolls.dice[s]);

  return (
    <div
      style={{
        background: PAPER_HI,
        color: INK,
        border: `1px solid ${HAIRLINE}`,
        padding: 24,
        borderRadius: 16,
        boxShadow: '0 24px 60px rgba(0,0,0,0.2), 0 6px 16px rgba(0,0,0,0.1)',
        textAlign: 'center',
        minWidth: 320,
        fontFamily: SANS,
      }}
    >
      <h3 style={{ margin: '0 0 16px', fontWeight: 900, color: INK }}>
        {rolls.fullRoll ? 'Opening rolls' : 'Dealer rolls'}
      </h3>
      <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
        {rolling.map((seat) => {
          const pair = rolls.dice[seat]!;
          return (
            <div
              key={seat}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: INK_3 }}>
                {nameForSeat(lobby, seat)}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Die value={pair[0]} delay={0} />
                <Die value={pair[1]} delay={0.12} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: INK }}>
                <b>{pair[0] + pair[1]}</b>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 18, fontSize: 13, color: INK }}>
        Dealer: seat <b style={{ color: RED }}>{dealer}</b> ({nameForSeat(lobby, dealer)})
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: INK_3 }}>Tap anywhere to dismiss</div>
    </div>
  );
}

function Die({ value, delay }: { value: number; delay: number }) {
  return (
    <motion.div
      initial={{ rotate: -90, scale: 0.6, opacity: 0 }}
      animate={{ rotate: 0, scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 18, delay }}
      style={{
        width: 44,
        height: 44,
        background: 'linear-gradient(135deg, white, oklch(0.94 0.02 85))',
        color: INK,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 8,
        boxShadow: '0 2px 6px rgba(0,0,0,0.18), inset 0 -2px 0 rgba(0,0,0,0.06)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gridTemplateRows: '1fr 1fr 1fr',
        padding: 6,
      }}
      aria-label={`${value}`}
    >
      {(PIPS[value] ?? []).map(([row, col]) => (
        <span
          key={`${row}-${col}`}
          style={{
            gridRow: row,
            gridColumn: col,
            justifySelf: 'center',
            alignSelf: 'center',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: RED,
          }}
        />
      ))}
    </motion.div>
  );
}
