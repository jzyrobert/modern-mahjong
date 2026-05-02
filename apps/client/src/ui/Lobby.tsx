import { generateMatchCode } from '@mahjong/protocol';
import { useState } from 'react';
import { getDisplayName, setDisplayName } from '../identity.js';
import { useGame } from '../state/game.js';
import { HostLanModal } from './HostLanModal.js';
import { JoinLanModal } from './JoinLanModal.js';

interface LobbyProps {
  onJoinOnline: (matchCode: string) => void;
  onJoinLan: (hostUrl: string, matchCode: string) => void;
}

export function Lobby({ onJoinOnline, onJoinLan }: LobbyProps) {
  const [name, setName] = useState(getDisplayName());
  const [code, setCode] = useState('');
  const [hostLanOpen, setHostLanOpen] = useState(false);
  const [joinLanOpen, setJoinLanOpen] = useState(false);
  const lobby = useGame((s) => s.lobby);

  return (
    <div style={{ padding: 24, color: '#eee', fontFamily: 'system-ui, sans-serif', maxWidth: 480 }}>
      <h1>Modern Mahjong</h1>
      <label style={{ display: 'block', margin: '12px 0' }}>
        Display name
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDisplayName(e.target.value);
          }}
          style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
        />
      </label>

      <h3>Online match</h3>
      <label style={{ display: 'block', margin: '12px 0' }}>
        Match code
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={5}
          style={{
            display: 'block',
            width: '100%',
            padding: 8,
            marginTop: 4,
            fontFamily: 'monospace',
            textTransform: 'uppercase',
          }}
          placeholder="ABCDE"
        />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
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
      </div>

      <h3 style={{ marginTop: 24 }}>LAN / offline</h3>
      <p style={{ fontSize: 12, opacity: 0.7 }}>
        Play four-player matches over your local network without an internet connection. The host
        runs the installed app and shares a URL or QR code; guests can join from any browser on the
        same Wi-Fi.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setHostLanOpen(true)}>
          Host LAN match
        </button>
        <button type="button" onClick={() => setJoinLanOpen(true)}>
          Join LAN match
        </button>
      </div>

      {lobby && (
        <div style={{ marginTop: 24, padding: 12, background: '#1a1f2e', borderRadius: 6 }}>
          <h3>Lobby</h3>
          <ul>
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
        onClose={() => setJoinLanOpen(false)}
        onJoin={(url, matchCode) => {
          setJoinLanOpen(false);
          onJoinLan(url, matchCode);
        }}
      />
    </div>
  );
}
