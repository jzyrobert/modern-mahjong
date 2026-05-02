import type { Action } from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getDisplayName, getPlayerId } from './identity.js';
import { type Transport, createOnlineTransport } from './net/transport.js';
import { useGame } from './state/game.js';
import { Lobby } from './ui/Lobby.js';
import { Match } from './ui/Match.js';

function App() {
  const [transport, setTransport] = useState<Transport | null>(null);
  const setState = useGame((s) => s.setState);
  const setLobby = useGame((s) => s.setLobby);
  const state = useGame((s) => s.state);

  const onJoin = useCallback((matchCode: string) => {
    const playerId = getPlayerId();
    const displayName = getDisplayName();
    const t = createOnlineTransport({
      host: import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8787',
      matchCode,
      playerId,
      displayName,
    });
    setTransport(t);
  }, []);

  useEffect(() => {
    if (!transport) return;
    return transport.onMessage((m: ServerMessage) => {
      if (m.t === 'state') setState(m.state, m.you);
      else if (m.t === 'delta') setState(m.state);
      else if (m.t === 'lobby') setLobby(m);
      else if (m.t === 'error') console.warn('server error:', m.code, m.detail);
    });
  }, [transport, setState, setLobby]);

  const onAction = useCallback(
    (action: Action) => {
      transport?.send({ t: 'action', action });
    },
    [transport],
  );

  if (!state) return <Lobby onJoin={onJoin} />;
  return <Match onAction={onAction} />;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
