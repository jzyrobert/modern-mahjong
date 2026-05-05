import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  addListener,
  isLanServerAvailable,
  startDiscovery as lanStartDiscovery,
  stopDiscovery as lanStopDiscovery,
} from '../native/lan-server';
import { Modal } from './Modal';
import { GhostButton, PrimaryButton, TextField } from './buttons';

interface JoinLanModalProps {
  open: boolean;
  onClose: () => void;
  onJoin: (hostUrl: string, matchCode: string) => void;
  /** Optional default — pre-fills the host URL when the page is being
   *  served from a LAN origin (web only). On native Expo the lobby
   *  doesn't have a window.location to detect, so this stays empty. */
  defaultUrl?: string;
}

interface DiscoveredHost {
  name: string;
  url: string; // Stored as `http://<host>:<port>` to match the URL field.
}

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  cream: '#f1eadc',
  hairline: '#cdc1ad',
  green: '#58c280',
};

/**
 * Guest-side modal for joining a LAN match. Native port of
 * `_legacy/src/ui/JoinLanModal.tsx`. Two TextFields (URL + match code)
 * and a "Join match" primary; URL gets reset to `defaultUrl` whenever
 * the modal opens so a stale value from a previous attempt doesn't
 * stick.
 *
 * On native builds where `LanServer` is autolinked (Android since #97),
 * the modal also subscribes to `LanServer.startDiscovery()` while open
 * and shows a tap-to-pick list of nearby hosts (`_modernmahjong._tcp.`
 * mDNS announcements). Selecting a host populates the URL field —
 * the user still types the match code separately to confirm intent.
 *
 * Web / Expo Go fall through `isLanServerAvailable()`: the discovery
 * list is hidden and the user pastes the URL by hand, same as before.
 */
export function JoinLanModal({ open, onClose, onJoin, defaultUrl = '' }: JoinLanModalProps) {
  const [url, setUrl] = useState(defaultUrl);
  const [code, setCode] = useState('');
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const [available] = useState(() => isLanServerAvailable());
  // Refs to keep the host map stable across renders without
  // re-subscribing every effect run.
  const hostsRef = useRef<Map<string, DiscoveredHost>>(new Map());

  useEffect(() => {
    if (open) {
      setUrl(defaultUrl);
      setCode('');
      hostsRef.current.clear();
      setHosts([]);
    }
  }, [open, defaultUrl]);

  // Discovery lifecycle: subscribe + start while open; tear down on
  // close. The native module silently no-ops on web / Expo Go.
  useEffect(() => {
    if (!open || !available) return;
    const foundSub = addListener('hostFound', ({ name, host, port }) => {
      hostsRef.current.set(name, { name, url: `http://${host}:${port}` });
      setHosts(Array.from(hostsRef.current.values()));
    });
    const lostSub = addListener('hostLost', ({ name }) => {
      hostsRef.current.delete(name);
      setHosts(Array.from(hostsRef.current.values()));
    });
    lanStartDiscovery().catch(() => undefined);
    return () => {
      foundSub.remove();
      lostSub.remove();
      lanStopDiscovery().catch(() => undefined);
    };
  }, [open, available]);

  return (
    <Modal open={open} onClose={onClose} title="Join LAN match" maxWidth={420}>
      <View style={{ padding: 18, gap: 14 }}>
        <Text style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 18, fontWeight: '600' }}>
          {available
            ? "Pick a nearby host below, or paste the host's URL + match code manually."
            : "Get the host's URL and match code from whoever's hosting, then paste them in."}
        </Text>

        {available ? (
          <DiscoveryList
            hosts={hosts}
            onPick={(picked) => setUrl(picked.url)}
            currentUrl={url.trim()}
          />
        ) : null}

        <TextField
          label="Host URL"
          value={url}
          onChangeText={setUrl}
          placeholder="http://192.168.1.42:7777"
        />
        <TextField
          label="Match code"
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          placeholder="ABCDE"
          mono
          maxLength={5}
          autoCapitalize="characters"
        />
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <GhostButton onPress={onClose}>Cancel</GhostButton>
          <PrimaryButton
            onPress={() => onJoin(url.trim(), code)}
            disabled={!url.trim() || code.length !== 5}
          >
            Join match
          </PrimaryButton>
        </View>
      </View>
    </Modal>
  );
}

interface DiscoveryListProps {
  hosts: DiscoveredHost[];
  onPick: (host: DiscoveredHost) => void;
  currentUrl: string;
}

function DiscoveryList({ hosts, onPick, currentUrl }: DiscoveryListProps) {
  if (hosts.length === 0) {
    return (
      <View
        style={{
          padding: 12,
          borderRadius: 10,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          backgroundColor: COLORS.cream,
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.ink3, letterSpacing: 0.6 }}>
          NEARBY HOSTS
        </Text>
        <Text style={{ fontSize: 12, color: COLORS.ink3, fontWeight: '600', marginTop: 4 }}>
          Scanning the local network… nothing yet.
        </Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.ink3, letterSpacing: 0.6 }}>
        NEARBY HOSTS
      </Text>
      {hosts.map((h) => {
        const selected = currentUrl === h.url;
        return (
          <Pressable
            key={h.name}
            onPress={() => onPick(h)}
            accessibilityRole="button"
            accessibilityLabel={`Pick host ${h.name}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: pressed ? '#ece4d3' : COLORS.cream,
              borderColor: selected ? COLORS.green : COLORS.hairline,
              borderWidth: selected ? 2 : 1,
            })}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: COLORS.green,
              }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.ink }}>{h.name}</Text>
              <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600' }}>{h.url}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
