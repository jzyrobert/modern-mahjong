import { SEATS } from '@mahjong/game-logic';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import type { LobbyState } from '../../state/game';
import { COLORS as SHARED_COLORS } from '../colors';
import { SEAT_WIND_GLYPH } from '../winds';

interface LobbyPreviewProps {
  lobby: LobbyState;
  matchCode: string | null;
}

// Layout breakpoint for the seat-card grid. Below 620 px the four
// cards reflow to 2 × 2 (each at flexBasis 47%); at or above we get
// 4 × 1 (each at flexBasis 23%). 620 px is roughly the lowest tablet
// portrait width (iPad mini = 768) plus enough margin to avoid
// triggering the wide layout on phones in landscape.
//
// Note: this exceeds the 520 px max-width the in-match modals use,
// so on a 620–700 px tablet width the lobby grid will look wider
// than a Settings / Players sheet would. That asymmetry is
// intentional — the lobby header is a hero element shown
// pre-match, where modals don't compete for attention.
const WIDE_GRID_BREAKPOINT = 620;

const COLORS = {
  ...SHARED_COLORS,
  // LobbyPreview's "filled seat" cards use a darker cream than the
  // shared `cream` so they read as recessed against the paperHi
  // outer card. Kept local since no other surface wants this exact
  // tone.
  cream: '#ece4d3',
  /** Lobby's "open / waiting" indicator dot — slightly bluer-green
   *  than the shared `green` used for connection states elsewhere
   *  so the two read as distinct cues (lobby room status vs
   *  per-seat online state). */
  lobbyDot: '#44ad60',
};

/**
 * Per-seat status pill colour palette. Three explicit kinds:
 *   - `bot`     — purple (lavender bg, deep purple text). Reads as
 *                 a non-human player.
 *   - `online`  — soft green. Real human, currently connected.
 *   - `offline` — neutral cream / muted text. Real human, dropped.
 *
 * Lifted out of the inline `kind === 'x' ? … : …` ternary in
 * `StatusPill` so a designer can tweak the palette without grepping
 * the component body. The shapes intentionally use bg + text-color
 * pairs (not a single accent) so the pill stays legible at the
 * 9 px font size.
 */
const STATUS_COLORS = {
  bot: { color: '#735aa3', bg: '#e1d3ed', label: 'Bot' },
  online: { color: '#2d8645', bg: '#c2e2c5', label: 'Online' },
  offline: { color: COLORS.ink3, bg: COLORS.cream, label: 'Disconnected' },
} as const;

/**
 * Live preview of the four-seat lobby — wind glyphs, seat cards,
 * connection-status pills. Uses a `useWindowDimensions`-driven
 * flex-wrap so on narrow phones the four seats reflow to 2×2 instead
 * of overflowing.
 */
export function LobbyPreview({ lobby, matchCode }: LobbyPreviewProps) {
  const { width } = useWindowDimensions();
  const players = SEATS.map((seat) => lobby.players.find((p) => p.seat === seat) ?? null);
  const cardBasis = width >= WIDE_GRID_BREAKPOINT ? '23%' : '47%';
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const onCopy = async () => {
    if (!matchCode) return;
    try {
      await Clipboard.setStringAsync(matchCode);
      setCopied(true);
    } catch {
      // Clipboard access can be denied on browsers without HTTPS or
      // on backgrounded native apps. Failing silently is fine — the
      // user can long-press to fall back to native text selection.
    }
  };

  return (
    <View
      style={{
        marginTop: 20,
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 14,
        padding: 18,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: COLORS.lobbyDot,
            }}
          />
          <Text style={{ fontSize: 14, fontWeight: '900', color: COLORS.ink }}>In lobby</Text>
          <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '700' }}>
            · waiting for players
          </Text>
        </View>
        {matchCode ? (
          <Pressable
            onPress={onCopy}
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Match code copied' : `Copy match code ${matchCode}`}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: copied
                ? STATUS_COLORS.online.bg
                : pressed
                  ? '#dfd4bc'
                  : COLORS.cream,
              borderColor: copied ? STATUS_COLORS.online.color : COLORS.hairline,
              borderWidth: 1,
              borderRadius: 8,
              paddingVertical: 6,
              paddingHorizontal: 12,
            })}
          >
            <Text
              style={{
                fontFamily: 'JetBrains Mono',
                fontSize: 13,
                fontWeight: '800',
                letterSpacing: 3,
                color: COLORS.ink,
              }}
            >
              {matchCode}
            </Text>
            <Text
              style={{
                fontSize: 10,
                fontWeight: '800',
                letterSpacing: 0.6,
                color: copied ? STATUS_COLORS.online.color : COLORS.ink3,
              }}
            >
              {copied ? 'COPIED' : 'COPY'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SEATS.map((seat) => {
          const p = players[seat];
          // Server projects an inert placeholder for empty seats so the
          // lobby array is always length 4 — flatten to a "filled" check
          // so the card falls through to the dashed "Open seat…" state.
          const filled = !!p && (p.isBot || p.connected);
          return (
            <View
              key={seat}
              style={{
                flexBasis: cardBasis,
                flexGrow: 1,
                backgroundColor: filled ? COLORS.cream : 'transparent',
                borderColor: COLORS.hairline,
                borderWidth: 1,
                borderStyle: filled ? 'solid' : 'dashed',
                borderRadius: 10,
                padding: 10,
                gap: 6,
                minHeight: 76,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text
                  style={{
                    fontFamily: 'Noto Serif TC',
                    fontSize: 16,
                    color: COLORS.red,
                    fontWeight: '700',
                  }}
                >
                  {SEAT_WIND_GLYPH[seat]}
                </Text>
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '800',
                    color: COLORS.ink3,
                    letterSpacing: 0.6,
                  }}
                >
                  SEAT {seat}
                </Text>
              </View>
              {filled && p ? (
                <>
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: '800',
                      color: COLORS.ink,
                      lineHeight: 16,
                    }}
                  >
                    {p.displayName}
                  </Text>
                  <StatusPill kind={p.isBot ? 'bot' : p.connected ? 'online' : 'offline'} />
                </>
              ) : (
                <Text
                  style={{
                    fontSize: 12,
                    color: COLORS.ink3,
                    fontStyle: 'italic',
                    fontWeight: '600',
                  }}
                >
                  Open seat…
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function StatusPill({ kind }: { kind: 'bot' | 'online' | 'offline' }) {
  const palette = STATUS_COLORS[kind];
  return (
    <View
      style={{
        backgroundColor: palette.bg,
        borderRadius: 4,
        paddingVertical: 2,
        paddingHorizontal: 6,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          fontSize: 9,
          fontWeight: '800',
          letterSpacing: 0.5,
          color: palette.color,
        }}
      >
        {palette.label.toUpperCase()}
      </Text>
    </View>
  );
}
