import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { playWinFanfare } from '../native/sound.js';
import { GOLD, HAIRLINE, INK, INK_3, PAPER_HI, RED, SANS, SERIF } from '../native/theme.js';
import { nameForSeat, useGame } from '../state/game.js';

const DISMISS_MS = 3500;

/**
 * Brief celebratory overlay that fires when `state.lastResult.kind === 'win'`.
 * The actual scoring breakdown still lives in ResultPanel below; this is the
 * "the hand resolved with a win" flourish — gold confetti dots + a TC-serif
 * 和 emblem + winner name + faan readout — that auto-dismisses after ~3.5s
 * (or on tap).
 *
 * Suppressed for draws — there's nothing to celebrate when the wall empties.
 */
export function WinCelebration() {
  const result = useGame((s) => s.state?.lastResult);
  const lobby = useGame((s) => s.lobby);
  const [dismissed, setDismissed] = useState(false);

  // Each new resolution allocates a fresh `lastResult` reference. Reset the
  // dismissed flag on each new win so a back-to-back win still celebrates,
  // and play the fanfare exactly once per win.
  useEffect(() => {
    if (!result) return;
    setDismissed(false);
    if (result.kind === 'win') playWinFanfare();
    const timer = setTimeout(() => setDismissed(true), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [result]);

  const visible = !!result && result.kind === 'win' && !dismissed;
  const win = result && result.kind === 'win' ? result : null;

  // Window-level Escape so keyboard users can dismiss without focusing the
  // backdrop (mirrors the pattern in `Modal.tsx`).
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDismissed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && win ? (
        // biome-ignore lint/a11y/useSemanticElements: native <dialog> needs showModal() to be truly modal, which doesn't compose with framer-motion enter/exit
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="win-celebration-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={() => setDismissed(true)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 110,
            background: 'oklch(0.2 0.02 60 / 0.55)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            fontFamily: SANS,
            cursor: 'pointer',
          }}
        >
          <Confetti />
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              background: PAPER_HI,
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 24,
              padding: '40px 56px',
              minWidth: 340,
              textAlign: 'center',
              boxShadow:
                '0 24px 60px rgba(0,0,0,0.3), 0 0 0 6px oklch(0.78 0.14 80 / 0.2), 0 0 80px oklch(0.78 0.14 80 / 0.35)',
              cursor: 'default',
            }}
          >
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss win celebration"
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 28,
                height: 28,
                border: 'none',
                background: 'transparent',
                color: INK_3,
                cursor: 'pointer',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <motion.div
              animate={{ scale: [1, 1.12, 1], rotate: [-3, 3, -3] }}
              transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
              style={{
                fontFamily: SERIF,
                fontSize: 96,
                lineHeight: 1,
                color: RED,
                fontWeight: 700,
                marginBottom: 8,
                textShadow: '0 6px 22px oklch(0.55 0.18 25 / 0.35)',
              }}
            >
              和
            </motion.div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
                color: GOLD,
                marginBottom: 8,
              }}
            >
              Winner
            </div>
            <div
              id="win-celebration-title"
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: INK,
                marginBottom: 12,
                wordBreak: 'break-word',
              }}
            >
              {nameForSeat(lobby, win.winner)}
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 6,
                background: 'oklch(0.96 0.04 30)',
                border: '1px solid oklch(0.86 0.06 30)',
                borderRadius: 12,
                padding: '8px 16px',
                marginBottom: 14,
              }}
            >
              <span
                style={{
                  fontFamily: SERIF,
                  fontSize: 28,
                  fontWeight: 700,
                  color: RED,
                  lineHeight: 1,
                }}
              >
                {win.faan}
              </span>
              <span style={{ fontFamily: SERIF, fontSize: 16, color: RED, fontWeight: 600 }}>
                番
              </span>
              <span style={{ fontSize: 12, fontWeight: 800, color: INK, marginLeft: 4 }}>faan</span>
            </div>
            <div style={{ fontSize: 13, color: INK_3, fontWeight: 600 }}>
              {win.selfDraw ? '自摸 · self-draw' : `Won off seat ${win.from}`}
            </div>
            <div style={{ fontSize: 10, color: INK_3, marginTop: 18, opacity: 0.6 }}>
              Tap anywhere to dismiss
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

const CONFETTI_DOTS = Array.from({ length: 18 }, (_, i) => i);
const CONFETTI_COLORS = [
  'oklch(0.78 0.16 75)', // gold
  'oklch(0.7 0.18 28)', // coral
  'oklch(0.7 0.13 230)', // sky
  'oklch(0.7 0.13 150)', // jade
  'oklch(0.7 0.1 320)', // mauve
];

function Confetti() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {CONFETTI_DOTS.map((i) => {
        const seed = (i * 9301 + 49297) % 233280;
        const startX = (seed / 233280) * 100;
        const drift = ((seed * 7) % 200) - 100;
        const delay = (i % 6) * 0.08;
        const size = 8 + (seed % 6);
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
        return (
          <motion.span
            key={i}
            initial={{ y: -40, x: 0, opacity: 0, rotate: 0 }}
            animate={{
              y: ['-10%', '110%'],
              x: [0, drift, drift / 2],
              opacity: [0, 1, 1, 0],
              rotate: [0, 360, 720],
            }}
            transition={{
              duration: 2.6,
              delay,
              ease: 'easeOut',
            }}
            style={{
              position: 'absolute',
              left: `${startX}%`,
              top: 0,
              width: size,
              height: size * 1.4,
              background: color,
              borderRadius: 2,
              boxShadow: `0 0 6px ${color}`,
            }}
          />
        );
      })}
    </div>
  );
}
