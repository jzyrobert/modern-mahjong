import type { Action, Seat } from '@mahjong/game-logic';
import { DEFAULT_RULES, SEATS } from '@mahjong/game-logic';
import { BOT_LABELS, type BotKind, type PublicPlayer, type RuleConfig } from '@mahjong/protocol';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { JoinInfo } from '../../net/join-info';
import { type LobbyState, useGame } from '../../state/game';
import { randomSeed } from '../../util';
import { RulePanel } from '../RulePanel';
import { GhostButton, PrimaryButton } from '../buttons';
import { COLORS, SUCCESS_PILL } from '../colors';
import { LanInviteCard } from '../menu/LanInviteCard';
import { LobbyPreview } from '../menu/LobbyPreview';
import { SEAT_WIND_GLYPH } from '../winds';

interface LobbyViewProps {
  rules: RuleConfig;
  lobby: LobbyState | null;
  seat: Seat | null;
  isHost: boolean;
  matchCode: string | null;
  joinInfo: JoinInfo | null;
  onAction: (action: Action) => void;
  onLeave: () => void;
  onSeatBot: (seat: Seat, kind: BotKind) => void;
  onUnseatBot: (seat: Seat) => void;
}

/**
 * Pre-game waiting-room screen — shown while `state.phase === 'waiting'`.
 * Header + (LAN host's) join-URL copy chip + LAN invite card + lobby
 * preview + host bot-skill picker + rule panel + Start / Leave buttons.
 *
 * Extracted from `Match.tsx` so the live-match orchestrator only
 * concerns itself with the playing phases (spectator, stranded,
 * waiting-for-state, and the shell handoff). Local state for the
 * header copy-pulse lives here because no other render path of `Match`
 * mounts this component, so the hook order stays stable from `Match`'s
 * perspective.
 */
export function LobbyView({
  rules,
  lobby,
  seat,
  isHost,
  matchCode,
  joinInfo,
  onAction,
  onLeave,
  onSeatBot,
  onUnseatBot,
}: LobbyViewProps) {
  const isSolo = matchCode === 'SOLO';
  const isLanHost = !!(isHost && joinInfo?.kind === 'lan' && joinInfo.hostUrl && matchCode);
  // Mirror `LanInviteCard`'s URL construction so the header-row copy
  // button copies the same string guests would paste into a browser:
  // `<host>/match?code=<CODE>`. Trailing slashes on the host URL are
  // stripped to avoid `…//match?code=…`. Empty string when this user
  // isn't the LAN host (button is hidden in that case).
  const headerJoinUrl =
    isLanHost && joinInfo?.kind === 'lan'
      ? `${joinInfo.hostUrl.trim().replace(/\/$/, '')}/match?code=${encodeURIComponent(matchCode ?? '')}`
      : '';

  // "COPIED" pulse for the header-row Copy URL button. Lives in this
  // component (not its parent) because LobbyView is only mounted on
  // the waiting branch — moving with the extraction keeps the hook
  // order in `Match.tsx` stable for the other branches.
  const [joinUrlCopied, setJoinUrlCopied] = useState(false);
  useEffect(() => {
    if (!joinUrlCopied) return;
    const t = setTimeout(() => setJoinUrlCopied(false), 1500);
    return () => clearTimeout(t);
  }, [joinUrlCopied]);

  // Apply the user's persisted lobby rule preferences once per mount,
  // host-only. The server / solo transport always boots with
  // `DEFAULT_RULES`, so the first time the host lands in the lobby the
  // user's last-chosen faanMin + turnTimeoutMs need to be re-applied
  // via `setRules`. After that, any manual edit in the RulePanel both
  // updates the engine and writes back to `lobbyRulePrefs` (see
  // `RulePanel.set`), so a reload-then-remount re-reads the same prefs
  // and the `applied` ref makes the dispatch a no-op when state already
  // matches.
  //
  // `looksFresh` gates the dispatch: only apply prefs when state.rules
  // still reads as the engine defaults. If anything (a test override
  // like `__MAHJONG_TEST_TURN_TIMEOUT_MS__`, a host's manual setRules
  // earlier in this match, a reload-restored non-default state) has
  // already moved state.rules off DEFAULT, leave it alone — otherwise
  // an e2e that explicitly arms a 800ms timer would get stomped back
  // to 0 the moment the lobby mounts, and the test loses its hatch.
  const lobbyPrefs = useGame((s) => s.settings.lobbyRulePrefs);
  const prefsApplied = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally fire-once on mount as host. Including `rules` / `lobbyPrefs` here would re-dispatch every time the user edits a rule in RulePanel, which both updates the engine state and writes back to lobbyPrefs — that would race with the manual edit and overwrite it.
  useEffect(() => {
    if (!isHost || prefsApplied.current) return;
    prefsApplied.current = true;
    const looksFresh =
      rules.faanMin === DEFAULT_RULES.faanMin &&
      rules.turnTimeoutMs === DEFAULT_RULES.turnTimeoutMs;
    if (!looksFresh) return;
    const drift =
      rules.faanMin !== lobbyPrefs.faanMin || rules.turnTimeoutMs !== lobbyPrefs.turnTimeoutMs;
    if (drift) {
      onAction({
        t: 'setRules',
        rules: { faanMin: lobbyPrefs.faanMin, turnTimeoutMs: lobbyPrefs.turnTimeoutMs },
      });
    }
  }, [isHost]);

  const onCopyHeaderJoinUrl = async () => {
    if (!headerJoinUrl) return;
    try {
      await Clipboard.setStringAsync(headerJoinUrl);
      setJoinUrlCopied(true);
    } catch {
      // Clipboard access can be denied on non-HTTPS browsers or
      // backgrounded apps — the LanInviteCard below renders the
      // same URL with its own COPY/SHARE row as a fallback.
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top', 'bottom']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: 24,
            maxWidth: 760,
            alignSelf: 'center',
            width: '100%',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ fontSize: 28, fontWeight: '900', color: COLORS.ink }}
            >
              Lobby
            </Text>
            {/* Header-row quick-copy of the LAN join URL. Sits next to
             * the title so it's the first share affordance the host
             * sees on landing in the waiting room — the full
             * `LanInviteCard` below still has per-link COPY/SHARE
             * controls for the browser URL + native deep link. */}
            {isLanHost ? (
              <Pressable
                onPress={onCopyHeaderJoinUrl}
                accessibilityRole="button"
                accessibilityLabel={joinUrlCopied ? 'Join URL copied' : 'Copy join URL'}
                style={({ pressed }) => ({
                  backgroundColor: joinUrlCopied
                    ? SUCCESS_PILL.bg
                    : pressed
                      ? COLORS.creamPressed
                      : COLORS.creamLow,
                  borderColor: joinUrlCopied ? SUCCESS_PILL.border : COLORS.hairline,
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
                    color: joinUrlCopied ? SUCCESS_PILL.fg : COLORS.ink,
                  }}
                >
                  {joinUrlCopied ? 'URL COPIED' : 'COPY JOIN URL'}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={{ marginTop: 4, marginBottom: 12, fontSize: 13, color: COLORS.ink3 }}>
            {isLanHost
              ? 'Share the join URL with friends on the same Wi-Fi. Start when everyone is ready.'
              : isHost
                ? 'Share the match code with friends. Start when everyone is ready.'
                : 'Waiting for the host to start the match.'}
          </Text>
          {/* Show the LAN invite URLs (with COPY/SHARE buttons) *above*
           * the LobbyPreview so the host's first reflex on landing in
           * the pre-game waiting room is to share the URL with guests
           * — the lobby preview is useful but secondary while the
           * other seats are still empty. */}
          {isLanHost && joinInfo?.kind === 'lan' ? (
            <LanInviteCard hostUrl={joinInfo.hostUrl} matchCode={matchCode ?? ''} />
          ) : null}
          {lobby ? <LobbyPreview lobby={lobby} matchCode={matchCode} /> : null}
          {lobby && isHost && seat !== null ? (
            <LobbySeatControls
              players={lobby.players}
              mySeat={seat}
              isSolo={isSolo}
              onSeat={onSeatBot}
              onUnseat={onUnseatBot}
            />
          ) : null}
          <RulePanel rules={rules} isHost={isHost} onAction={onAction} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <PrimaryButton
              // Mirror the server's all-seats-filled gate so the host
              // gets a disabled button instead of a silent error.
              disabled={!isHost || !allSeatsFilled(lobby)}
              // No explicit dealer — engine derives it from the
              // opening dice roll (highest sum wins; ties go to the
              // lowest-indexed seat). Subsequent hands rotate via
              // `nextDealer(state)` from `ResultPanel`'s "Start next
              // hand" button. Hardcoding `dealer: 0` here was the bug
              // that made the user always dealer regardless of dice.
              onPress={() => onAction({ t: 'startHand', seed: randomSeed() })}
            >
              Start match
            </PrimaryButton>
            <GhostButton onPress={onLeave}>Leave</GhostButton>
          </View>
          {isHost && !allSeatsFilled(lobby) ? (
            <Text style={{ marginTop: 6, fontSize: 12, color: COLORS.ink3 }}>
              Fill every seat with a player or a bot before starting.
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** Mirrors the server's `startHand` SEATS gate. */
function allSeatsFilled(lobby: { players: readonly PublicPlayer[] } | null): boolean {
  if (!lobby) return false;
  for (const seat of SEATS) {
    const p = lobby.players.find((x) => x.seat === seat);
    if (!p) return false;
    if (!p.connected && !p.isBot) return false;
  }
  return true;
}

// Picker rows in lobby-row order (Easy → Standard → Smart). `label`
// pulls from the canonical `BOT_LABELS` map in `@mahjong/protocol` so
// it stays in lockstep with `botDisplayName(kind)` everywhere else.
const BOT_KIND_OPTIONS: ReadonlyArray<{ kind: BotKind; label: string; hint: string }> = [
  {
    kind: 'passive',
    label: BOT_LABELS.passive,
    hint: 'Discards the last drawn tile, never claims.',
  },
  { kind: 'simple', label: BOT_LABELS.simple, hint: 'Drops the most isolated tile.' },
  {
    kind: 'heuristic',
    label: BOT_LABELS.heuristic,
    hint: 'Minimises shanten + claims to improve.',
  },
];

interface LobbySeatControlsProps {
  players: readonly PublicPlayer[];
  mySeat: Seat;
  isSolo: boolean;
  onSeat: (seat: Seat, kind: BotKind) => void;
  onUnseat: (seat: Seat) => void;
}

/**
 * Host's lobby controls — segmented Easy/Standard/Smart picker per
 * non-self, non-human-occupied seat, with a Remove button for online/LAN
 * (solo always has three bots in seats 1..3).
 */
function LobbySeatControls({ players, mySeat, isSolo, onSeat, onUnseat }: LobbySeatControlsProps) {
  // A bot reports `connected: true` (solo bots are "connected" to the
  // in-process loop), so the human predicate is connected-and-not-bot.
  const editable = players.filter(
    (p) => p.seat !== null && p.seat !== mySeat && (p.isBot || !p.connected),
  );
  if (editable.length === 0) return null;
  return (
    <View
      style={{
        marginTop: 12,
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        gap: 10,
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: '900', color: COLORS.ink }}>Bot skill</Text>
      <Text style={{ fontSize: 12, color: COLORS.ink3, marginTop: -4 }}>
        {isSolo
          ? "Tune each opponent's strategy. Saved across sessions."
          : 'Fill empty seats with bots, or swap a bot’s strategy.'}
      </Text>
      {editable.map((p) => {
        const seat = p.seat as Seat;
        return (
          <View
            key={seat}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, minWidth: 70 }}>
              <Text
                style={{
                  fontFamily: 'Noto Serif TC',
                  fontSize: 16,
                  color: '#b14d3a',
                  fontWeight: '700',
                }}
              >
                {SEAT_WIND_GLYPH[seat]}
              </Text>
              <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.ink3 }}>
                SEAT {seat}
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                flex: 1,
                minWidth: 220,
                backgroundColor: COLORS.creamLow,
                borderRadius: 8,
                padding: 2,
              }}
            >
              {BOT_KIND_OPTIONS.map((opt) => {
                const active = p.botKind === opt.kind;
                return (
                  <Pressable
                    key={opt.kind}
                    onPress={() => onSeat(seat, opt.kind)}
                    accessibilityLabel={`Set seat ${seat} to ${opt.label}`}
                    style={({ pressed }) => ({
                      flex: 1,
                      paddingVertical: 6,
                      borderRadius: 6,
                      alignItems: 'center',
                      backgroundColor: active
                        ? COLORS.accentSalmonSwatch
                        : pressed
                          ? COLORS.creamPressed
                          : 'transparent',
                    })}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: active ? '900' : '600',
                        color: active ? COLORS.red : COLORS.ink,
                        letterSpacing: 0.4,
                      }}
                    >
                      {opt.label.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!isSolo && p.isBot ? (
              <Pressable
                onPress={() => onUnseat(seat)}
                accessibilityLabel={`Remove bot from seat ${seat}`}
                hitSlop={8}
                style={({ pressed }) => ({
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: COLORS.hairline,
                  backgroundColor: pressed ? COLORS.creamPressed : 'transparent',
                })}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.ink3 }}>REMOVE</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
