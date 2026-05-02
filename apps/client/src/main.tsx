import type { Action } from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
import { MotionConfig } from 'framer-motion';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getDisplayName, getPlayerId } from './identity.js';
import { initNativeIfAvailable } from './native/init.js';
import { createSoloTransport } from './net/solo-transport.js';
import { type Transport, createLanTransport, createOnlineTransport } from './net/transport.js';
import { useGame } from './state/game.js';
import { DiceCeremony } from './ui/DiceCeremony.js';
import { Lobby } from './ui/Lobby.js';
import { Match } from './ui/Match.js';
import { ShuffleOverlay } from './ui/ShuffleOverlay.js';

function App() {
  const [transport, setTransport] = useState<Transport | null>(null);
  const setState = useGame((s) => s.setState);
  const setLobby = useGame((s) => s.setLobby);
  const state = useGame((s) => s.state);

  const swap = useCallback((next: Transport) => {
    setTransport((prev) => {
      prev?.close();
      return next;
    });
  }, []);

  const onJoinOnline = useCallback(
    (matchCode: string) => {
      swap(
        createOnlineTransport({
          host: import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8787',
          matchCode,
          playerId: getPlayerId(),
          displayName: getDisplayName(),
        }),
      );
    },
    [swap],
  );

  const onJoinLan = useCallback(
    (hostUrl: string, matchCode: string) => {
      swap(
        createLanTransport({
          hostUrl,
          matchCode,
          playerId: getPlayerId(),
          displayName: getDisplayName(),
        }),
      );
    },
    [swap],
  );

  const onJoinSolo = useCallback(() => {
    swap(createSoloTransport({ playerId: getPlayerId(), displayName: getDisplayName() }));
  }, [swap]);

  useEffect(() => {
    if (!transport) return;
    return transport.onMessage((m: ServerMessage) => {
      switch (m.t) {
        case 'state':
          setState(m.state, m.you);
          return;
        case 'delta':
          setState(m.state);
          return;
        case 'lobby':
          setLobby(m);
          return;
        case 'error':
          console.warn('server error:', m.code, m.detail);
          return;
        case 'pong':
          return;
      }
    });
  }, [transport, setState, setLobby]);

  const onAction = useCallback(
    (action: Action) => {
      transport?.send({ t: 'action', action });
    },
    [transport],
  );

  return (
    <>
      {!state ? (
        <Lobby onJoinOnline={onJoinOnline} onJoinLan={onJoinLan} onJoinSolo={onJoinSolo} />
      ) : (
        <Match onAction={onAction} />
      )}
      <ShuffleOverlay />
      <DiceCeremony />
    </>
  );
}

const root = document.getElementById('root');
if (root) {
  void initNativeIfAvailable();
  createRoot(root).render(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </StrictMode>,
  );
}
