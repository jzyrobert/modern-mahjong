import type { Seat } from '@mahjong/game-logic';
import { useEffect, useRef } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useGame } from '../../state/game';

interface ChatBubblesProps {
  seatToPosition: Record<Seat, 'bottom' | 'right' | 'top' | 'left'>;
}

const DISMISS_MS = 3500;

const ANCHOR: Record<'bottom' | 'right' | 'top' | 'left', ViewStyle> = {
  bottom: { left: '50%' as const, bottom: 120 },
  right: { right: 24, top: '50%' as const },
  top: { left: '50%' as const, top: 120 },
  left: { left: 24, top: '50%' as const },
};

/**
 * Floating emote bubbles. Native port of
 * `_legacy/src/ui/match/ChatBubbles.tsx`. Schedules one auto-dismiss
 * timer per chat seq via a ref-tracked `Set` (matches PR #73's
 * non-churning pattern). Reanimated's `FadeIn` / `FadeOut` provide
 * the entry/exit animation; static positioning instead of the
 * legacy framer-motion stacking offset (offsets per-seat would need
 * a separate render-pass which we'll add in a polish pass).
 */
export function ChatBubbles({ seatToPosition }: ChatBubblesProps) {
  const chats = useGame((s) => s.chats);
  const dismissChat = useGame((s) => s.dismissChat);

  const scheduled = useRef(new Set<number>());
  useEffect(() => {
    for (const c of chats) {
      if (scheduled.current.has(c.seq)) continue;
      scheduled.current.add(c.seq);
      const remaining = Math.max(0, DISMISS_MS - (Date.now() - c.ts));
      setTimeout(() => {
        dismissChat(c.seq);
        scheduled.current.delete(c.seq);
      }, remaining);
    }
  }, [chats, dismissChat]);

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 80,
      }}
    >
      {chats.map((c) => {
        const position = c.from === 'spectator' ? 'top' : seatToPosition[c.from];
        const anchor = ANCHOR[position];
        const horiz = position === 'top' || position === 'bottom';
        const transform = horiz ? [{ translateX: -20 }] : [{ translateY: -16 }];
        return (
          <Animated.View
            key={c.seq}
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
            style={[
              {
                position: 'absolute',
                transform,
                backgroundColor: '#fbf8f0',
                borderColor: '#cdc1ad',
                borderWidth: 1,
                borderRadius: 14,
                paddingVertical: 6,
                paddingHorizontal: 12,
                shadowColor: '#000',
                shadowOpacity: 0.18,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
                elevation: 4,
              },
              anchor,
            ]}
          >
            <Text style={{ fontSize: 22, lineHeight: 24 }}>{c.text}</Text>
          </Animated.View>
        );
      })}
    </View>
  );
}
