import { generateMatchCode } from '@mahjong/protocol';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { isLanServerAvailable } from '../native/lan-server';
import { Modal } from './Modal';
import { GhostButton, PrimaryButton, TextField } from './buttons';

interface HostLanModalProps {
  open: boolean;
  onClose: () => void;
  onHosted: (hostUrl: string, matchCode: string) => void;
}

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  cream: '#f1eadc',
  hairline: '#cdc1ad',
};

/**
 * Host-side modal for starting a LAN match. Native port of
 * `_legacy/src/ui/HostLanModal.tsx`. Generates a fresh match code on
 * first open and shows the host URL the user must advertise to
 * guests.
 *
 * When the LanServer Expo native module isn't available (i.e. running
 * in Expo Go), the copy explains the limitation and the user has to
 * paste in their own LAN address. Once the dev client ships the
 * native module, `LanServer.start()` will populate `hostUrl`
 * automatically and the user just hits "Start hosting".
 */
export function HostLanModal({ open, onClose, onHosted }: HostLanModalProps) {
  const [hostUrl, setHostUrl] = useState('');
  const [matchCode, setMatchCode] = useState('');

  useEffect(() => {
    if (open) {
      setHostUrl('');
      setMatchCode(generateMatchCode());
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Host LAN match" maxWidth={460}>
      <View style={{ padding: 18, gap: 14 }}>
        <Text style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 18, fontWeight: '600' }}>
          {isLanServerAvailable()
            ? 'Share the URL and match code with anyone on the same Wi-Fi.'
            : "LAN hosting requires a development client (the native LanServer module isn't bundled in Expo Go). Until then, paste a host address you control; guests on the same Wi-Fi can connect with the match code below."}
        </Text>

        <TextField
          label="Host URL"
          value={hostUrl}
          onChangeText={setHostUrl}
          placeholder="http://192.168.1.42:7777"
        />

        <View
          style={{
            backgroundColor: COLORS.cream,
            borderColor: COLORS.hairline,
            borderWidth: 1,
            borderRadius: 10,
            paddingVertical: 12,
            paddingHorizontal: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <View>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '700',
                color: COLORS.ink3,
                letterSpacing: 0.6,
              }}
            >
              MATCH CODE
            </Text>
            <Text
              style={{
                fontFamily: 'Courier',
                fontSize: 22,
                fontWeight: '800',
                letterSpacing: 5,
                color: COLORS.ink,
                marginTop: 2,
              }}
              selectable
            >
              {matchCode}
            </Text>
          </View>
          <Text
            style={{
              fontSize: 11,
              color: COLORS.ink3,
              fontWeight: '600',
              maxWidth: 140,
              textAlign: 'right',
            }}
          >
            Share with guests so they can find this match.
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <GhostButton onPress={onClose}>Cancel</GhostButton>
          <PrimaryButton
            onPress={() => onHosted(hostUrl.trim(), matchCode)}
            disabled={!hostUrl.trim()}
          >
            Start hosting
          </PrimaryButton>
        </View>
      </View>
    </Modal>
  );
}
