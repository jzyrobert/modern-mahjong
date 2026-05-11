import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import { COLORS } from '../colors';

interface LanInviteCardProps {
  /** LAN host URL the embedded NanoHTTPD server is bound to, e.g.
   *  `http://192.168.1.42:7777`. Encoded into the deep link's `host`
   *  query param so the recipient's MatchRoute reload-survival effect
   *  fires `transport.joinLan(host, code)` automatically. */
  hostUrl: string;
  /** Five-letter match code the embedded MatchSession projected for
   *  this room. Goes into the deep link's `code` query param. */
  matchCode: string;
}

/**
 * Pre-game lobby card shown on the LAN host's `Match` waiting screen.
 * Generates a `modernmahjong://match?code=…&host=…` deep link via
 * `Linking.createURL` and exposes a Copy + (where supported) Share
 * action so the host can hand a one-tap-join URL to a friend in any
 * chat app. The recipient — once on the same Wi-Fi with the app
 * installed — taps the link, the OS routes it through the
 * `modernmahjong` scheme into `/match`, and the existing reload-
 * survival effect in `apps/client/app/match.tsx` calls
 * `transport.joinLan(host, code)` for them.
 *
 * Why we use `Linking.createURL` rather than hardcoding the scheme:
 * native dev builds, Expo Go, and production release builds each
 * resolve the scheme differently (Expo Go injects `exp://…/--/`,
 * production uses `modernmahjong://`). `createURL` reads the active
 * config and produces the right prefix for the current binary, so the
 * link the host shares always matches what their build accepts when
 * tapped back in.
 *
 * Visible only to the host — guests don't need to re-share the link
 * to themselves, and they already saw the same URL in `JoinLanModal`.
 */
export function LanInviteCard({ hostUrl, matchCode }: LanInviteCardProps) {
  const inviteUrl = useMemo(
    () => Linking.createURL('/match', { queryParams: { code: matchCode, host: hostUrl } }),
    [hostUrl, matchCode],
  );
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const onCopy = async () => {
    try {
      await Clipboard.setStringAsync(inviteUrl);
      setCopied(true);
    } catch {
      // Clipboard access can be denied on browsers without HTTPS or on
      // backgrounded native apps. Failing silently is fine — the user
      // can long-press the displayed URL to fall back to native text
      // selection.
    }
  };

  // The React Native `Share` API is available on iOS + Android but
  // missing on web (RN-Web ships a stub that throws). Gate the Share
  // affordance so web hosts still see the Copy button without a dead
  // control sitting next to it.
  const canShare = Platform.OS === 'ios' || Platform.OS === 'android';
  const onShare = async () => {
    try {
      await Share.share({
        message: `Join my mahjong match: ${inviteUrl}`,
        url: inviteUrl,
      });
    } catch {
      // User dismissed the share sheet, or the OS surfaced a transient
      // intent-resolution failure. Either way the link is still in the
      // clipboard option below — nothing to recover.
    }
  };

  return (
    <View
      style={{
        marginTop: 12,
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 14,
        padding: 16,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 14, fontWeight: '900', color: COLORS.ink }}>Invite link</Text>
        <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '700' }}>
          · one-tap join on the same Wi-Fi
        </Text>
      </View>

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
          {inviteUrl}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pressable
          onPress={onCopy}
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Invite link copied' : 'Copy invite link'}
          style={({ pressed }) => ({
            backgroundColor: copied ? '#c2e2c5' : pressed ? COLORS.creamPressed : COLORS.creamLow,
            borderColor: copied ? '#2d8645' : COLORS.hairline,
            borderWidth: 1,
            borderRadius: 8,
            paddingVertical: 8,
            paddingHorizontal: 14,
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
            {copied ? 'COPIED' : 'COPY LINK'}
          </Text>
        </Pressable>

        {canShare ? (
          <Pressable
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel="Share invite link"
            style={({ pressed }) => ({
              backgroundColor: pressed ? COLORS.creamPressed : COLORS.creamLow,
              borderColor: COLORS.hairline,
              borderWidth: 1,
              borderRadius: 8,
              paddingVertical: 8,
              paddingHorizontal: 14,
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
      </View>

      <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600', lineHeight: 16 }}>
        Recipients need the Modern Mahjong app installed and must be on the same Wi-Fi as you.
      </Text>
    </View>
  );
}
