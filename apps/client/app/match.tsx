import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useGame } from '@/src/state/game';
import { useTransport } from '@/src/net/transport-context';

/**
 * Phase 4 stub. Once a transport opens, the index route forwards here.
 * Phase 4 will replace this with the real match UI (Hand, Wall, Table,
 * etc.). For now we just confirm the transport landed and provide a
 * Leave button so users can return to the lobby.
 */
export default function Match() {
  const router = useRouter();
  const transport = useTransport();
  const state = useGame((s) => s.state);
  const lobby = useGame((s) => s.lobby);
  const you = useGame((s) => s.you);

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 28, fontWeight: '900', color: 'oklch(0.25 0.04 60)' }}>
        Match
      </Text>
      <Text style={{ fontSize: 14, color: 'oklch(0.55 0.04 60)' }}>
        Phase 4 will fill this in. For now, a confirmation that the transport opened:
      </Text>
      <View
        style={{
          backgroundColor: 'oklch(0.99 0.005 85)',
          borderColor: 'oklch(0.86 0.02 80)',
          borderWidth: 1,
          borderRadius: 12,
          padding: 14,
          gap: 4,
        }}
      >
        <Text style={{ fontSize: 13, color: 'oklch(0.25 0.04 60)' }}>
          Match code: {transport.matchCode ?? '—'}
        </Text>
        <Text style={{ fontSize: 13, color: 'oklch(0.25 0.04 60)' }}>
          Phase: {state?.phase ?? '—'}
        </Text>
        <Text style={{ fontSize: 13, color: 'oklch(0.25 0.04 60)' }}>
          Your seat: {you ?? '—'}
        </Text>
        <Text style={{ fontSize: 13, color: 'oklch(0.25 0.04 60)' }}>
          Players: {lobby?.players.length ?? 0}
        </Text>
      </View>
      <Pressable
        onPress={() => {
          transport.leave();
          router.replace('/');
        }}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          backgroundColor: pressed ? 'oklch(0.97 0.01 80)' : 'white',
          borderColor: 'oklch(0.86 0.02 80)',
          borderWidth: 1,
          borderRadius: 10,
          paddingHorizontal: 16,
          paddingVertical: 10,
        })}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: 'oklch(0.25 0.04 60)' }}>
          Leave
        </Text>
      </Pressable>
    </View>
  );
}
