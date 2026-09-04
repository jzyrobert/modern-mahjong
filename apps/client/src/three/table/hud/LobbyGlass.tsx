import type { Action, Seat } from '@mahjong/game-logic';
import { SEATS } from '@mahjong/game-logic';
import { BOT_LABELS, type BotKind, type PublicPlayer, type RuleConfig } from '@mahjong/protocol';
import * as Clipboard from 'expo-clipboard';
import { type CSSProperties, useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { JoinInfo } from '../../../net/join-info';
import type { LobbyState } from '../../../state/game';
import { RulePanel } from '../../../ui/RulePanel';
import { SEAT_WIND_GLYPH } from '../../../ui/winds';
import { randomSeed } from '../../../util';
import { LobbyTableBackdrop } from './LobbyTableBackdrop';
import { GLASS, GlassButton, GlassPanel, HUD_CSS, glassStyle, labelStyle } from './glass';

/**
 * Pre-game waiting room in the parlour's glass language, mounted by
 * `LobbyView` when the renderer resolves to `'3d'`. Same props and the
 * same accessible names as the classic lobby (`Start match`, `Leave`,
 * `Set seat N to …`, `Remove bot from seat N`) so the recipes and the
 * host-side rule logic (`RulePanel`) carry over unchanged. Web-only DOM.
 */
export interface Lobby3DViewProps {
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

const VOID_BG =
  'radial-gradient(ellipse 70% 40% at 50% 28%, rgba(58,74,58,0.3), rgba(58,74,58,0) 70%), linear-gradient(180deg, #0b120f 0%, #16241d 100%)';

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

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = (text: string) => {
    Clipboard.setStringAsync(text)
      .then(() => setCopied(true))
      .catch(() => {
        // Clipboard can be denied off-HTTPS; the text stays selectable.
      });
  };
  return [copied, copy];
}

export function LobbyGlass(props: Lobby3DViewProps) {
  const { rules, lobby, seat, isHost, matchCode, joinInfo, onAction, onLeave } = props;
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 768 || height < 600;
  const twoCol = width > height && width >= 700;
  const pad = compact ? 12 : 24;
  const isSolo = matchCode === 'SOLO';
  const isLanHost = !!(isHost && joinInfo?.kind === 'lan' && joinInfo.hostUrl && matchCode);
  const joinUrl =
    isLanHost && joinInfo?.kind === 'lan'
      ? `${joinInfo.hostUrl.trim().replace(/\/$/, '')}/match?code=${encodeURIComponent(matchCode ?? '')}`
      : '';
  const [codeCopied, copyCode] = useCopied();
  const [urlCopied, copyUrl] = useCopied();
  const filled = allSeatsFilled(lobby);
  const humans = lobby?.players.filter((p) => !p.isBot && p.connected).length ?? 0;

  const players = SEATS.map((s) => lobby?.players.find((p) => p.seat === s) ?? null);
  const editable = (lobby?.players ?? []).filter(
    (p) => p.seat !== null && p.seat !== seat && (p.isBot || !p.connected),
  );

  const seatsCard = (
    <GlassPanel style={{ padding: compact ? 14 : 18, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span
            className="mj-pulse"
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: GLASS.success,
              boxShadow: '0 0 8px rgba(58,160,102,0.8)',
            }}
          />
          <span style={labelStyle}>Seats</span>
        </span>
        <span style={{ ...labelStyle, letterSpacing: 1 }}>
          {humans} {humans === 1 ? 'player' : 'players'} · {filled ? 'ready' : 'waiting'}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          // 2×2 everywhere: four cards in one row squeeze a 14-char name
          // + 'Bot · Standard' into ~120 px on desktop's half-width column.
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
        }}
      >
        {players.map((p, i) => {
          const s = i as Seat;
          const you = s === seat;
          const status = !p
            ? 'Empty'
            : p.isBot
              ? `Bot · ${BOT_LABELS[p.botKind ?? 'simple']}`
              : p.connected
                ? 'Online'
                : 'Disconnected';
          const statusColor = !p
            ? GLASS.text2
            : p.isBot
              ? '#c9b3e6'
              : p.connected
                ? '#7fd0a0'
                : '#f0a08e';
          return (
            <div
              key={s}
              style={{
                borderRadius: 14,
                padding: '10px 12px',
                background: you ? 'rgba(216,168,90,0.12)' : 'rgba(255,255,255,0.045)',
                border: you ? GLASS.borderGold : GLASS.border,
                display: 'grid',
                gap: 4,
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span
                  style={{
                    fontFamily: GLASS.serif,
                    fontSize: 20,
                    fontWeight: 700,
                    color: GLASS.gold,
                    lineHeight: 1,
                  }}
                >
                  {SEAT_WIND_GLYPH[s]}
                </span>
                <span style={{ ...labelStyle, letterSpacing: 1.2, whiteSpace: 'nowrap' }}>
                  Seat {s}
                </span>
              </div>
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 14,
                  color: p ? GLASS.text : GLASS.text2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {p ? p.displayName : 'Open seat'}
              </span>
              <span
                style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: statusColor }}
              >
                {you ? <span style={{ color: GLASS.gold }}>You · </span> : null}
                {status}
              </span>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );

  const botsCard =
    isHost && seat !== null && editable.length > 0 ? (
      <GlassPanel style={{ padding: compact ? 14 : 18, display: 'grid', gap: 12 }}>
        <div>
          <div style={labelStyle}>Bot skill</div>
          <div style={{ fontSize: 12, color: GLASS.text2, marginTop: 4 }}>
            {isSolo
              ? "Tune each opponent's strategy. Saved across sessions."
              : 'Fill empty seats with bots, or swap a bot’s strategy.'}
          </div>
        </div>
        {editable.map((p) => {
          const s = p.seat as Seat;
          return (
            <div
              key={s}
              style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'baseline',
                  gap: 6,
                  minWidth: 64,
                }}
              >
                <span style={{ fontFamily: GLASS.serif, fontSize: 16, color: GLASS.gold }}>
                  {SEAT_WIND_GLYPH[s]}
                </span>
                <span style={{ ...labelStyle, letterSpacing: 1.2 }}>Seat {s}</span>
              </span>
              <fieldset
                aria-label={`Seat ${s} bot skill`}
                style={{
                  display: 'flex',
                  flex: 1,
                  minWidth: 220,
                  background: 'rgba(0,0,0,0.28)',
                  borderRadius: 10,
                  padding: 3,
                  margin: 0,
                  border: 0,
                  gap: 2,
                }}
              >
                {BOT_KIND_OPTIONS.map((opt) => {
                  const active = p.botKind === opt.kind;
                  return (
                    <button
                      key={opt.kind}
                      type="button"
                      aria-pressed={active}
                      aria-label={`Set seat ${s} to ${opt.label}`}
                      title={opt.hint}
                      onClick={() => props.onSeatBot(s, opt.kind)}
                      className="mj-glass-btn"
                      style={{
                        appearance: 'none',
                        flex: 1,
                        border: 0,
                        cursor: 'pointer',
                        borderRadius: 8,
                        minHeight: 36,
                        fontFamily: GLASS.font,
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: 1.2,
                        textTransform: 'uppercase',
                        color: active ? GLASS.goldInk : GLASS.text2,
                        background: active ? GLASS.gold : 'transparent',
                        transition: 'background 160ms ease-out, color 160ms ease-out',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </fieldset>
              {!isSolo && p.isBot ? (
                <GlassButton
                  kind="ghost"
                  minHeight={36}
                  ariaLabel={`Remove bot from seat ${s}`}
                  onClick={() => props.onUnseatBot(s)}
                  style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' }}
                >
                  Remove
                </GlassButton>
              ) : null}
            </div>
          );
        })}
      </GlassPanel>
    ) : null;

  const inviteCard = isLanHost ? (
    <GlassPanel style={{ padding: compact ? 14 : 18, display: 'grid', gap: 10 }}>
      <div style={labelStyle}>Invite · same Wi-Fi</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <code
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            color: GLASS.text,
            background: 'rgba(0,0,0,0.3)',
            border: GLASS.border,
            borderRadius: 10,
            padding: '8px 10px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {joinUrl}
        </code>
        <GlassButton
          kind={urlCopied ? 'primary' : 'secondary'}
          minHeight={36}
          ariaLabel={urlCopied ? 'Join URL copied' : 'Copy join URL'}
          onClick={() => copyUrl(joinUrl)}
          style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' }}
        >
          {urlCopied ? 'Copied' : 'Copy join URL'}
        </GlassButton>
      </div>
    </GlassPanel>
  ) : null;

  const rulesCard = (
    <div style={glassStyle({ padding: compact ? 6 : 8 })}>
      <RulePanel rules={rules} isHost={isHost} onAction={onAction} theme="glass" />
    </div>
  );

  const actions = (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <GlassButton
          kind="primary"
          disabled={!isHost || !filled}
          onClick={() => onAction({ t: 'startHand', seed: randomSeed() })}
          style={{ flex: compact ? 1 : undefined, minWidth: 160 }}
        >
          Start match
        </GlassButton>
        <GlassButton kind="secondary" onClick={onLeave}>
          Leave
        </GlassButton>
      </div>
      {isHost && !filled ? (
        <span style={{ fontSize: 12, color: GLASS.text2 }}>
          Fill every seat with a player or a bot before starting.
        </span>
      ) : null}
    </div>
  );

  const column: CSSProperties = { display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 };
  // Wide viewports: one 560 px content column at a 48 px inset on the
  // left, the whole waiting table framed in the free area right of it
  // (`LobbyTableBackdrop`, `lobbyCameraFor`).
  const sideScene = !compact && width >= 1100;

  return (
    <div
      data-testid="lobby-3d"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: VOID_BG,
        fontFamily: GLASS.font,
        color: GLASS.text,
        boxSizing: 'border-box',
      }}
    >
      <style>{HUD_CSS}</style>
      <div
        data-testid="lobby-3d-backdrop"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.85 }}
      >
        <LobbyTableBackdrop
          side={sideScene}
          filled={SEATS.map((s) => {
            const p = lobby?.players.find((x) => x.seat === s);
            return !!p && (p.isBot || p.connected);
          })}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflowY: 'auto',
          boxSizing: 'border-box',
          padding: `${pad + insets.top}px ${pad + insets.right}px ${pad + insets.bottom}px ${pad + insets.left}px`,
        }}
      >
        <div
          style={{
            maxWidth: sideScene ? 560 : twoCol ? 1040 : 720,
            margin: sideScene ? '0 0 0 24px' : '0 auto',
            minHeight: compact ? undefined : '100%',
            display: 'grid',
            alignContent: compact ? 'start' : 'center',
            gap: 14,
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'grid', gap: 4 }}>
              <span style={labelStyle}>{isSolo ? 'Solo · vs bots' : 'Online match'}</span>
              <h1
                style={{
                  margin: 0,
                  fontSize: compact ? 28 : 34,
                  fontWeight: 800,
                  letterSpacing: -0.5,
                  lineHeight: 1.05,
                  color: GLASS.text,
                }}
              >
                Lobby
              </h1>
              <span style={{ fontSize: 13, color: GLASS.text2 }}>
                {isLanHost
                  ? 'Share the join URL with friends on the same Wi-Fi. Start when everyone is ready.'
                  : isHost
                    ? isSolo
                      ? 'Pick your opponents and rules, then start.'
                      : 'Share the match code with friends. Start when everyone is ready.'
                    : 'Waiting for the host to start the match.'}
              </span>
            </div>
            {matchCode && !isSolo ? (
              <button
                type="button"
                aria-label={codeCopied ? 'Match code copied' : `Copy match code ${matchCode}`}
                onClick={() => copyCode(matchCode)}
                className="mj-glass-btn"
                style={glassStyle({
                  borderRadius: 999,
                  padding: '0 14px 0 8px',
                  height: 44,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  border: codeCopied ? '1px solid rgba(58,160,102,0.7)' : GLASS.borderGold,
                })}
              >
                <span style={{ ...labelStyle, letterSpacing: 1.2 }}>Code</span>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontSize: 15,
                    fontWeight: 800,
                    letterSpacing: 3,
                    color: codeCopied ? GLASS.success : GLASS.gold,
                  }}
                >
                  {codeCopied ? 'COPIED' : matchCode}
                </span>
              </button>
            ) : null}
          </header>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: twoCol && !sideScene ? '1fr 1fr' : '1fr',
              gap: 12,
            }}
          >
            <div style={column}>
              {inviteCard}
              {seatsCard}
              {botsCard}
              {sideScene ? rulesCard : null}
              {sideScene ? actions : null}
            </div>
            {sideScene ? null : (
              <div style={column}>
                {rulesCard}
                {actions}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
