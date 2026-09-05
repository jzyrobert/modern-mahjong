import type { Action, Seat } from '@mahjong/game-logic';
import { SEATS } from '@mahjong/game-logic';
import { BOT_LABELS, type BotKind, type PublicPlayer, type RuleConfig } from '@mahjong/protocol';
import * as Clipboard from 'expo-clipboard';
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { JoinInfo } from '../../../net/join-info';
import type { LobbyState } from '../../../state/game';
import { RulePanel } from '../../../ui/RulePanel';
import { SEAT_WIND_GLYPH } from '../../../ui/winds';
import { randomSeed } from '../../../util';
import {
  LOBBY_LANDSCAPE_FELT_BAND,
  LOBBY_PORTRAIT_FELT_BAND,
  LobbyTableBackdrop,
} from './LobbyTableBackdrop';
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

/** Same lamp-lit void as the match shell (`Table3DShell.VOID_BG`). */
const VOID_BG =
  'radial-gradient(ellipse 70% 45% at 50% 0%, rgba(216,168,90,0.15) 0%, rgba(216,168,90,0.06) 55%, rgba(216,168,90,0) 100%), ' +
  'radial-gradient(ellipse 95% 70% at 50% 45%, rgba(216,168,90,0.1) 0%, rgba(216,168,90,0.065) 50%, rgba(216,168,90,0) 90%), ' +
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

/** Height of the scroll cue fade at the bottom of an overflowing panel. */
const PANEL_FADE_H = 44;
/**
 * Phone landscape: the header row is at least this tall so the merged
 * panel starts under the root `FullscreenPrompt` (its FULLSCREEN pill
 * runs y 8–38 and the DISMISS pill under it to y ≈ 62 at the top-right)
 * — round-6: the panel's top-right corner sat under the DISMISS pill.
 * 12 px pad + 46 + 10 px gap puts the panel's top edge at y = 68.
 */
const LANDSCAPE_HEADER_MIN_H = 44;
/** Phone panels (landscape three-column, portrait stack) use a tighter inset than desktop's 18. */
const PHONE_PANEL_PAD = 10;

/**
 * Whether a scroll container has more content below its fold — drives the
 * bottom fade. Re-measured on scroll and on size changes.
 */
function useOverflowBelow(ref: { current: HTMLDivElement | null }, enabled: boolean): boolean {
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setMore(false);
      return;
    }
    const measure = () => setMore(el.scrollHeight - el.clientHeight - el.scrollTop > 2);
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [ref, enabled]);
  return more;
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
  // Phone landscape: one-row header, three-column panel, felt band below.
  const shortWide = compact && twoCol;
  // Phone portrait: header, one scrolling panel (Seats · Bot skill ·
  // collapsed Rules), the Start / Leave row, a felt band below — the
  // page itself never scrolls (`LOBBY_PORTRAIT_FELT_BAND`).
  const phonePortrait = compact && !twoCol;
  const pad = compact ? 12 : 24;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const moreBelow = useOverflowBelow(panelRef, shortWide || phonePortrait);
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

  const seatsBody = (
    <>
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
                padding: compact ? '8px 10px' : '10px 12px',
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
    </>
  );
  const seatsCard = (
    <GlassPanel style={{ padding: compact ? 14 : 18, display: 'grid', gap: 12 }}>
      {seatsBody}
    </GlassPanel>
  );

  const hasBots = isHost && seat !== null && editable.length > 0;
  /**
   * Bot skill rows. `stacked` (the phone-landscape third column) puts
   * each seat's label above its segmented control instead of beside it,
   * so the control gets the column's full width rather than wrapping.
   * Phones drop the two-line hint: the segmented control explains
   * itself, and the 36 px it takes is what keeps the landscape column
   * from scrolling and the portrait panel above its felt band.
   */
  const botsBodyFor = (stacked: boolean) =>
    hasBots ? (
      <>
        <div>
          <div style={labelStyle}>Bot skill</div>
          {compact ? null : (
            <div style={{ fontSize: 12, color: GLASS.text2, marginTop: 4 }}>
              {isSolo
                ? "Tune each opponent's strategy. Saved across sessions."
                : 'Fill empty seats with bots, or swap a bot’s strategy.'}
            </div>
          )}
        </div>
        {editable.map((p) => {
          const s = p.seat as Seat;
          return (
            <div
              key={s}
              data-testid="lobby-bot-row"
              style={
                stacked
                  ? { display: 'grid', gap: 6 }
                  : { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }
              }
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
                  minWidth: stacked ? 0 : 220,
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
      </>
    ) : null;
  const botsBody = botsBodyFor(false);
  const botsCard = botsBody ? (
    <GlassPanel style={{ padding: compact ? 14 : 18, display: 'grid', gap: 12 }}>
      {botsBody}
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

  // Phone portrait: the rules start collapsed to their one-line summary
  // (`Min 0 faan · no timer ▾`) so Seats and Bot skill fit the panel
  // above the felt band without scrolling; a tap expands them in place.
  const rulesBody = (
    <RulePanel
      rules={rules}
      isHost={isHost}
      onAction={onAction}
      theme="glass"
      collapsible={phonePortrait}
    />
  );
  const rulesCard = <div style={glassStyle({ padding: compact ? 6 : 8 })}>{rulesBody}</div>;

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
  // Two-column viewports without a side scene (phone landscape, small
  // desktops): Seats, Rules and the Bot skill rows share one glass panel
  // split by hairlines instead of three panels with gutters — round-4 #4
  // found the 12 px slot between Seats and Rules showing a slice of plate
  // and wall, and round-4 #7 the one above Bot skill showing the rail.
  const merged = twoCol && !sideScene;

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
        <LobbyTableBackdrop side={sideScene} />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          // Phones: the page itself never scrolls — the panel does,
          // above a band of felt (`LOBBY_*_FELT_BAND`).
          overflowY: shortWide || phonePortrait ? 'hidden' : 'auto',
          boxSizing: 'border-box',
          padding: `${pad + insets.top}px ${pad + insets.right}px ${
            shortWide
              ? LOBBY_LANDSCAPE_FELT_BAND + insets.bottom
              : phonePortrait
                ? LOBBY_PORTRAIT_FELT_BAND + insets.bottom
                : pad + insets.bottom
          }px ${pad + insets.left}px`,
        }}
      >
        <div
          style={{
            maxWidth: sideScene ? 560 : twoCol ? 1040 : 720,
            margin: sideScene ? '0 0 0 24px' : '0 auto',
            minHeight: compact ? undefined : '100%',
            ...(shortWide || phonePortrait
              ? { height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }
              : { display: 'grid', alignContent: 'center', gap: 14 }),
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: shortWide ? 'center' : 'flex-end',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              flex: 'none',
              ...(shortWide ? { minHeight: LANDSCAPE_HEADER_MIN_H } : null),
            }}
          >
            <div
              style={
                shortWide
                  ? { display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0, flex: 1 }
                  : { display: 'grid', gap: 4 }
              }
            >
              <span style={{ ...labelStyle, whiteSpace: 'nowrap' }}>
                {isSolo ? 'Solo · vs bots' : 'Online match'}
              </span>
              <h1
                style={{
                  margin: 0,
                  fontSize: shortWide ? 22 : compact ? 24 : 34,
                  fontWeight: 800,
                  letterSpacing: -0.5,
                  lineHeight: 1.05,
                  color: GLASS.text,
                }}
              >
                Lobby
              </h1>
              <span
                style={{
                  fontSize: 13,
                  color: GLASS.text2,
                  ...(shortWide
                    ? {
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }
                    : null),
                }}
              >
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
          {merged ? (
            <div style={{ ...column, ...(shortWide ? { flex: '0 1 auto', minHeight: 0 } : null) }}>
              {inviteCard}
              {/* Phone landscape: three columns — Seats | Rules + Start |
                  Bot skill — inside a panel that never grows past the felt
                  band; when it still overflows (long names, invite card)
                  it scrolls inside, with a fade as the cue. Wider merged
                  viewports keep two columns with the bot rows underneath. */}
              <GlassPanel
                testID="lobby-merged-panel"
                style={{
                  padding: 0,
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <div
                  ref={panelRef}
                  data-testid="lobby-merged-scroll"
                  style={{
                    padding: compact ? PHONE_PANEL_PAD : 18,
                    display: 'grid',
                    gridTemplateColumns: shortWide && botsBody ? '1fr 1fr 1fr' : '1fr 1fr',
                    gap: 0,
                    minHeight: 0,
                    overflowY: shortWide ? 'auto' : 'visible',
                  }}
                >
                  <div style={{ ...column, paddingRight: compact ? PHONE_PANEL_PAD : 18 }}>
                    {seatsBody}
                  </div>
                  <div
                    style={{
                      ...column,
                      paddingLeft: compact ? PHONE_PANEL_PAD : 18,
                      paddingRight: shortWide && botsBody ? PHONE_PANEL_PAD : 0,
                      borderLeft: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    {rulesBody}
                    {actions}
                  </div>
                  {botsBody ? (
                    shortWide ? (
                      <div
                        data-testid="lobby-merged-bots"
                        style={{
                          ...column,
                          paddingLeft: PHONE_PANEL_PAD,
                          borderLeft: '1px solid rgba(255,255,255,0.1)',
                        }}
                      >
                        {botsBodyFor(true)}
                      </div>
                    ) : (
                      <div
                        data-testid="lobby-merged-bots"
                        style={{
                          ...column,
                          gridColumn: '1 / -1',
                          marginTop: compact ? 14 : 18,
                          paddingTop: compact ? 14 : 18,
                          borderTop: '1px solid rgba(255,255,255,0.1)',
                        }}
                      >
                        {botsBody}
                      </div>
                    )
                  ) : null}
                </div>
                {moreBelow ? (
                  <div
                    data-testid="lobby-panel-fade"
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: PANEL_FADE_H,
                      pointerEvents: 'none',
                      background:
                        'linear-gradient(180deg, rgba(14,20,17,0) 0%, rgba(14,20,17,0.92) 100%)',
                    }}
                  />
                ) : null}
              </GlassPanel>
            </div>
          ) : phonePortrait ? (
            <>
              {/* Phone portrait: Seats, Bot skill and the collapsed Rules
                  share one panel split by hairlines, capped so the Start /
                  Leave row and a band of the waiting table stay on screen;
                  when it still overflows (invite card, long names) it
                  scrolls inside with a fade as the cue. */}
              <GlassPanel
                testID="lobby-portrait-panel"
                style={{
                  padding: 0,
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  flex: '0 1 auto',
                  minHeight: 0,
                }}
              >
                <div
                  ref={panelRef}
                  data-testid="lobby-portrait-scroll"
                  style={{
                    padding: `${PHONE_PANEL_PAD + 2}px ${PHONE_PANEL_PAD + 2}px`,
                    display: 'grid',
                    gap: 12,
                    minHeight: 0,
                    overflowY: 'auto',
                  }}
                >
                  {inviteCard}
                  <div style={column}>{seatsBody}</div>
                  {botsBody ? (
                    <div
                      data-testid="lobby-portrait-bots"
                      style={{
                        ...column,
                        paddingTop: 12,
                        borderTop: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      {botsBody}
                    </div>
                  ) : null}
                  <div style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    {rulesBody}
                  </div>
                </div>
                {moreBelow ? (
                  <div
                    data-testid="lobby-panel-fade"
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: PANEL_FADE_H,
                      pointerEvents: 'none',
                      background:
                        'linear-gradient(180deg, rgba(14,20,17,0) 0%, rgba(14,20,17,0.92) 100%)',
                    }}
                  />
                ) : null}
              </GlassPanel>
              <div data-testid="lobby-portrait-actions" style={{ flex: 'none' }}>
                {actions}
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div style={column}>
                {inviteCard}
                {seatsCard}
                {botsCard}
                {rulesCard}
                {actions}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
