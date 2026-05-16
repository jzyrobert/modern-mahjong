import type { Action, Seat } from '@mahjong/game-logic';
import { FAAN_OPTIONS, SEATS } from '@mahjong/game-logic';
import {
  BOT_LABELS,
  type BotKind,
  type PublicPlayer,
  type RuleConfig,
  botDisplayName,
} from '@mahjong/protocol';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { JoinInfo } from '../../net/join-info';
import { type LobbyState, useGame } from '../../state/game';
import { randomSeed } from '../../util';
import { GhostButton, PrimaryButton } from '../buttons';
import { COLORS, SUCCESS_PILL } from '../colors';
import { useIsLandscape } from '../useOrientation';
import { SEAT_WIND_GLYPH } from '../winds';

/**
 * Phone-class redesign of the pre-game waiting room. Replaces the
 * single-scroll `LobbyView` body on viewports below `Match.tsx`'s
 * DESKTOP breakpoint — the legacy layout pushes the primary
 * `Start match` CTA below the fold on short viewports (and out of
 * sight entirely in landscape).
 *
 * The redesign keeps the match code, player roster, and seat grid
 * always visible at the top, demotes Bots / Rules / Invite into
 * independently collapsible accordion rows, and pins the
 * Start / Leave buttons to a sticky bottom action bar so the host's
 * primary action is never scrolled off screen.
 *
 * Dispatched from `LobbyView` once viewport classification falls
 * below the desktop threshold; tablets and desktop browsers keep
 * the existing layout.
 *
 * Behaviour mirrors `LobbyView`'s desktop layout where the UX is
 * unchanged (action discriminators, lobbyRulePrefs persistence,
 * remove-bot for online/LAN, deep-link generated via
 * `Linking.createURL`). Two design assumptions in the handoff
 * needed adjustment to match the rest of the client; see the inline
 * notes at each call site.
 */

const TURN_TIMER_OPTIONS: ReadonlyArray<{ key: 0 | 10 | 20 | 45; label: string }> = [
  { key: 0, label: '∞' },
  { key: 10, label: '10s' },
  { key: 20, label: '20s' },
  { key: 45, label: '45s' },
];

const BOT_KIND_OPTIONS: ReadonlyArray<{ kind: BotKind; label: string }> = [
  { kind: 'passive', label: BOT_LABELS.passive },
  { kind: 'simple', label: BOT_LABELS.simple },
  { kind: 'heuristic', label: BOT_LABELS.heuristic },
];

type AccordionSection = 'bots' | 'rules' | 'invite';

interface LobbyAccordionProps {
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

export function LobbyAccordion(props: LobbyAccordionProps) {
  // `useIsLandscape` reads `matchMedia('(orientation: landscape)')` on
  // web so the Android soft keyboard's `innerHeight` shrink doesn't
  // flip the orientation guard mid-tap and unmount the focused subtree
  // — see the hook's comment for the wider rationale and PR #389's
  // matching fix in `MobileLobby`.
  const isLandscape = useIsLandscape();
  return isLandscape ? <LandscapeBody {...props} /> : <PortraitBody {...props} />;
}

// ─── Portrait layout ────────────────────────────────────────────────

function PortraitBody({
  rules,
  lobby,
  seat: mySeat,
  isHost,
  matchCode,
  joinInfo,
  onAction,
  onLeave,
  onSeatBot,
  onUnseatBot,
}: LobbyAccordionProps) {
  const isSolo = matchCode === 'SOLO';
  const isLanHost = !!(isHost && joinInfo?.kind === 'lan' && joinInfo.hostUrl && matchCode);
  const players = lobby?.players ?? [];
  const allFilled = isAllSeatsFilled(lobby);
  const humanCount = players.filter((p) => !p.isBot && p.connected).length;
  const botCount = players.filter((p) => p.isBot).length;
  const timerSecs = rules.turnTimeoutMs === 0 ? null : Math.round(rules.turnTimeoutMs / 1000);
  const set = useRuleSetter(onAction);

  const { isOpen, toggleSection } = usePersistedOpenSections();

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top', 'bottom']}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
          <HeaderRow humanCount={humanCount} compact={false} />
          {/* SOLO matches don't have a server-side code worth sharing —
              the legacy LobbyView already hid the share affordance for
              this case, so keep parity here. */}
          {matchCode && !isSolo ? <MatchCodeChip matchCode={matchCode} compact={false} /> : null}
          <SeatGrid players={players} compact={false} />
          {/* The handoff puts Bots above Rules unconditionally. For
              non-hosts there's nothing actionable in Bots (skill
              picker requires host privileges); hide the row entirely
              instead of rendering a disabled placeholder — matches
              the legacy LobbySeatControls visibility gate. */}
          {isHost && lobby && mySeat !== null ? (
            <AccordionRow
              sectionKey="bots"
              title="Bots"
              summary={`${botCount} bot${botCount === 1 ? '' : 's'} · tap to tune`}
              open={isOpen('bots')}
              onToggle={toggleSection}
              compact={false}
            >
              <BotsBody
                players={lobby.players}
                mySeat={mySeat}
                isSolo={isSolo}
                onSeat={onSeatBot}
                onUnseat={onUnseatBot}
                compact={false}
              />
            </AccordionRow>
          ) : null}
          <AccordionRow
            sectionKey="rules"
            title="Rules"
            summary={`${rules.faanMin} faan min · ${timerSecs ? `${timerSecs}s timer` : 'no timer'}`}
            open={isOpen('rules')}
            onToggle={toggleSection}
            compact={false}
          >
            <RulesBody rules={rules} disabled={!isHost} onSet={set} />
            {!isHost ? (
              <Text style={{ marginTop: 6, fontSize: 11, color: COLORS.ink3 }}>
                Only the lobby host can change rules.
              </Text>
            ) : null}
          </AccordionRow>
          {isLanHost && joinInfo?.kind === 'lan' ? (
            <AccordionRow
              sectionKey="invite"
              title="Invite"
              summary="Share LAN URL"
              open={isOpen('invite')}
              onToggle={toggleSection}
              compact={false}
            >
              <InviteBody hostUrl={joinInfo.hostUrl} matchCode={matchCode ?? ''} compact={false} />
            </AccordionRow>
          ) : null}
        </ScrollView>
        <ActionBar
          isHost={isHost}
          allFilled={allFilled}
          onStart={() => onAction({ t: 'startHand', seed: randomSeed() })}
          onLeave={onLeave}
          compact={false}
        />
      </SafeAreaView>
    </View>
  );
}

// ─── Landscape layout ───────────────────────────────────────────────

function LandscapeBody({
  rules,
  lobby,
  seat: mySeat,
  isHost,
  matchCode,
  joinInfo,
  onAction,
  onLeave,
  onSeatBot,
  onUnseatBot,
}: LobbyAccordionProps) {
  const { width } = useWindowDimensions();
  const isSolo = matchCode === 'SOLO';
  const isLanHost = !!(isHost && joinInfo?.kind === 'lan' && joinInfo.hostUrl && matchCode);
  const players = lobby?.players ?? [];
  const allFilled = isAllSeatsFilled(lobby);
  const humanCount = players.filter((p) => !p.isBot && p.connected).length;
  const botCount = players.filter((p) => p.isBot).length;
  const timerSecs = rules.turnTimeoutMs === 0 ? null : Math.round(rules.turnTimeoutMs / 1000);
  const set = useRuleSetter(onAction);

  const { isOpen, toggleSection } = usePersistedOpenSections();

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
          {/* Left column: title + match-code + compact seat grid */}
          <ScrollView
            style={{ width: width * 0.42, borderRightColor: COLORS.hairline, borderRightWidth: 1 }}
            contentContainerStyle={{ padding: 10, gap: 6 }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{ fontSize: 18, fontWeight: '900', color: COLORS.ink }}
              >
                Lobby
              </Text>
              <Text
                style={{ fontSize: 9, fontWeight: '800', color: COLORS.ink3, letterSpacing: 0.5 }}
              >
                {isSolo ? 'SOLO' : isLanHost ? 'LAN' : `${humanCount}/4`}
              </Text>
            </View>
            {matchCode && !isSolo ? <MatchCodeChip matchCode={matchCode} compact /> : null}
            <SeatGrid players={players} compact />
          </ScrollView>
          {/* Right column: accordion rows */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10, gap: 6 }}>
            {isHost && lobby && mySeat !== null ? (
              <AccordionRow
                sectionKey="bots"
                title="Bots"
                summary={`${botCount} bot${botCount === 1 ? '' : 's'}`}
                open={isOpen('bots')}
                onToggle={toggleSection}
                compact
              >
                <BotsBody
                  players={lobby.players}
                  mySeat={mySeat}
                  isSolo={isSolo}
                  onSeat={onSeatBot}
                  onUnseat={onUnseatBot}
                  compact
                />
              </AccordionRow>
            ) : null}
            <AccordionRow
              sectionKey="rules"
              title="Rules"
              summary={`${rules.faanMin} faan · ${timerSecs ? `${timerSecs}s` : '∞'}`}
              open={isOpen('rules')}
              onToggle={toggleSection}
              compact
            >
              <RulesBody rules={rules} disabled={!isHost} onSet={set} />
            </AccordionRow>
            {isLanHost && joinInfo?.kind === 'lan' ? (
              <AccordionRow
                sectionKey="invite"
                title="Invite"
                summary="Share LAN URL"
                open={isOpen('invite')}
                onToggle={toggleSection}
                compact
              >
                <InviteBody hostUrl={joinInfo.hostUrl} matchCode={matchCode ?? ''} compact />
              </AccordionRow>
            ) : null}
          </ScrollView>
        </View>
        <ActionBar
          isHost={isHost}
          allFilled={allFilled}
          onStart={() => onAction({ t: 'startHand', seed: randomSeed() })}
          onLeave={onLeave}
          compact
        />
      </SafeAreaView>
    </View>
  );
}

// ─── Shared sub-components ──────────────────────────────────────────

function HeaderRow({ humanCount, compact }: { humanCount: number; compact: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text
        accessibilityRole="header"
        style={{
          fontSize: compact ? 18 : 22,
          fontWeight: '900',
          color: COLORS.ink,
        }}
      >
        Lobby
      </Text>
      <Text
        style={{
          fontSize: compact ? 9 : 11,
          fontWeight: '700',
          color: COLORS.ink3,
          letterSpacing: 0.4,
        }}
      >
        {humanCount}/4 PLAYERS
      </Text>
    </View>
  );
}

function MatchCodeChip({ matchCode, compact }: { matchCode: string; compact: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const onCopy = async () => {
    try {
      await Clipboard.setStringAsync(matchCode);
      setCopied(true);
    } catch {
      // Clipboard denial — fall back to long-press selection on the
      // visible code text. Same fallback pattern as `LobbyPreview`.
    }
  };
  return (
    <Pressable
      onPress={onCopy}
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Match code copied' : `Copy match code ${matchCode}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: compact ? 6 : 10,
        backgroundColor: copied ? SUCCESS_PILL.bg : pressed ? COLORS.creamPressed : COLORS.paperHi,
        borderColor: copied ? SUCCESS_PILL.border : COLORS.hairline,
        borderWidth: 1,
        borderRadius: compact ? 8 : 10,
        paddingVertical: compact ? 6 : 8,
        paddingHorizontal: compact ? 8 : 12,
      })}
    >
      <View
        style={{
          width: compact ? 7 : 8,
          height: compact ? 7 : 8,
          borderRadius: 4,
          backgroundColor: COLORS.success,
        }}
      />
      <Text
        style={{
          fontFamily: 'JetBrains Mono',
          fontSize: compact ? 13 : 16,
          fontWeight: '800',
          letterSpacing: compact ? 2 : 3,
          color: COLORS.ink,
        }}
      >
        {matchCode}
      </Text>
      <View style={{ flex: 1 }} />
      <View
        style={{
          backgroundColor: copied ? SUCCESS_PILL.bg : COLORS.creamLow,
          borderColor: copied ? SUCCESS_PILL.border : COLORS.hairline,
          borderWidth: 1,
          borderRadius: compact ? 5 : 6,
          paddingVertical: compact ? 3 : 4,
          paddingHorizontal: compact ? 7 : 10,
        }}
      >
        <Text
          style={{
            fontSize: compact ? 9 : 11,
            fontWeight: '800',
            letterSpacing: 0.6,
            color: copied ? SUCCESS_PILL.fg : COLORS.ink,
          }}
        >
          {copied ? 'COPIED' : 'COPY'}
        </Text>
      </View>
    </Pressable>
  );
}

function SeatGrid({ players, compact }: { players: readonly PublicPlayer[]; compact: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: compact ? 4 : 8 }}>
      {SEATS.map((seat) => {
        const p = players.find((x) => x.seat === seat) ?? null;
        const filled = !!p && (p.isBot || p.connected);
        const radius = compact ? 8 : 10;
        const padV = compact ? 6 : 10;
        const padH = compact ? 8 : 10;
        return (
          <View
            key={seat}
            style={{
              flexBasis: '47%',
              flexGrow: 1,
              backgroundColor: filled ? COLORS.creamLow : 'transparent',
              borderColor: COLORS.hairline,
              borderWidth: 1,
              borderStyle: filled ? 'solid' : 'dashed',
              borderRadius: radius,
              paddingVertical: padV,
              paddingHorizontal: padH,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: compact ? 'center' : 'baseline',
                gap: compact ? 4 : 6,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Noto Serif TC',
                  fontSize: compact ? 13 : 16,
                  color: COLORS.red,
                  fontWeight: '700',
                  lineHeight: compact ? 13 : 16,
                }}
              >
                {SEAT_WIND_GLYPH[seat]}
              </Text>
              <Text
                style={{
                  fontSize: compact ? 9 : 10,
                  fontWeight: '800',
                  color: COLORS.ink3,
                  letterSpacing: 0.6,
                }}
              >
                SEAT {seat}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={{
                marginTop: compact ? 2 : 4,
                fontSize: compact ? 11 : 13,
                fontWeight: '800',
                color: filled ? COLORS.ink : COLORS.ink3,
                fontStyle: filled ? 'normal' : 'italic',
              }}
            >
              {filled && p ? p.displayName : 'Open seat…'}
            </Text>
            {filled && p ? (
              <Text
                style={{
                  marginTop: 2,
                  fontSize: 9,
                  fontWeight: '800',
                  color: p.isBot ? '#735aa3' : SUCCESS_PILL.fg,
                  letterSpacing: 0.4,
                }}
              >
                {/* The handoff hardcoded a literal "BOT" badge for
                    all bot seats, which would have dropped the kind
                    info the legacy `LobbyPreview.StatusPill` surfaces
                    as "Bot (Smart)" / "Bot (Standard)" / "Bot (Easy)".
                    Use `botDisplayName` so the badge stays an at-a-
                    glance difficulty cue and the existing solo-bot-
                    skills e2e test continues to find it. */}
                {p.isBot
                  ? botDisplayName(p.botKind ?? 'simple')
                  : p.connected
                    ? 'ONLINE'
                    : 'OFFLINE'}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

interface AccordionRowProps<K extends string> {
  sectionKey: K;
  title: string;
  summary: string;
  open: boolean;
  onToggle: (k: K) => void;
  compact: boolean;
  children: React.ReactNode;
}

function AccordionRow<K extends string>({
  sectionKey,
  title,
  summary,
  open,
  onToggle,
  compact,
  children,
}: AccordionRowProps<K>) {
  const vp = compact ? 8 : 10;
  const hp = compact ? 10 : 12;
  return (
    <View
      style={{
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={() => onToggle(sectionKey)}
        accessibilityRole="button"
        accessibilityLabel={open ? `Collapse ${title}` : `Expand ${title}`}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: vp,
          paddingHorizontal: hp,
          backgroundColor: pressed ? COLORS.creamPressed : 'transparent',
        })}
      >
        <Text
          style={{
            fontSize: compact ? 12 : 13,
            fontWeight: '900',
            color: COLORS.ink,
            width: compact ? 54 : 64,
          }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize: compact ? 11 : 12,
            color: COLORS.ink3,
            fontWeight: '600',
          }}
        >
          {summary}
        </Text>
        <Text style={{ fontSize: 14, color: COLORS.ink3, fontWeight: '800' }}>
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: hp, paddingBottom: vp, paddingTop: 2 }}>{children}</View>
      ) : null}
    </View>
  );
}

interface BotsBodyProps {
  players: readonly PublicPlayer[];
  mySeat: Seat;
  isSolo: boolean;
  onSeat: (seat: Seat, kind: BotKind) => void;
  onUnseat: (seat: Seat) => void;
  compact: boolean;
}

function BotsBody({ players, mySeat, isSolo, onSeat, onUnseat, compact }: BotsBodyProps) {
  // Same predicate the legacy `LobbySeatControls` uses: my seat is
  // never editable, human-connected seats stay frozen so the host
  // can't kick a guest, but bot or open seats are tunable. The
  // predicate is typed as a type guard so the post-filter rows can
  // address `p.seat` as `Seat` without a downstream cast.
  const editable = players.filter(
    (p): p is PublicPlayer & { seat: Seat } =>
      p.seat !== null && p.seat !== mySeat && (p.isBot || !p.connected),
  );
  if (editable.length === 0) {
    return <Text style={{ fontSize: 11, color: COLORS.ink3 }}>No bot seats.</Text>;
  }
  return (
    <View style={{ gap: compact ? 6 : 8 }}>
      {editable.map((p) => {
        const seat = p.seat;
        return (
          <View
            key={seat}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: compact ? 6 : 8,
              flexWrap: 'wrap',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, minWidth: 60 }}>
              <Text
                style={{
                  fontFamily: 'Noto Serif TC',
                  fontSize: compact ? 13 : 14,
                  color: COLORS.red,
                  fontWeight: '700',
                }}
              >
                {SEAT_WIND_GLYPH[seat]}
              </Text>
              <Text style={{ fontSize: 10, fontWeight: '800', color: COLORS.ink3 }}>
                SEAT {seat}
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                flex: 1,
                minWidth: 160,
                backgroundColor: COLORS.creamLow,
                borderRadius: 6,
                padding: 2,
              }}
            >
              {BOT_KIND_OPTIONS.map((opt) => {
                const active = p.botKind === opt.kind;
                return (
                  <Pressable
                    key={opt.kind}
                    onPress={() => onSeat(seat, opt.kind)}
                    accessibilityRole="button"
                    accessibilityLabel={`Set seat ${seat} to ${opt.label}`}
                    style={({ pressed }) => ({
                      flex: 1,
                      paddingVertical: compact ? 4 : 6,
                      borderRadius: 4,
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
                        fontSize: compact ? 9 : 10,
                        fontWeight: active ? '900' : '700',
                        color: active ? COLORS.red : COLORS.ink,
                        letterSpacing: 0.3,
                      }}
                    >
                      {opt.label.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {/* Online/LAN hosts can vacate a bot to free the seat for
                a real guest. Solo has bots permanently in seats 1-3 so
                a remove control would be a no-op there — mirror the
                legacy gate. */}
            {!isSolo && p.isBot ? (
              <Pressable
                onPress={() => onUnseat(seat)}
                accessibilityRole="button"
                accessibilityLabel={`Remove bot from seat ${seat}`}
                hitSlop={6}
                style={({ pressed }) => ({
                  paddingVertical: compact ? 4 : 6,
                  paddingHorizontal: compact ? 8 : 10,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: COLORS.hairline,
                  backgroundColor: pressed ? COLORS.creamPressed : 'transparent',
                })}
              >
                <Text
                  style={{
                    fontSize: compact ? 9 : 10,
                    fontWeight: '800',
                    color: COLORS.ink3,
                    letterSpacing: 0.3,
                  }}
                >
                  REMOVE
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

interface RulesBodyProps {
  rules: RuleConfig;
  disabled: boolean;
  onSet: (patch: Partial<RuleConfig>) => void;
}

function RulesBody({ rules, disabled, onSet }: RulesBodyProps) {
  const timerOff = rules.turnTimeoutMs === 0;
  const secs = timerOff ? 0 : Math.round(rules.turnTimeoutMs / 1000);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '800',
            color: COLORS.ink3,
            letterSpacing: 0.6,
            width: '100%',
            marginBottom: 2,
          }}
        >
          FAAN MIN
        </Text>
        {FAAN_OPTIONS.map((n) => {
          const active = rules.faanMin === n;
          return (
            <Pressable
              key={n}
              disabled={disabled}
              onPress={() => onSet({ faanMin: n })}
              accessibilityRole="radio"
              accessibilityLabel={`Minimum faan: ${n}`}
              accessibilityState={{ selected: active, disabled }}
              style={({ pressed }) => ({
                borderWidth: 1,
                borderColor: active ? COLORS.red : COLORS.hairline,
                backgroundColor: active
                  ? COLORS.accentSalmonSwatch
                  : pressed && !disabled
                    ? COLORS.creamPressed
                    : '#fff',
                borderRadius: 6,
                paddingHorizontal: 10,
                paddingVertical: 5,
                opacity: disabled ? 0.6 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: active ? '900' : '600',
                  color: active ? COLORS.red : COLORS.ink,
                }}
              >
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '800',
            color: COLORS.ink3,
            letterSpacing: 0.6,
            alignSelf: 'center',
            marginRight: 4,
          }}
        >
          TIMER
        </Text>
        {TURN_TIMER_OPTIONS.map((opt) => {
          const active = opt.key === 0 ? timerOff : !timerOff && secs === opt.key;
          return (
            <Pressable
              key={opt.key}
              disabled={disabled}
              onPress={() => onSet({ turnTimeoutMs: opt.key * 1000 })}
              accessibilityRole="radio"
              accessibilityLabel={`Turn timer: ${opt.label}`}
              accessibilityState={{ selected: active, disabled }}
              style={({ pressed }) => ({
                flex: 1,
                borderWidth: 1,
                borderColor: active ? COLORS.red : COLORS.hairline,
                backgroundColor: active
                  ? COLORS.accentSalmonSwatch
                  : pressed && !disabled
                    ? COLORS.creamPressed
                    : '#fff',
                borderRadius: 6,
                paddingVertical: 5,
                alignItems: 'center',
                opacity: disabled ? 0.6 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: active ? '900' : '600',
                  color: active ? COLORS.red : COLORS.ink,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

interface InviteBodyProps {
  hostUrl: string;
  matchCode: string;
  compact: boolean;
}

function InviteBody({ hostUrl, matchCode, compact }: InviteBodyProps) {
  // Mirror `LanInviteCard`'s URL construction — guests pasting either
  // URL hit the same join surface, and the deep-link prefix needs to
  // match the binary the host is running (Expo Go injects
  // `exp://…/--/`, production uses `modernmahjong://`). The design's
  // hardcoded `modernmahjong://` would break Expo Go testers.
  const browserUrl = useMemo(() => {
    const trimmed = hostUrl.trim().replace(/\/$/, '');
    if (!trimmed) return '';
    return `${trimmed}/match?code=${encodeURIComponent(matchCode)}`;
  }, [hostUrl, matchCode]);
  const deepLinkUrl = useMemo(
    () => Linking.createURL('/match', { queryParams: { code: matchCode, host: hostUrl } }),
    [hostUrl, matchCode],
  );
  // Native Share sheet only exists on iOS / Android. RN-Web does
  // ship `Share.share` but it requires user activation inside a
  // secure context and silently fails in many embedded browsers;
  // mirror `LanInviteCard`'s gate so the SHARE chip only appears
  // where it actually works.
  const canShare = Platform.OS === 'ios' || Platform.OS === 'android';
  return (
    <View style={{ gap: compact ? 6 : 8 }}>
      {browserUrl ? (
        <InviteLink
          title="BROWSER LINK"
          hint="No app · same Wi-Fi"
          url={browserUrl}
          canShare={canShare}
          compact={compact}
        />
      ) : null}
      <InviteLink
        title="APP DEEP LINK"
        hint="Needs app installed"
        url={deepLinkUrl}
        canShare={canShare}
        compact={compact}
      />
    </View>
  );
}

interface InviteLinkProps {
  title: string;
  hint: string;
  url: string;
  canShare: boolean;
  compact: boolean;
}

function InviteLink({ title, hint, url, canShare, compact }: InviteLinkProps) {
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
      // Clipboard denial — visible URL stays selectable as a fallback.
    }
  };
  const onShare = async () => {
    try {
      await Share.share({ message: `Join my mahjong match: ${url}`, url });
    } catch {
      // User dismissed the share sheet, or no share intent registered.
    }
  };
  const padV = compact ? 4 : 5;
  const padH = compact ? 9 : 10;
  return (
    <View>
      <Text
        style={{
          fontSize: 9,
          fontWeight: '800',
          color: COLORS.ink3,
          letterSpacing: 0.5,
          marginBottom: 4,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: COLORS.cream,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          borderRadius: 7,
          paddingVertical: 5,
          paddingHorizontal: 7,
          marginBottom: 4,
        }}
      >
        <Text
          numberOfLines={1}
          selectable
          style={{
            fontFamily: 'JetBrains Mono',
            fontSize: 9,
            color: COLORS.ink,
            lineHeight: 13,
          }}
        >
          {url}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
        <Pressable
          onPress={onCopy}
          accessibilityRole="button"
          accessibilityLabel={copied ? `${title} copied` : `Copy ${title.toLowerCase()}`}
          style={({ pressed }) => ({
            backgroundColor: copied
              ? SUCCESS_PILL.bg
              : pressed
                ? COLORS.creamPressed
                : COLORS.creamLow,
            borderColor: copied ? SUCCESS_PILL.border : COLORS.hairline,
            borderWidth: 1,
            borderRadius: 6,
            paddingVertical: padV,
            paddingHorizontal: padH,
          })}
        >
          <Text
            style={{
              fontSize: 9,
              fontWeight: '800',
              color: copied ? SUCCESS_PILL.fg : COLORS.ink,
              letterSpacing: 0.3,
            }}
          >
            {copied ? 'COPIED' : 'COPY'}
          </Text>
        </Pressable>
        {canShare ? (
          <Pressable
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel={`Share ${title.toLowerCase()}`}
            style={({ pressed }) => ({
              backgroundColor: pressed ? COLORS.creamPressed : COLORS.creamLow,
              borderColor: COLORS.hairline,
              borderWidth: 1,
              borderRadius: 6,
              paddingVertical: padV,
              paddingHorizontal: padH,
            })}
          >
            <Text style={{ fontSize: 9, fontWeight: '800', color: COLORS.ink, letterSpacing: 0.3 }}>
              SHARE
            </Text>
          </Pressable>
        ) : null}
        <Text
          style={{ flex: 1, fontSize: 9, color: COLORS.ink3, fontWeight: '600', lineHeight: 13 }}
        >
          {hint}
        </Text>
      </View>
    </View>
  );
}

interface ActionBarProps {
  isHost: boolean;
  allFilled: boolean;
  onStart: () => void;
  onLeave: () => void;
  compact: boolean;
}

function ActionBar({ isHost, allFilled, onStart, onLeave, compact }: ActionBarProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: compact ? 10 : 14,
        paddingTop: compact ? 10 : 14,
        paddingBottom: compact ? 10 : 18,
        borderTopColor: COLORS.hairline,
        borderTopWidth: 1,
        backgroundColor: COLORS.paperHi,
        alignItems: 'center',
      }}
    >
      <View style={{ flex: 1 }}>
        <PrimaryButton disabled={!isHost || !allFilled} full onPress={onStart}>
          Start match
        </PrimaryButton>
      </View>
      <GhostButton onPress={onLeave}>Leave</GhostButton>
      {isHost && !allFilled ? (
        <Text
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: -16,
            textAlign: 'center',
            fontSize: 10,
            color: COLORS.ink3,
            fontWeight: '700',
          }}
        >
          Fill every seat with a player or a bot before starting.
        </Text>
      ) : null}
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Server-side `startHand` SEATS gate, mirrored locally so the host
 *  gets a disabled button instead of a silent error. */
function isAllSeatsFilled(lobby: LobbyState | null): boolean {
  if (!lobby) return false;
  for (const seat of SEATS) {
    const p = lobby.players.find((x) => x.seat === seat);
    if (!p) return false;
    if (!p.connected && !p.isBot) return false;
  }
  return true;
}

/**
 * Reads / writes the persisted "which accordion sections are open"
 * set from `settings.lobbyAccordionOpen`. Returning a stable
 * `toggleSection` callback (via `useCallback`) keeps `AccordionRow`'s
 * props referentially stable across renders that don't actually
 * change the set — small win, but it keeps the Pressable inside
 * `AccordionRow` from re-rendering for unrelated state changes.
 *
 * The hook works for any section render policy: rendering Bots only
 * for hosts (or Invite only for LAN hosts) means a persisted key
 * that doesn't apply to the current role just stays in the set
 * harmlessly until the user is in a context where the row renders.
 */
function usePersistedOpenSections(): {
  isOpen: (k: AccordionSection) => boolean;
  toggleSection: (k: AccordionSection) => void;
} {
  const persisted = useGame((s) => s.settings.lobbyAccordionOpen);
  const setSettings = useGame((s) => s.setSettings);
  // Derive a Set for O(1) membership checks. New reference only when
  // the persisted array reference changes (i.e. after a toggle).
  const openSet = useMemo(() => new Set<AccordionSection>(persisted), [persisted]);
  const isOpen = useCallback((k: AccordionSection) => openSet.has(k), [openSet]);
  const toggleSection = useCallback(
    (k: AccordionSection) => {
      // Read live to avoid a stale closure if two toggles fire in the
      // same tick — `setSettings` is set-via-reducer in zustand so a
      // patch built from a stale `persisted` snapshot would overwrite
      // an in-flight earlier toggle.
      const live = useGame.getState().settings.lobbyAccordionOpen;
      const next = live.includes(k) ? live.filter((x) => x !== k) : [...live, k];
      setSettings({ lobbyAccordionOpen: next });
    },
    [setSettings],
  );
  return { isOpen, toggleSection };
}

/** Wraps `onAction({ t: 'setRules', ... })` and additionally mirrors
 *  `faanMin` / `turnTimeoutMs` into `settings.lobbyRulePrefs` so the
 *  host's choice persists across matches (same effect the legacy
 *  `RulePanel` had — without this the lobby's mount-time
 *  pref-apply effect would have nothing to re-apply on the next
 *  match).
 *
 *  Reads `lobbyRulePrefs` live via `useGame.getState()` inside the
 *  returned setter rather than capturing the render-time selector
 *  value. Two same-tick chip taps (e.g. faanMin then timer) would
 *  otherwise spread onto the same stale snapshot and the second write
 *  would clobber the first. Mirrors the fix `RulePanel` got in #384. */
function useRuleSetter(onAction: (a: Action) => void) {
  const setSettings = useGame((s) => s.setSettings);
  return (patch: Partial<RuleConfig>) => {
    onAction({ t: 'setRules', rules: patch });
    const livePrefs = useGame.getState().settings.lobbyRulePrefs;
    const prefsPatch: Partial<typeof livePrefs> = {};
    if (patch.faanMin !== undefined) prefsPatch.faanMin = patch.faanMin;
    if (patch.turnTimeoutMs !== undefined) prefsPatch.turnTimeoutMs = patch.turnTimeoutMs;
    if (Object.keys(prefsPatch).length > 0) {
      setSettings({ lobbyRulePrefs: { ...livePrefs, ...prefsPatch } });
    }
  };
}
