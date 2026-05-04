import type { Action } from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
import Constants from 'expo-constants';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getDisplayName, getPlayerId } from '../identity.js';
import { useGame } from '../state/game.js';
import { playDiscard } from '../sound.js';
import { createSoloTransport } from './solo-transport.js';
import {
  type Transport,
  createLanTransport,
  createOnlineTransport,
} from './transport.js';

interface TransportContextValue {
  matchCode: string | null;
  hasTransport: boolean;
  joinOnline: (code: string) => void;
  joinLan: (hostUrl: string, code: string) => void;
  joinSolo: () => void;
  leave: () => void;
  send: (action: Action) => void;
  sendChat: (text: string) => void;
}

const TransportContext = createContext<TransportContextValue | null>(null);

/**
 * Resolve the online-match server URL with this precedence:
 * 1. `expo-constants` `extra.serverUrl` — set via `app.config.ts` or
 *    EAS build profile env override.
 * 2. `EXPO_PUBLIC_SERVER_URL` — runtime env, baked at build time but
 *    overridable via `.env`.
 * 3. Localhost dev default.
 *
 * The legacy `?serverUrl=` query-string override doesn't apply on
 * native (no URL bar). The Playwright multi-player e2e against the web
 * target re-uses it — see `app.config.ts` if/when the spec is migrated
 * to Expo Web.
 */
function resolveServerHost(): string {
  const extra = Constants.expoConfig?.extra as { serverUrl?: string } | undefined;
  if (extra?.serverUrl) return extra.serverUrl;
  if (process.env.EXPO_PUBLIC_SERVER_URL) return process.env.EXPO_PUBLIC_SERVER_URL;
  return 'http://localhost:8787';
}

/**
 * Single source of truth for the live transport. Owns the WebSocket /
 * solo-bot loop, routes inbound `ServerMessage`s into the zustand store,
 * and exposes join / leave / send / sendChat actions to the rest of the
 * app via `useTransport()`.
 *
 * Mounted once in `app/_layout.tsx`. The lobby and match routes consume
 * it via `useTransport()`.
 *
 * **Background lifecycle:** iOS suspends WebSockets within ~30s of the
 * app being backgrounded. When `AppState` flips to `background`,
 * `transport.close()` runs so the server's reconnect-grace timer can
 * restore the seat when we come back. When we flip to `active`, if a
 * matchCode + identity is in scope, we re-create the same transport and
 * re-hello — `MatchSession.snapshot()/restore()` round-trips the engine
 * state so the user lands back where they were.
 */
export function TransportProvider({ children }: { children: ReactNode }) {
  const [transport, setTransport] = useState<Transport | null>(null);
  const [matchCode, setMatchCode] = useState<string | null>(null);
  /** Re-create info captured the last time we joined, so AppState foreground can re-join. */
  const reconnectInfoRef = useRef<
    | { kind: 'online'; code: string }
    | { kind: 'lan'; hostUrl: string; code: string }
    | { kind: 'solo' }
    | null
  >(null);

  const setState = useGame((s) => s.setState);
  const setLobby = useGame((s) => s.setLobby);
  const appendEvents = useGame((s) => s.appendEvents);
  const pushChat = useGame((s) => s.pushChat);
  const reset = useGame((s) => s.reset);

  const swap = useCallback((next: Transport, code: string | null) => {
    setTransport((prev) => {
      prev?.close();
      return next;
    });
    setMatchCode(code);
  }, []);

  const joinOnline = useCallback(
    (code: string) => {
      reconnectInfoRef.current = { kind: 'online', code };
      swap(
        createOnlineTransport({
          host: resolveServerHost(),
          matchCode: code,
          playerId: getPlayerId(),
          displayName: getDisplayName(),
        }),
        code,
      );
    },
    [swap],
  );

  const joinLan = useCallback(
    (hostUrl: string, code: string) => {
      reconnectInfoRef.current = { kind: 'lan', hostUrl, code };
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

  const joinSolo = useCallback(() => {
    reconnectInfoRef.current = { kind: 'solo' };
    swap(
      createSoloTransport({ playerId: getPlayerId(), displayName: getDisplayName() }),
      'SOLO',
    );
  }, [swap]);

  const leave = useCallback(() => {
    transport?.send({ t: 'leave' });
    transport?.close();
    setTransport(null);
    setMatchCode(null);
    reconnectInfoRef.current = null;
    reset();
  }, [transport, reset]);

  const send = useCallback(
    (action: Action) => {
      transport?.send({ t: 'action', action });
    },
    [transport],
  );

  const sendChat = useCallback(
    (text: string) => {
      transport?.send({ t: 'chat', text });
    },
    [transport],
  );

  // Wire inbound messages into the zustand store + side-effects.
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

  // AppState background/foreground lifecycle. When backgrounded, we
  // pre-emptively close the socket so the server's reconnect grace can
  // hold the seat. When foregrounded, if we had a join in flight, we
  // re-create the same transport — the server's snapshot/restore brings
  // the engine state back.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev === 'active' && next.match(/inactive|background/)) {
        transport?.close();
      } else if (prev.match(/inactive|background/) && next === 'active') {
        const info = reconnectInfoRef.current;
        if (info && !transport) {
          // Re-create the same transport. Identity comes from
          // localStorage so playerId is stable across the suspend.
          if (info.kind === 'online') joinOnline(info.code);
          else if (info.kind === 'lan') joinLan(info.hostUrl, info.code);
          else if (info.kind === 'solo') joinSolo();
        }
      }
    });
    return () => sub.remove();
  }, [transport, joinOnline, joinLan, joinSolo]);

  const value = useMemo<TransportContextValue>(
    () => ({
      matchCode,
      hasTransport: transport !== null,
      joinOnline,
      joinLan,
      joinSolo,
      leave,
      send,
      sendChat,
    }),
    [matchCode, transport, joinOnline, joinLan, joinSolo, leave, send, sendChat],
  );

  return <TransportContext.Provider value={value}>{children}</TransportContext.Provider>;
}

/** Read-only access to the transport callbacks + matchCode. Throws if used outside `TransportProvider`. */
export function useTransport(): TransportContextValue {
  const ctx = useContext(TransportContext);
  if (!ctx) {
    throw new Error('useTransport must be used inside <TransportProvider>');
  }
  return ctx;
}
