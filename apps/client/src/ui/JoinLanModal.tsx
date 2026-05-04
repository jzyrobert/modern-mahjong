import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
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

const COLORS = {
  ink3: '#918275',
};

/**
 * Guest-side modal for joining a LAN match. Native port of
 * `_legacy/src/ui/JoinLanModal.tsx`. Two TextFields (URL + match code)
 * and a "Join match" primary; URL gets reset to `defaultUrl` whenever
 * the modal opens so a stale value from a previous attempt doesn't
 * stick.
 *
 * The actual join goes through `transport-context.joinLan(...)`, which
 * already accepts a host URL + match code and creates a WebSocket
 * transport pointed at the LAN host. The host needs to be running the
 * LanServer native module (dev client) for the connection to actually
 * land — guests on Expo Go can still construct the transport, but it
 * will fail to connect unless the host is real.
 */
export function JoinLanModal({ open, onClose, onJoin, defaultUrl = '' }: JoinLanModalProps) {
  const [url, setUrl] = useState(defaultUrl);
  const [code, setCode] = useState('');

  useEffect(() => {
    if (open) {
      setUrl(defaultUrl);
      setCode('');
    }
  }, [open, defaultUrl]);

  return (
    <Modal open={open} onClose={onClose} title="Join LAN match" maxWidth={420}>
      <View style={{ padding: 18, gap: 14 }}>
        <Text style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 18, fontWeight: '600' }}>
          Get the host's URL and match code from whoever's hosting, then paste them in.
        </Text>
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
