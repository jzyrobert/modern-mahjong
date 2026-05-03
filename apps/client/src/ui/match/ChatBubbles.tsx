import type { Seat } from '@mahjong/game-logic';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { HAIRLINE, INK, PAPER_HI, SANS } from '../../native/theme.js';
import { useGame } from '../../state/game.js';

interface ChatBubblesProps {
  /** Map seat → visual position so each bubble anchors next to the sender. */
  seatToPosition: Record<Seat, 'bottom' | 'right' | 'top' | 'left'>;
}

const DISMISS_MS = 3500;

/**
 * Floating emote bubbles. Renders one per `useGame.chats` entry near the
 * sender's visual position; auto-dismisses after `DISMISS_MS`. Stacks
 * multiple from the same seat by indexing the matching subset and
 * offsetting subsequent bubbles upward. Ported from
 * `/tmp/design/design/app.jsx::ChatBar` (the receiving half).
 */
export function ChatBubbles({ seatToPosition }: ChatBubblesProps) {
  const chats = useGame((s) => s.chats);
  const dismissChat = useGame((s) => s.dismissChat);

  useEffect(() => {
    if (chats.length === 0) return;
    const timers = chats.map((c) =>
      window.setTimeout(() => dismissChat(c.seq), DISMISS_MS - (Date.now() - c.ts)),
    );
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [chats, dismissChat]);

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 80,
      }}
    >
      <AnimatePresence>
        {chats.map((c, i) => {
          // Stack offset per chat from the same seat — newer bubbles ride
          // above older ones so they don't hide the previous emote.
          const sameFromOlder = chats.slice(0, i).filter((other) => other.from === c.from).length;
          const position = c.from === 'spectator' ? 'top' : seatToPosition[c.from];
          const anchor = ANCHOR[position];
          return (
            <motion.div
              key={c.seq}
              initial={{ opacity: 0, scale: 0.6, y: 0 }}
              animate={{ opacity: 1, scale: 1, y: -sameFromOlder * 38 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              style={{
                position: 'absolute',
                left: anchor.left,
                right: anchor.right,
                top: anchor.top,
                bottom: anchor.bottom,
                transform: anchor.transform,
                background: PAPER_HI,
                color: INK,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 14,
                padding: '6px 12px',
                fontFamily: SANS,
                fontSize: 22,
                lineHeight: 1,
                boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
                whiteSpace: 'nowrap',
              }}
            >
              {c.text}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

interface AnchorPosition {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
  transform?: string;
}

const ANCHOR: Record<'bottom' | 'right' | 'top' | 'left', AnchorPosition> = {
  bottom: { left: '50%', bottom: '120px', transform: 'translateX(-50%)' },
  right: { right: '24px', top: '50%', transform: 'translateY(-50%)' },
  top: { left: '50%', top: '120px', transform: 'translateX(-50%)' },
  left: { left: '24px', top: '50%', transform: 'translateY(-50%)' },
};
