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
import { getDisplayName, getPlayerId } from '../identity';
import { playDiscard } from '../sound';
import { useGame } from '../state/game';
import { createSoloTransport } from './solo-transport';
import {
  type Transport,
  type TransportStatus,
  createLanTransport,
  createOnlineTransport,
} from './transport';

interface TransportContextValue {
  matchCode: string | null;
  hasTransport: boolean;
  /** 'idle' before any join, otherwise the underlying transport's status. */
  status: 'idle' | TransportStatus;
  /** Resolved server host string for the most recent online join, for diagnostics. */
  resolvedHost: string;
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
 * 1. **Web only** — `?serverUrl=…` query string. Used by the
 *    Playwright multi-player e2e (`apps/client/e2e/online-multi-
 *    player.spec.ts`) to point the browser at an in-process test
 *    server. Native has no URL bar so this is a no-op there.
 * 2. `expo-constants` `extra.serverUrl` — set via `app.config.ts` or
 *    EAS build profile env override.
 * 3. `EXPO_PUBLIC_SERVER_URL` — runtime env, baked at build time but
 *    overridable via `.env`.
 * 4. Dev fallback: derive the host from Expo's dev-server `hostUri`
 *    (LAN IP, e.g. `192.168.1.5:8081` → `http://192.168.1.5:8787`).
 *    Reaches the dev wrangler server from both Android emulator and
 *    a physical device on the same network, as long as wrangler is
 *    bound to `0.0.0.0` (see `apps/server/package.json`'s `dev` script).
 * 5. Last-resort `http://localhost:8787` — only useful in iOS simulator
 *    or with `adb reverse tcp:8787 tcp:8787` configured.
 */
function resolveServerHost(): string {
  if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
    const fromQuery = new URLSearchParams(window.location.search).get('serverUrl');
    if (fromQuery) return fromQuery;
  }
  const extra = Constants.expoConfig?.extra as { serverUrl?: string } | undefined;
  if (extra?.serverUrl) return extra.serverUrl;
  if (process.env.EXPO_PUBLIC_SERVER_URL) return process.env.EXPO_PUBLIC_SERVER_URL;
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:8787`;
    }
  }
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
  const [status, setStatus] = useState<'idle' | TransportStatus>('idle');
  const [resolvedHost, setResolvedHost] = useState<string>('');
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
    setStatus(next.status());
  }, []);

  const joinOnline = useCallback(
    (code: string) => {
      reconnectInfoRef.current = { kind: 'online', code };
      const host = resolveServerHost();
      setResolvedHost(host);
      swap(
        createOnlineTransport({
          host,
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
    swap(createSoloTransport({ playerId: getPlayerId(), displayName: getDisplayName() }), 'SOLO');
  }, [swap]);

  const leave = useCallback(() => {
    transport?.send({ t: 'leave' });
    transport?.close();
    setTransport(null);
    setMatchCode(null);
    setStatus('idle');
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

  // Track the active transport's connection status so the lobby can
  // surface "Connecting…" / "Couldn't reach server" feedback. Without
  // this, a failed online join just looks like an unresponsive button.
  useEffect(() => {
    if (!transport) return;
    return transport.onStatus(setStatus);
  }, [transport]);

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

  // AppState background/foreground lifecycle. For socket-backed
  // transports (online + LAN), pre-emptively close on background so
  // the server's reconnect grace can hold the seat, and re-create on
  // foreground — the server's snapshot/restore brings the engine
  // state back.
  //
  // For solo, deliberately keep the transport alive across
  // background/foreground. There's no socket to suspend (the bot
  // loop is in-process), and there's no server to restore from —
  // closing would tear down the message listeners + the claim alarm,
  // and the foreground branch's `joinSolo()` would then spin up a
  // FRESH `emptyState` match, dumping the user back into "Waiting
  // for the game to start…" with their in-progress hand gone. This
  // is the bug behind "screen off then on → can't take any actions
  // in a no-turn-timer solo game."
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev === 'active' && next.match(/inactive|background/)) {
        if (reconnectInfoRef.current?.kind !== 'solo') {
          transport?.close();
        }
      } else if (prev.match(/inactive|background/) && next === 'active') {
        const info = reconnectInfoRef.current;
        if (info && !transport) {
          // Re-create the same transport. Identity comes from
          // localStorage so playerId is stable across the suspend.
          // Solo never reaches here: we don't close it on
          // background, so `transport` is still set.
          if (info.kind === 'online') joinOnline(info.code);
          else if (info.kind === 'lan') joinLan(info.hostUrl, info.code);
        }
      }
    });
    return () => sub.remove();
  }, [transport, joinOnline, joinLan]);

  const value = useMemo<TransportContextValue>(
    () => ({
      matchCode,
      hasTransport: transport !== null,
      status,
      resolvedHost,
      joinOnline,
      joinLan,
      joinSolo,
      leave,
      send,
      sendChat,
    }),
    [
      matchCode,
      transport,
      status,
      resolvedHost,
      joinOnline,
      joinLan,
      joinSolo,
      leave,
      send,
      sendChat,
    ],
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
