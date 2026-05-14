import type { LobbySummary } from '@mahjong/protocol';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTransport } from '../net/transport-context';
import { Modal } from './Modal';
import { GhostButton, PrimaryButton } from './buttons';
import { COLORS } from './colors';

interface BrowseLobbyModalProps {
  open: boolean;
  onClose: () => void;
  onJoin: (code: string) => void;
}

type FetchStatus = 'idle' | 'loading' | 'error';

/**
 * Bottom-sheet modal listing every public match the server currently
 * advertises. Fetches `GET /lobbies` on open + on manual refresh, and
 * surfaces each lobby as a row with host name + player count + a Join
 * affordance.
 *
 * Empty state: friendly nudge that no one's hosting right now. Error
 * state: surfaces the failure (server offline, older server without
 * the endpoint, etc.) — the user retries via the top Refresh button.
 * Loading state: spinner-less "Loading…" line — the lobby list is
 * small enough that a real spinner would feel out of place.
 */
export function BrowseLobbyModal({ open, onClose, onJoin }: BrowseLobbyModalProps) {
  const transport = useTransport();
  const [lobbies, setLobbies] = useState<LobbySummary[]>([]);
  const [status, setStatus] = useState<FetchStatus>('idle');

  const refresh = useCallback(async () => {
    setStatus('loading');
    const res = await transport.fetchOpenLobbies();
    if (res === null) {
      setLobbies([]);
      setStatus('error');
      return;
    }
    setLobbies(res.lobbies);
    setStatus('idle');
  }, [transport]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  return (
    <Modal open={open} onClose={onClose} title="Browse open lobbies" placement="bottom">
      <View style={{ padding: 16, gap: 12, maxHeight: 520 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <Text style={{ fontSize: 12, color: COLORS.ink3 }}>
            Live online matches with at least one human host. Tap a row to join.
          </Text>
          <GhostButton onPress={refresh}>Refresh</GhostButton>
        </View>
        <StatusBanner status={status} hasLobbies={lobbies.length > 0} />
        <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 8 }}>
          {lobbies.map((l) => (
            <LobbyRow
              key={l.code}
              lobby={l}
              onJoin={() => {
                onJoin(l.code);
                onClose();
              }}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

interface StatusBannerProps {
  status: FetchStatus;
  hasLobbies: boolean;
}

/** Renders the loading / error / empty messaging slot above the list.
 *  Returns null when there's a populated list to show — the rows speak
 *  for themselves in that case. */
function StatusBanner({ status, hasLobbies }: StatusBannerProps) {
  if (status === 'error') {
    return (
      <View style={{ gap: 6, paddingVertical: 8 }}>
        <Text style={{ fontSize: 13, color: COLORS.red, fontWeight: '700' }}>
          Couldn't reach the lobby browser
        </Text>
        <Text style={{ fontSize: 12, color: COLORS.ink3 }}>
          The server may be offline, or this build pre-dates the lobby browser feature. You can
          still join a match by entering its code directly.
        </Text>
      </View>
    );
  }
  if (status === 'loading' && !hasLobbies) {
    return <Text style={{ fontSize: 13, color: COLORS.ink3, paddingVertical: 16 }}>Loading…</Text>;
  }
  if (!hasLobbies) {
    return (
      <Text style={{ fontSize: 13, color: COLORS.ink3, paddingVertical: 8, fontStyle: 'italic' }}>
        No open lobbies right now. Host your own from the Online card, or refresh in a moment.
      </Text>
    );
  }
  return null;
}

interface LobbyRowProps {
  lobby: LobbySummary;
  onJoin: () => void;
}

function LobbyRow({ lobby, onJoin }: LobbyRowProps) {
  const seatsTaken = lobby.humanCount + lobby.botCount;
  const seatsOpen = lobby.totalSeats - seatsTaken;
  return (
    <Pressable
      onPress={onJoin}
      accessibilityLabel={`Join ${lobby.hostName ?? lobby.code}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: COLORS.hairline,
        backgroundColor: pressed ? COLORS.cream : COLORS.paperHi,
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: '900', color: COLORS.ink }} numberOfLines={1}>
            {lobby.hostName ?? '(no host)'}
          </Text>
          <Text
            style={{
              fontSize: 11,
              fontWeight: '800',
              color: COLORS.red,
              letterSpacing: 1.2,
            }}
          >
            #{lobby.code}
          </Text>
          {lobby.isInProgress ? (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 6,
                backgroundColor: '#f0e3d0',
              }}
            >
              <Text style={{ fontSize: 9, fontWeight: '900', color: '#a16b1c', letterSpacing: 1 }}>
                PLAYING
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontSize: 11, color: COLORS.ink3 }}>
          {lobby.humanCount} human{lobby.humanCount === 1 ? '' : 's'}
          {lobby.botCount > 0 ? ` · ${lobby.botCount} bot${lobby.botCount === 1 ? '' : 's'}` : ''}
          {seatsOpen > 0 ? ` · ${seatsOpen} seat${seatsOpen === 1 ? '' : 's'} open` : ' · full'}
          {` · faan ≥ ${lobby.rules.faanMin}`}
        </Text>
      </View>
      <PrimaryButton onPress={onJoin}>{seatsOpen > 0 ? 'Join' : 'Watch'}</PrimaryButton>
    </Pressable>
  );
}
