import type { Seat } from '@mahjong/game-logic';
import { useEffect, useRef } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { useGame } from '../../state/game';
import { DISMISS_MS } from '../timing';

interface ChatBubblesProps {
  seatToPosition: Record<Seat, 'bottom' | 'right' | 'top' | 'left'>;
}

const ANCHOR: Record<'bottom' | 'right' | 'top' | 'left', ViewStyle> = {
  bottom: { left: '50%' as const, bottom: 120 },
  right: { right: 24, top: '50%' as const },
  top: { left: '50%' as const, top: 120 },
  left: { left: 24, top: '50%' as const },
};

/**
 * Floating emote bubbles. Renders as a plain `<View>` — `react-native-
 * reanimated` was stripped in the Expo Router migration so the bubble
 * appears instantly and disappears after `DISMISS_MS`. The
 * scheduling logic owns the timeline; if entry/exit animation is
 * wanted later, swap the inner `<View>` for an `Animated.View` driven
 * by core RN `Animated` (no reanimated dependency).
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
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 80,
        pointerEvents: 'none',
      }}
    >
      {chats.map((c) => {
        const position = c.from === 'spectator' ? 'top' : seatToPosition[c.from];
        const anchor = ANCHOR[position];
        const horiz = position === 'top' || position === 'bottom';
        const transform = horiz ? [{ translateX: -20 }] : [{ translateY: -16 }];
        return (
          <View
            key={c.seq}
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
                boxShadow: '0px 2px 6px rgba(0,0,0,0.18)',
              },
              anchor,
            ]}
          >
            <Text style={{ fontSize: 22, lineHeight: 24 }}>{c.text}</Text>
          </View>
        );
      })}
    </View>
  );
}
