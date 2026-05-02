import { generateMatchCode } from '@mahjong/protocol';
import { useState } from 'react';
import { getDisplayName, setDisplayName } from '../identity.js';
import { useGame } from '../state/game.js';

interface LobbyProps {
  onJoin: (matchCode: string) => void;
}

export function Lobby({ onJoin }: LobbyProps) {
  const [name, setName] = useState(getDisplayName());
  const [code, setCode] = useState('');
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
        <button type="button" onClick={() => code && onJoin(code)} disabled={code.length !== 5}>
          Join match
        </button>
        <button
          type="button"
          onClick={() => {
            const fresh = generateMatchCode();
            setCode(fresh);
            onJoin(fresh);
          }}
        >
          Create new match
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
    </div>
  );
}
