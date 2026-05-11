import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import { COLORS } from '../colors';

interface LanInviteCardProps {
  /** LAN host URL the embedded NanoHTTPD server is bound to, e.g.
   *  `http://192.168.1.42:7777`. Used as the origin of the browser
   *  join URL (the host's own web bundle is served from here) and
   *  encoded into the deep link's `host` query param so app users get
   *  picked up by `transport.joinLan(host, code)` automatically. */
  hostUrl: string;
  /** Five-letter match code the embedded MatchSession projected for
   *  this room. Goes into both URLs' `code` query param. */
  matchCode: string;
}

interface CopyableLinkProps {
  title: string;
  hint: string;
  url: string;
  canShare: boolean;
  shareLabel?: string;
}

/**
 * Pre-game lobby card shown on the LAN host's `Match` waiting screen.
 * Surfaces two share-friendly URLs guests can use to drop directly
 * into the host's match — no manual "paste this host + retype the
 * code" round-trip:
 *
 *  - **Browser URL** — `http://<lan-ip>:<port>/match?code=…`. Works
 *    in any browser on the same Wi-Fi because the host's own
 *    NanoHTTPD serves the Expo Web bundle from the same origin (see
 *    `apps/client/modules/expo-lan-server/.../LanServerModule.kt`).
 *    The bundle's `MatchRoute` infers the host from
 *    `window.location.origin` when no explicit `host` query param is
 *    present (see `apps/client/app/match.tsx`), so this single URL
 *    is enough. Primary share affordance — no app install required.
 *
 *  - **Native deep link** — `modernmahjong://match?code=…&host=…`
 *    generated via `Linking.createURL`. For guests who already have
 *    the app installed; tapping the link opens the app directly via
 *    the `modernmahjong` scheme registered in `app.json`.
 *
 * Why use `Linking.createURL` for the deep link: native dev builds,
 * Expo Go, and production release builds each resolve the scheme
 * differently (Expo Go injects `exp://…/--/`, production uses
 * `modernmahjong://`). `createURL` produces the prefix matching the
 * current binary so the link the host shares is the one their build
 * accepts when tapped back in.
 *
 * Visible only to the host — guests already know the URL they came
 * from and don't need to re-share.
 */
export function LanInviteCard({ hostUrl, matchCode }: LanInviteCardProps) {
  const browserUrl = useMemo(() => {
    const trimmed = hostUrl.trim().replace(/\/$/, '');
    if (!trimmed) return '';
    return `${trimmed}/match?code=${encodeURIComponent(matchCode)}`;
  }, [hostUrl, matchCode]);
  const deepLinkUrl = useMemo(
    () => Linking.createURL('/match', { queryParams: { code: matchCode, host: hostUrl } }),
    [hostUrl, matchCode],
  );

  const canShare = Platform.OS === 'ios' || Platform.OS === 'android';

  return (
    <View
      style={{
        marginTop: 12,
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 14,
        padding: 16,
        gap: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 14, fontWeight: '900', color: COLORS.ink }}>Invite guests</Text>
        <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '700' }}>
          · share either link with anyone on the same Wi-Fi
        </Text>
      </View>

      {browserUrl ? (
        <CopyableLink
          title="Browser link"
          hint="No app install needed — opens in any browser on the same Wi-Fi."
          url={browserUrl}
          canShare={canShare}
          shareLabel="Share browser link"
        />
      ) : null}

      <CopyableLink
        title="App deep link"
        hint="For guests who already have the Modern Mahjong app installed."
        url={deepLinkUrl}
        canShare={canShare}
        shareLabel="Share deep link"
      />
    </View>
  );
}

/**
 * Compact URL row with COPY + (where supported) SHARE. Used for both
 * the browser-friendly and deep-link URLs inside `<LanInviteCard>`.
 * Local copy-confirmation state so each row's "COPIED" pulse is
 * independent of the other.
 */
function CopyableLink({ title, hint, url, canShare, shareLabel }: CopyableLinkProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const onCopy = async () => {
    try {
      await Clipboard.setStringAsync(url);
      setCopied(true);
    } catch {
      // Clipboard access can be denied on browsers without HTTPS or on
      // backgrounded native apps. Failing silently is fine — the user
      // can long-press the displayed URL to fall back to native text
      // selection.
    }
  };

  const onShare = async () => {
    try {
      await Share.share({ message: `Join my mahjong match: ${url}`, url });
    } catch {
      // User dismissed the share sheet, or the OS surfaced a transient
      // intent-resolution failure. The URL remains in the on-screen
      // box for manual copy, so no recovery needed.
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.ink, letterSpacing: 0.3 }}>
        {title}
      </Text>
      <View
        style={{
          backgroundColor: COLORS.cream,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          borderRadius: 8,
          paddingVertical: 8,
          paddingHorizontal: 10,
        }}
      >
        <Text
          selectable
          numberOfLines={2}
          style={{
            fontFamily: 'JetBrains Mono',
            fontSize: 11,
            color: COLORS.ink,
            lineHeight: 16,
          }}
        >
          {url}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pressable
          onPress={onCopy}
          accessibilityRole="button"
          accessibilityLabel={copied ? `${title} copied` : `Copy ${title.toLowerCase()}`}
          style={({ pressed }) => ({
            backgroundColor: copied ? '#c2e2c5' : pressed ? COLORS.creamPressed : COLORS.creamLow,
            borderColor: copied ? '#2d8645' : COLORS.hairline,
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
              color: copied ? '#2d8645' : COLORS.ink,
            }}
          >
            {copied ? 'COPIED' : 'COPY'}
          </Text>
        </Pressable>

        {canShare ? (
          <Pressable
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel={shareLabel ?? `Share ${title.toLowerCase()}`}
            style={({ pressed }) => ({
              backgroundColor: pressed ? COLORS.creamPressed : COLORS.creamLow,
              borderColor: COLORS.hairline,
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
                color: COLORS.ink,
              }}
            >
              SHARE
            </Text>
          </Pressable>
        ) : null}

        <Text
          style={{
            flexShrink: 1,
            fontSize: 11,
            color: COLORS.ink3,
            fontWeight: '600',
            lineHeight: 16,
          }}
        >
          {hint}
        </Text>
      </View>
    </View>
  );
}
