import { Pressable, Text, View } from 'react-native';

interface ChatBarProps {
  onSend: (text: string) => void;
}

const EMOTES = ['👍', '😎', '🎉', '🤔', '😅', '🔥'] as const;

const COLORS = {
  ink3: '#918275',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
};

/**
 * Six-emote chat bar. Each tap fires `onSend` with
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
        boxShadow: '0px 2px 10px rgba(0,0,0,0.08)',
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
