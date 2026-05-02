import { generateMatchCode } from '@mahjong/protocol';
import { useState } from 'react';
import { getDisplayName, setDisplayName } from '../identity.js';
import { isLanOrigin } from '../net/transport.js';
import { useGame } from '../state/game.js';
import { HostLanModal } from './HostLanModal.js';
import { JoinLanModal } from './JoinLanModal.js';

interface LobbyProps {
  onJoinOnline: (matchCode: string) => void;
  onJoinLan: (hostUrl: string, matchCode: string) => void;
  onJoinSolo: () => void;
}

export function Lobby({ onJoinOnline, onJoinLan, onJoinSolo }: LobbyProps) {
  const lanGuest = isLanOrigin();
  const lanOrigin = lanGuest && typeof window !== 'undefined' ? window.location.origin : '';
  const [name, setName] = useState(getDisplayName());
  const [code, setCode] = useState('');
  const [hostLanOpen, setHostLanOpen] = useState(false);
  const [joinLanOpen, setJoinLanOpen] = useState(lanGuest);
  const lobby = useGame((s) => s.lobby);

  return (
    <div
      style={{
        padding: 'clamp(8px, 2vmin, 24px)',
        color: '#eee',
        fontFamily: 'system-ui, sans-serif',
        // Wide enough for desktop reading, compresses on phones.
        maxWidth: 880,
        margin: '0 auto',
      }}
    >
      <h1 style={{ margin: '0 0 8px', fontSize: 'clamp(20px, 3.4vmin, 28px)' }}>Modern Mahjong</h1>
      <label style={{ display: 'block', margin: '8px 0 12px' }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Display name</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDisplayName(e.target.value);
          }}
          style={inputStyle}
        />
      </label>

      {/*
        Two-column grid on viewports ≥ 600 px wide so a landscape phone
        (~800×360) sees every section at once. Below that it stacks
        vertically.
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 'clamp(8px, 1.5vmin, 16px)',
        }}
      >
        <Section title="Online match">
          <label style={{ display: 'block', marginBottom: 8 }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Match code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={5}
              placeholder="ABCDE"
              style={{
                ...inputStyle,
                fontFamily: 'monospace',
                textTransform: 'uppercase',
              }}
            />
          </label>
          <ButtonRow>
            <button
              type="button"
              onClick={() => code && onJoinOnline(code)}
              disabled={code.length !== 5}
            >
              Join match
            </button>
            <button
              type="button"
              onClick={() => {
                const fresh = generateMatchCode();
                setCode(fresh);
                onJoinOnline(fresh);
              }}
            >
              Create new match
            </button>
          </ButtonRow>
        </Section>

        <Section title="Practice vs bots">
          <p style={{ fontSize: 12, opacity: 0.7, margin: '0 0 8px' }}>
            Runs entirely on this device. No connection. You're seated against three bots
            (heuristic, simple, passive).
          </p>
          <button type="button" onClick={onJoinSolo}>
            Play vs bots
          </button>
        </Section>

        <Section title="LAN / offline">
          <p style={{ fontSize: 12, opacity: 0.7, margin: '0 0 8px' }}>
            Four-player matches over local Wi-Fi. Host shares the URL; guests paste it into any
            browser on the same network.
          </p>
          <ButtonRow>
            <button type="button" onClick={() => setHostLanOpen(true)}>
              Host LAN match
            </button>
            <button type="button" onClick={() => setJoinLanOpen(true)}>
              Join LAN match
            </button>
          </ButtonRow>
        </Section>
      </div>

      {lobby && (
        <div
          style={{
            marginTop: 16,
            padding: 'clamp(8px, 1.5vmin, 12px)',
            background: '#1a1f2e',
            borderRadius: 6,
          }}
        >
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Lobby</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {lobby.players.map((p) => (
              <li key={p.playerId}>
                Seat {p.seat}: {p.displayName}{' '}
                {p.isBot ? '(bot)' : p.connected ? '(online)' : '(disconnected)'}
              </li>
            ))}
          </ul>
        </div>
      )}

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: '#171b27',
        padding: 'clamp(8px, 1.5vmin, 14px)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>{title}</h3>
      {children}
    </section>
  );
}

function ButtonRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>;
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: 8,
  marginTop: 4,
  borderRadius: 4,
  border: '1px solid #2228',
  background: '#0e1320',
  color: '#eee',
};
