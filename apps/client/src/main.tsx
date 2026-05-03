import type { Action } from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
import { MotionConfig } from 'framer-motion';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getDisplayName, getPlayerId, hydrateIdentity } from './identity.js';
import { initNativeIfAvailable } from './native/init.js';
import { playDiscard } from './native/sound.js';
import { createSoloTransport } from './net/solo-transport.js';
import { type Transport, createLanTransport, createOnlineTransport } from './net/transport.js';
import { hydrateSettings, useGame } from './state/game.js';
import { DiceCeremony } from './ui/DiceCeremony.js';
import { Lobby } from './ui/Lobby.js';
import { Match } from './ui/Match.js';
import { ShuffleOverlay } from './ui/ShuffleOverlay.js';
import { WinCelebration } from './ui/WinCelebration.js';

function App() {
  const [transport, setTransport] = useState<Transport | null>(null);
  const [matchCode, setMatchCode] = useState<string | null>(null);
  const setState = useGame((s) => s.setState);
  const setLobby = useGame((s) => s.setLobby);
  const appendEvents = useGame((s) => s.appendEvents);
  const pushChat = useGame((s) => s.pushChat);
  const reset = useGame((s) => s.reset);
  const state = useGame((s) => s.state);
  const animationsEnabled = useGame((s) => s.settings.animations);

  const swap = useCallback((next: Transport, code: string | null) => {
    setTransport((prev) => {
      prev?.close();
      return next;
    });
    setMatchCode(code);
  }, []);

  const onJoinOnline = useCallback(
    (code: string) => {
      swap(
        createOnlineTransport({
          host: import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8787',
          matchCode: code,
          playerId: getPlayerId(),
          displayName: getDisplayName(),
        }),
        code,
      );
    },
    [swap],
  );

  const onJoinLan = useCallback(
    (hostUrl: string, code: string) => {
      swap(
        createLanTransport({
          hostUrl,
          matchCode: code,
          playerId: getPlayerId(),
          displayName: getDisplayName(),
        }),
        code,
      );
    },
    [swap],
  );

  const onJoinSolo = useCallback(() => {
    swap(createSoloTransport({ playerId: getPlayerId(), displayName: getDisplayName() }), 'SOLO');
  }, [swap]);

  const onLeave = useCallback(() => {
    transport?.send({ t: 'leave' });
    transport?.close();
    setTransport(null);
    setMatchCode(null);
    reset();
  }, [transport, reset]);

  useEffect(() => {
    if (!transport) return;
    return transport.onMessage((m: ServerMessage) => {
      switch (m.t) {
        case 'state':
          setState(m.state, m.you);
          return;
        case 'delta':
          setState(m.state);
          appendEvents(m.events);
          // Audio feedback — the store gates internally on
          // settings.sound + settings.animations so this is cheap when
          // disabled.
          for (const event of m.events) {
            if (event.t === 'discarded') playDiscard();
          }
          return;
        case 'lobby':
          setLobby(m);
          return;
        case 'error':
          console.warn('server error:', m.code, m.detail);
          return;
        case 'pong':
          return;
        case 'chat':
          pushChat({ from: m.from, text: m.text, ts: m.ts });
          return;
      }
    });
  }, [transport, setState, setLobby, appendEvents, pushChat]);

  const onAction = useCallback(
    (action: Action) => {
      transport?.send({ t: 'action', action });
    },
    [transport],
  );

  const onChat = useCallback(
    (text: string) => {
      transport?.send({ t: 'chat', text });
    },
    [transport],
  );

  // `reducedMotion="user"` honors the OS-level prefers-reduced-motion; when
  // the user explicitly turned animations off in SettingsPanel we force it
  // to `'always'` so motion is suppressed regardless of OS preference.
  const reducedMotion = animationsEnabled ? 'user' : 'always';

  return (
    <MotionConfig reducedMotion={reducedMotion}>
      {!state ? (
        <Lobby onJoinOnline={onJoinOnline} onJoinLan={onJoinLan} onJoinSolo={onJoinSolo} />
      ) : (
        <Match onAction={onAction} onChat={onChat} matchCode={matchCode} onLeave={onLeave} />
      )}
      <ShuffleOverlay />
      <DiceCeremony />
      <WinCelebration />
    </MotionConfig>
  );
}

const root = document.getElementById('root');
if (root) {
  void initNativeIfAvailable();
  // Block first render on identity + settings hydration so the lobby's
  // display-name input and the persisted skin / sort / animations
  // preferences don't flicker from defaults to the actual values when
  // localStorage was wiped but native Preferences still has them.
  Promise.allSettled([hydrateIdentity(), hydrateSettings()]).finally(() => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
