import { generateMatchCode } from '@mahjong/protocol';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { getDisplayName } from '../identity';
import {
  isLanServerAvailable,
  advertise as lanAdvertise,
  start as lanStart,
  stop as lanStop,
  unadvertise as lanUnadvertise,
} from '../native/lan-server';
import { startLanHostBridge, stopLanHostBridge } from '../net/lan-host-bridge';
import { Modal } from './Modal';
import { GhostButton, PrimaryButton, TextField } from './buttons';
import { COLORS } from './colors';

interface HostLanModalProps {
  open: boolean;
  onClose: () => void;
  onHosted: (hostUrl: string, matchCode: string) => void;
}

// Port the embedded NanoHTTPD WSD listens on. Matches the legacy
// Capacitor LanServer convention so any prior copy-pasted URLs from
// the mobile app keep working. The server falls back to picking a
// free port if 7777 is already taken — we read the actual port back
// from `start()`'s response.
const HOST_PORT = 7777;

/**
 * Host-side modal for starting a LAN match. On open this fires
 * `LanServer.start({ port: 7777 })` if the native module is
 * available (Android dev/preview/production builds since #97); the
 * resolved LAN addresses auto-populate the host URL field, so the
 * user just hits "Start hosting".
 *
 * Web / Expo Go / iOS-skeleton fall through `isLanServerAvailable()`
 * (or a thrown `start()`): the URL field stays editable so the user
 * can paste a host they already control. Same flow as before #97.
 *
 * Server lifecycle:
 * - `start()` on `open === true`.
 * - `stop()` on cancel (modal dismissed without hosting). Frees the
 *   port for a subsequent re-open.
 * - **Not** stopped when the user clicks "Start hosting" — the
 *   match transport (`joinLan`) needs the server alive for the
 *   duration of the match. The server tears down when the match
 *   ends and the user navigates away.
 */
export function HostLanModal({ open, onClose, onHosted }: HostLanModalProps) {
  const [hostUrl, setHostUrl] = useState('');
  const [matchCode, setMatchCode] = useState('');
  // null = not running, number = bound port. `null` after a cancel
  // tells the close handler to skip a redundant stop() call.
  const [serverPort, setServerPort] = useState<number | null>(null);
  // Surfaces start() errors (e.g. iOS skeleton's "not implemented",
  // EADDRINUSE on a stale server) so the modal can fall back to the
  // manual-paste copy without silently swallowing the failure.
  const [startError, setStartError] = useState<string | null>(null);
  // Track whether the LanServer module is loaded *at all* (false on
  // web / Expo Go). Frozen at first render so dynamic toggles don't
  // re-trigger the start effect.
  const [available] = useState(() => isLanServerAvailable());

  useEffect(() => {
    if (!open) return;
    // Reset per-open state.
    setHostUrl('');
    setMatchCode(generateMatchCode());
    setStartError(null);
    setServerPort(null);

    if (!available) return;

    let cancelled = false;
    lanStart({ port: HOST_PORT })
      .then((res) => {
        if (cancelled) {
          // Modal closed before start() resolved — stop immediately.
          lanStop().catch(() => undefined);
          return;
        }
        setServerPort(res.port);
        if (res.addresses[0]) setHostUrl(res.addresses[0]);
        // Wire the in-process MatchSession bridge to the embedded
        // server's connection / message / close events. Without this,
        // the NanoHTTPD socket would upgrade fine but no `state`
        // reply would ever come back — the host's own client would
        // hang on "Connecting…" and then time out to "Couldn't reach
        // the match server". Idempotent — disposes any prior bridge
        // first.
        startLanHostBridge();
        // Advertise on mDNS so guest devices' JoinLanModal
        // discovery lists pick this host up automatically. Use the
        // local display name so the entry is human-recognisable
        // ("Robert's phone" rather than `_modernmahjong._tcp.<uuid>`).
        const serviceName = getDisplayName() || 'Modern Mahjong host';
        lanAdvertise({ serviceName, port: res.port }).catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStartError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [open, available]);

  const handleCancel = () => {
    if (serverPort !== null) {
      // Order matters: unadvertise before stop so guests see the
      // service drop while it's still resolvable. The bridge must
      // tear down with the server so a re-open of the modal starts
      // from a clean MatchSession (rather than reattaching stale
      // seats from the cancelled session).
      lanUnadvertise().catch(() => undefined);
      stopLanHostBridge();
      lanStop().catch(() => undefined);
      setServerPort(null);
    }
    onClose();
  };

  const handleStart = () => {
    onHosted(hostUrl.trim(), matchCode);
  };

  const blurb = !available
    ? "LAN hosting requires a development client (the native LanServer module isn't bundled in Expo Go). Until then, paste a host address you control; guests on the same Wi-Fi can connect with the match code below."
    : startError
      ? `Couldn't start the embedded server: ${startError}. Paste a host address manually as a fallback — guests can still connect with the match code below.`
      : serverPort !== null
        ? `Embedded server live on port ${serverPort}. Send the Join URL to anyone on the same Wi-Fi — it opens straight in any browser, no app install required.`
        : 'Starting the embedded server…';

  // Browser-friendly join URL: combines the host URL with the match
  // code so guests can paste it into a browser on the same Wi-Fi and
  // land directly in the pregame lobby. `MatchRoute` infers the LAN
  // host from `window.location.origin` when no `host` query param is
  // present, so this URL is self-contained — no second "host
  // address" copy step. Trailing slashes are stripped to avoid
  // ending up with `…//match?code=…`.
  const joinUrl = useMemo(() => {
    const trimmed = hostUrl.trim().replace(/\/$/, '');
    if (!trimmed) return '';
    return `${trimmed}/match?code=${encodeURIComponent(matchCode)}`;
  }, [hostUrl, matchCode]);
  const [joinUrlCopied, setJoinUrlCopied] = useState(false);
  useEffect(() => {
    if (!joinUrlCopied) return;
    const t = setTimeout(() => setJoinUrlCopied(false), 1500);
    return () => clearTimeout(t);
  }, [joinUrlCopied]);
  const onCopyJoinUrl = async () => {
    if (!joinUrl) return;
    try {
      await Clipboard.setStringAsync(joinUrl);
      setJoinUrlCopied(true);
    } catch {
      // Clipboard access can be denied on non-HTTPS browsers or
      // backgrounded native apps. The on-screen URL is selectable
      // for manual copy, so no recovery is needed here.
    }
  };

  return (
    <Modal open={open} onClose={handleCancel} title="Host LAN match" maxWidth={460}>
      <View style={{ padding: 18, gap: 14 }}>
        <Text style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 18, fontWeight: '600' }}>
          {blurb}
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

        {joinUrl ? (
          <View
            style={{
              backgroundColor: COLORS.cream,
              borderColor: COLORS.hairline,
              borderWidth: 1,
              borderRadius: 10,
              paddingVertical: 12,
              paddingHorizontal: 14,
              gap: 8,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: '700',
                color: COLORS.ink3,
                letterSpacing: 0.6,
              }}
            >
              JOIN URL
            </Text>
            <Text
              selectable
              numberOfLines={2}
              style={{
                fontFamily: 'JetBrains Mono',
                fontSize: 12,
                color: COLORS.ink,
                lineHeight: 16,
              }}
            >
              {joinUrl}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Pressable
                onPress={onCopyJoinUrl}
                accessibilityRole="button"
                accessibilityLabel={joinUrlCopied ? 'Join URL copied' : 'Copy join URL'}
                style={({ pressed }) => ({
                  backgroundColor: joinUrlCopied
                    ? '#c2e2c5'
                    : pressed
                      ? COLORS.creamPressed
                      : COLORS.creamLow,
                  borderColor: joinUrlCopied ? '#2d8645' : COLORS.hairline,
                  borderWidth: 1,
                  borderRadius: 8,
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                })}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '800',
                    letterSpacing: 0.6,
                    color: joinUrlCopied ? '#2d8645' : COLORS.ink,
                  }}
                >
                  {joinUrlCopied ? 'COPIED' : 'COPY'}
                </Text>
              </Pressable>
              <Text
                style={{
                  flexShrink: 1,
                  fontSize: 11,
                  color: COLORS.ink3,
                  fontWeight: '600',
                  lineHeight: 16,
                }}
              >
                Open in any browser on the same Wi-Fi — no app required.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <GhostButton onPress={handleCancel}>Cancel</GhostButton>
          <PrimaryButton onPress={handleStart} disabled={!hostUrl.trim()}>
            Start hosting
          </PrimaryButton>
        </View>
      </View>
    </Modal>
  );
}
