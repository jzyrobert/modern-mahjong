import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { HAIRLINE, INK_2, SANS, TILE_BACK_BG } from '../native/theme.js';
import { useGame } from '../state/game.js';

const SHUFFLE_MS = 1700;
const SPIN_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/**
 * Brief between-hands shuffle ceremony — fans a small ring of face-down
 * tiles that spin into a swirl while the wall is being rebuilt for the
 * next hand. Triggered by transitions out of `resolved` (the previous
 * hand has wrapped up, a fresh one is about to start).
 *
 * The backdrop is a radial gradient (dark at the center where the swirl
 * lives, transparent towards the edges) instead of a uniform black tint.
 * This way the actual table tiles — which are simultaneously animating
 * from their old positions in hands/discards/wall to their new wall
 * positions via framer-motion's `layoutId` — stay visible behind the
 * swirl. The "real" mechanical dispense (engine state-machine pause +
 * gather-into-center-pile-then-disperse) is still queued; this is the
 * cheap halfway visualization.
 */
export function ShuffleOverlay() {
  const phase = useGame((s) => s.state?.phase);
  const seed = useGame((s) => s.state?.seed);
  const setShuffling = useGame((s) => s.setShuffling);
  const lastSeed = useRef<number | undefined>(undefined);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (seed === undefined) return;
    if (lastSeed.current !== undefined && lastSeed.current !== seed) {
      setActive(true);
      // Tell Tile to swap to a slower spring while the dispense plays out —
      // see the comment on `shuffling` in state/game.ts.
      setShuffling(true);
      const timer = setTimeout(() => {
        setActive(false);
        setShuffling(false);
      }, SHUFFLE_MS);
      lastSeed.current = seed;
      return () => clearTimeout(timer);
    }
    lastSeed.current = seed;
  }, [seed, setShuffling]);

  // Suppress while a new hand's dice ceremony is taking over visual focus.
  void phase;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            // Soft cream backdrop with a deeper centre — keeps the swirl
            // readable while the table tiles animating behind via
            // layoutId stay visible at the edges.
            background:
              'radial-gradient(circle at center, oklch(0.93 0.02 85 / 0.85) 10%, oklch(0.93 0.02 85 / 0.1) 70%)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            zIndex: 90,
            pointerEvents: 'none',
          }}
        >
          <div style={{ position: 'relative', width: 220, height: 220 }}>
            {SPIN_INDICES.map((i) => (
              <SpinningTile key={`spin-${i}`} index={i} />
            ))}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: INK_2,
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: 0.6,
                fontFamily: SANS,
              }}
            >
              Shuffling…
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const RADIUS = 80;

function SpinningTile({ index }: { index: number }) {
  const angle = (index / 12) * Math.PI * 2;
  const x = Math.cos(angle) * RADIUS;
  const y = Math.sin(angle) * RADIUS;
  return (
    <motion.div
      initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
      animate={{ x, y, opacity: 1, rotate: 360 }}
      exit={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
      transition={{
        duration: SHUFFLE_MS / 1000,
        ease: 'easeInOut',
        delay: index * 0.025,
      }}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        marginTop: -22,
        marginLeft: -16,
        width: 32,
        height: 44,
        // Falls back to TILE_BACK_BG when run outside a Match (no
        // --tile-back-1/2 CSS vars set); inside a Match the Settings
        // panel's tile-back skin overrides apply.
        background: `linear-gradient(180deg, var(--tile-back-1, ${TILE_BACK_BG}), var(--tile-back-2, ${TILE_BACK_BG}))`,
        borderRadius: 4,
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        border: `1px solid ${HAIRLINE}`,
      }}
    />
  );
}
