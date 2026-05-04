import { Pressable, Text, View } from 'react-native';

interface ChatBarProps {
  onSend: (text: string) => void;
}

const EMOTES = ['👍', '😎', '🎉', '🤔', '😅', '🔥'] as const;

const COLORS = {
  ink3: 'oklch(0.55 0.04 60)',
  paperHi: 'oklch(0.99 0.005 85)',
  hairline: 'oklch(0.86 0.02 80)',
};

/**
 * Six-emote chat bar. Native port of
 * `_legacy/src/ui/match/ChatBar.tsx`. Each tap fires `onSend` with
 * the emoji string; the server broadcasts back as `chat` and
 * `<ChatBubbles>` renders a floating bubble near the sender.
 */
export function ChatBar({ onSend }: ChatBarProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        borderRadius: 12,
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          fontSize: 9,
          fontWeight: '800',
          letterSpacing: 0.6,
          color: COLORS.ink3,
          paddingHorizontal: 6,
        }}
      >
        EMOTE
      </Text>
      {EMOTES.map((emote) => (
        <Pressable
          key={emote}
          onPress={() => onSend(emote)}
          accessibilityLabel={`Send ${emote}`}
          style={({ pressed }) => ({
            width: 30,
            height: 30,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: pressed ? 0.92 : 1 }],
          })}
        >
          <Text style={{ fontSize: 18, lineHeight: 22 }}>{emote}</Text>
        </Pressable>
      ))}
    </View>
  );
}
