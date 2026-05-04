import { generateMatchCode } from '@mahjong/protocol';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { getDisplayName, setDisplayName } from '../identity.js';
import {
  CREAM,
  FELT,
  FELT_2,
  GOLD,
  HAIRLINE,
  INK,
  INK_2,
  INK_3,
  PAPER_HI,
  RED,
  SANS,
  SERIF,
} from '../native/theme.js';
import { isLanOrigin } from '../net/transport.js';
import { useGame } from '../state/game.js';
import { HostLanModal } from './HostLanModal.js';
import { JoinLanModal } from './JoinLanModal.js';
import { GhostButton, PrimaryButton, TextField } from './buttons.js';
import { LobbyPreview } from './menu/LobbyPreview.js';
import { ScatteredTiles } from './menu/ScatteredTiles.js';
import { WindEmblem } from './menu/WindEmblem.js';

interface LobbyProps {
  onJoinOnline: (matchCode: string) => void;
  onJoinLan: (hostUrl: string, matchCode: string) => void;
  onJoinSolo: () => void;
}

/**
 * Top-level menu screen — ported from `/tmp/design/design/menu.jsx`. Hero
 * with the wind emblem + bilingual title, three mode cards (Online /
 * Practice / LAN), live `LobbyPreview` of the current `useGame.lobby` once
 * the user has joined a match, and decorative scattered tile-backs in the
 * corners.
 */
export function Lobby({ onJoinOnline, onJoinLan, onJoinSolo }: LobbyProps) {
  const lanGuest = isLanOrigin();
  const lanOrigin = lanGuest && typeof window !== 'undefined' ? window.location.origin : '';
  // Lazy initialiser — `getDisplayName()` reads from preferences, so we
  // only want to run it on first mount, not on every render.
  const [name, setName] = useState(() => getDisplayName());
  const [code, setCode] = useState('');
  const [hostLanOpen, setHostLanOpen] = useState(false);
  const [joinLanOpen, setJoinLanOpen] = useState(lanGuest);
  const lobby = useGame((s) => s.lobby);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        paddingBottom: 40,
        fontFamily: SANS,
        color: INK,
      }}
    >
      <ScatteredTiles />

      {/* Top bar — brand mark + identity */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 28px',
          gap: 12,
          flexWrap: 'wrap',
          position: 'relative',
          zIndex: 5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${FELT}, ${FELT_2})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 6px rgba(0,0,0,0.15), inset 0 -2px 0 rgba(0,0,0,0.18)',
            }}
          >
            <span
              style={{
                fontFamily: SERIF,
                color: GOLD,
                fontSize: 18,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              麻
            </span>
          </div>
          <div
            style={{
              fontWeight: 900,
              fontSize: 14,
              color: INK,
              letterSpacing: 0.3,
              whiteSpace: 'nowrap',
            }}
          >
            Modern Mahjong
          </div>
        </div>

        <IdentityCard
          name={name}
          onChange={(v) => {
            setName(v);
            setDisplayName(v);
          }}
        />
      </div>

      {/* Hero */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          padding: '12px 28px 28px',
          position: 'relative',
          zIndex: 5,
          textAlign: 'center',
        }}
      >
        <WindEmblem wind="東" size={84} />
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 14,
            flexWrap: 'wrap',
            justifyContent: 'center',
            marginTop: 6,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontWeight: 900,
              fontSize: 'clamp(28px, 5vw, 44px)',
              color: INK,
              letterSpacing: -0.5,
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            Modern Mahjong
          </h1>
          <span
            style={{
              fontFamily: SERIF,
              fontWeight: 700,
              fontSize: 'clamp(22px, 4vw, 34px)',
              color: RED,
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            麻雀
          </span>
        </div>
        <div
          style={{ fontSize: 14, fontWeight: 600, color: INK_3, maxWidth: 580, lineHeight: 1.5 }}
        >
          Hong Kong rules · 136 tiles · play online with friends, on the same Wi-Fi, or against
          bots.
        </div>
      </div>

      {/* Mode grid */}
      <div
        style={{
          maxWidth: 1080,
          width: '100%',
          margin: '0 auto',
          padding: '0 28px',
          position: 'relative',
          zIndex: 5,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          <ModeCard
            accent
            title="Online match"
            subtitle="Play with friends over the internet"
            icon={<GlobeIcon />}
          >
            <TextField
              label="Match code"
              value={code}
              onChange={(v) => setCode(v.toUpperCase())}
              placeholder="ABCDE"
              mono
              maxLength={5}
            />
            <ButtonRow>
              <PrimaryButton
                onClick={() => code && onJoinOnline(code)}
                disabled={code.length !== 5}
              >
                Join match
              </PrimaryButton>
              <GhostButton
                onClick={() => {
                  const fresh = generateMatchCode();
                  setCode(fresh);
                  onJoinOnline(fresh);
                }}
              >
                Create new match
              </GhostButton>
            </ButtonRow>
          </ModeCard>

          <ModeCard
            title="Practice vs bots"
            subtitle="Single device · no connection"
            icon={<BotIcon />}
          >
            <div style={{ fontSize: 12, color: INK_3, lineHeight: 1.5 }}>
              Three opponents at varying skill — <strong style={inkStrong}>heuristic</strong>,{' '}
              <strong style={inkStrong}>simple</strong>, and{' '}
              <strong style={inkStrong}>passive</strong>. Runs entirely on this device.
            </div>
            <TagRow tags={['Heuristic', 'Simple', 'Passive']} />
            <ButtonRow>
              <PrimaryButton onClick={onJoinSolo}>Play vs bots</PrimaryButton>
            </ButtonRow>
          </ModeCard>

          <ModeCard title="LAN / offline" subtitle="Same-Wi-Fi matches" icon={<WifiIcon />}>
            <div style={{ fontSize: 12, color: INK_3, lineHeight: 1.5 }}>
              Four-player matches over local Wi-Fi. Host shares the URL; guests paste it into any
              browser on the same network.
            </div>
            <InlineHint icon={<BoxIcon />}>
              Works offline. No accounts. No data leaves your network.
            </InlineHint>
            <ButtonRow>
              <PrimaryButton onClick={() => setHostLanOpen(true)}>Host LAN match</PrimaryButton>
              <GhostButton onClick={() => setJoinLanOpen(true)}>Join LAN match</GhostButton>
            </ButtonRow>
          </ModeCard>
        </div>

        {lobby ? <LobbyPreview lobby={lobby} matchCode={null} /> : null}
      </div>

      <HostLanModal
        open={hostLanOpen}
        onClose={() => setHostLanOpen(false)}
        onHosted={(url, matchCode) => {
          setHostLanOpen(false);
          onJoinLan(url, matchCode);
        }}
      />
      <JoinLanModal
        open={joinLanOpen}
        defaultUrl={lanOrigin}
        onClose={() => setJoinLanOpen(false)}
        onJoin={(url, matchCode) => {
          setJoinLanOpen(false);
          onJoinLan(url, matchCode);
        }}
      />
    </div>
  );
}

const inkStrong: React.CSSProperties = { color: INK_2, fontWeight: 800 };

function IdentityCard({ name, onChange }: { name: string; onChange: (v: string) => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: PAPER_HI,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 10,
        padding: '6px 10px 6px 6px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          background: 'linear-gradient(135deg, oklch(0.72 0.14 30), oklch(0.62 0.16 25))',
          color: 'white',
          fontWeight: 800,
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.18)',
        }}
      >
        {(name || '?').slice(0, 2).toUpperCase()}
      </div>
      <input
        value={name}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Display name"
        style={{
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: 700,
          color: INK,
          width: 120,
        }}
      />
    </div>
  );
}

interface ModeCardProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  accent?: boolean;
  children: ReactNode;
}

function ModeCard({ title, subtitle, icon, accent = false, children }: ModeCardProps) {
  // Hover lift + shadow come from the `.mh-mode-card:hover` rule in
  // `src/styles.css`; the only state-driven inline override here is the
  // accent border colour, which depends on the `accent` prop.
  return (
    <div
      className="mh-mode-card"
      style={{ border: `1px solid ${accent ? 'oklch(0.78 0.13 30)' : HAIRLINE}` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: accent ? 'oklch(0.96 0.04 30)' : 'oklch(0.95 0.015 80)',
            border: `1px solid ${accent ? 'oklch(0.86 0.06 30)' : HAIRLINE}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: accent ? RED : INK_2,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: INK, lineHeight: 1.1 }}>{title}</div>
          <div style={{ fontSize: 12, color: INK_3, marginTop: 2, fontWeight: 600 }}>
            {subtitle}
          </div>
        </div>
        {accent ? <RecommendedBadge /> : null}
      </div>
      {children}
    </div>
  );
}

function RecommendedBadge() {
  return (
    <div
      style={{
        background: 'oklch(0.96 0.04 30)',
        color: RED,
        fontSize: 9,
        fontWeight: 900,
        letterSpacing: 0.7,
        textTransform: 'uppercase',
        padding: '3px 7px',
        borderRadius: 6,
        border: '1px solid oklch(0.86 0.06 30)',
      }}
    >
      Recommended
    </div>
  );
}

function ButtonRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>;
}

function TagRow({ tags }: { tags: readonly string[] }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {tags.map((t) => (
        <span
          key={t}
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 0.4,
            color: 'oklch(0.45 0.1 280)',
            background: 'oklch(0.96 0.03 280)',
            border: '1px solid oklch(0.88 0.04 280)',
            padding: '3px 7px',
            borderRadius: 6,
          }}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function InlineHint({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: CREAM,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 8,
        padding: '8px 10px',
        fontSize: 11,
        color: INK_3,
        fontWeight: 600,
      }}
    >
      {icon}
      {children}
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
    </svg>
  );
}

function BotIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3" />
      <circle cx="9" cy="13" r="1.4" />
      <circle cx="15" cy="13" r="1.4" />
      <path d="M9 17h6" />
    </svg>
  );
}

function WifiIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path d="M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 2l9 4.5v9L12 20l-9-4.5v-9z" />
      <path d="M12 22V12" />
      <path d="M21 7l-9 5-9-5" />
    </svg>
  );
}
