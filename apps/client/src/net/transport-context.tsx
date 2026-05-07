import type { Action, Seat } from '@mahjong/game-logic';
import type { BotKind, ServerMessage } from '@mahjong/protocol';
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
import { type SoloTransportControls, createSoloTransport } from './solo-transport';
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
  /** Solo: live-update + persist `settings.botSkills`. Online/LAN: send to host. */
  seatBot: (seat: Seat, kind: BotKind) => void;
  /** No-op for solo (the user always holds seat 0). Online/LAN: send to host. */
  unseatBot: (seat: Seat) => void;
}

const TransportContext = createContext<TransportContextValue | null>(null);

/**
 * Resolve the online-match server URL with this precedence:
 * 1. **Web only** — `?serverUrl=…` query string. Used by the
 *    Playwright multi-player e2e (`apps/client/e2e/online-multi-
 *    player.spec.ts`) to point the browser at an in-process test
 *    server. Native has no URL bar so this is a no-op there.
 * 2. `EXPO_PUBLIC_SERVER_URL` — runtime env, baked at build time but
 *    overridable via `.env`. CI sets this from a GitHub secret;
 *    local dev can override per-shell. Wins over the static
 *    `extra.serverUrl` so staging / preview deploys can target a
 *    different Worker without forking `app.json`.
 * 3. Dev fallback: derive the host from Expo's dev-server `hostUri`
 *    (LAN IP, e.g. `192.168.1.5:8081` → `http://192.168.1.5:8787`).
 *    Reaches the dev wrangler server from both Android emulator and
 *    a physical device on the same network, as long as wrangler is
 *    bound to `0.0.0.0` (see `apps/server/package.json`'s `dev` script).
 * 4. `expo-constants` `extra.serverUrl` — canonical production
 *    Worker URL baked into `app.json`. Acts as a safety net when
 *    `EXPO_PUBLIC_SERVER_URL` ends up unset / misconfigured (e.g.
 *    secret pointing at the Pages URL by mistake), and as the
 *    default for native release builds where neither env nor
 *    hostUri is available.
 * 5. Last-resort `http://localhost:8787` — only useful in iOS simulator
 *    or with `adb reverse tcp:8787 tcp:8787` configured.
 */
function resolveServerHost(): string {
  if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
    const fromQuery = new URLSearchParams(window.location.search).get('serverUrl');
    if (fromQuery) return fromQuery;
  }
  if (process.env.EXPO_PUBLIC_SERVER_URL) return process.env.EXPO_PUBLIC_SERVER_URL;
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:8787`;
    }
  }
  const extra = Constants.expoConfig?.extra as { serverUrl?: string } | undefined;
  if (extra?.serverUrl) return extra.serverUrl;
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
 * app being backgrounded. We don't proactively close on background —
 * short screen locks should leave the socket alive — but a `closed`
 * status flip from a long-suspended socket nulls the transport, and
 * the AppState foreground handler then re-creates it. `MatchSession.
 * snapshot()/restore()` round-trips the engine state so the user lands
 * back where they were.
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
  const flashClaimMissed = useGame((s) => s.flashClaimMissed);
  const reset = useGame((s) => s.reset);

  // Tracks the wall-clock timestamp of the user's most recent
  // non-pass `declareClaim` action. Used by the error handler to
  // recognise a server `PHASE` bounce that's racing with a hard-
  // fallback resolution — when it fires within `CLAIM_RACE_WINDOW_MS`
  // of a meaningful claim attempt, we surface a "claim missed" toast
  // so the user knows their click landed too late (rather than just
  // appearing as a silent failure).
  const lastMeaningfulClaimRef = useRef<number>(0);
  const CLAIM_RACE_WINDOW_MS = 5_000;

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
    const skills = useGame.getState().settings.botSkills;
    swap(
      createSoloTransport({
        playerId: getPlayerId(),
        displayName: getDisplayName(),
        botSkills: skills,
      }),
      'SOLO',
    );
  }, [swap]);

  const seatBot = useCallback(
    (seat: Seat, kind: BotKind) => {
      if (reconnectInfoRef.current?.kind === 'solo' && seat >= 1 && seat <= 3) {
        const solo = transport as (Transport & Partial<SoloTransportControls>) | null;
        solo?.setBotSkill?.(seat as 1 | 2 | 3, kind);
        const cur = useGame.getState().settings.botSkills;
        const next: [BotKind, BotKind, BotKind] = [...cur];
        next[seat - 1] = kind;
        useGame.getState().setSettings({ botSkills: next });
        return;
      }
      transport?.send({ t: 'seatBot', seat, kind });
    },
    [transport],
  );

  const unseatBot = useCallback(
    (seat: Seat) => {
      if (reconnectInfoRef.current?.kind === 'solo') return;
      transport?.send({ t: 'unseatBot', seat });
    },
    [transport],
  );

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
      if (action.t === 'declareClaim' && action.claim.kind !== 'pass') {
        lastMeaningfulClaimRef.current = Date.now();
      }
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

  // Surface "Connecting…" / "Couldn't reach server" feedback to the
  // lobby. On an online/LAN `closed` flip, also null the transport so
  // the AppState foreground handler (or a user retry) can rejoin via
  // the server's reconnect-grace window. Solo never closes unexpectedly.
  useEffect(() => {
    if (!transport) return;
    return transport.onStatus((s) => {
      setStatus(s);
      if (s !== 'closed') return;
      const info = reconnectInfoRef.current;
      if (!info || info.kind === 'solo') return;
      setTransport(null);
    });
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
        case 'error': {
          console.warn('server error:', m.code, m.detail);
          // Flash a "claim missed" toast when a `PHASE` error follows
          // a recent meaningful claim — that's the hard-fallback race
          // case (server resolved the round before our action arrived).
          // Other PHASE errors are out-of-turn discards / malformed
          // input; the cooldown ref keeps those silent.
          if (m.code === 'PHASE') {
            const elapsed = Date.now() - lastMeaningfulClaimRef.current;
            if (lastMeaningfulClaimRef.current > 0 && elapsed < CLAIM_RACE_WINDOW_MS) {
              flashClaimMissed();
              lastMeaningfulClaimRef.current = 0;
            }
          }
          return;
        }
        case 'pong':
          return;
        case 'chat':
          pushChat({ from: m.from, text: m.text, ts: m.ts });
          return;
      }
    });
  }, [transport, setState, setLobby, appendEvents, pushChat, flashClaimMissed]);

  // AppState foreground re-join. We don't proactively close the socket
  // on background — short screen locks shouldn't kick the user off
  // their match, and iOS suspending a long-backgrounded WS surfaces
  // as a `closed` flip the onStatus effect above already handles.
  // On foreground, if the transport was nulled (closed mid-background),
  // rejoin so the server reseats us by playerId within the reconnect
  // grace. Solo stays alive across visibility flips by design — the
  // in-process bot loop has no socket and no server snapshot to restore.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev.match(/inactive|background/) && next === 'active') {
        const info = reconnectInfoRef.current;
        if (info && info.kind !== 'solo' && !transport) {
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
      seatBot,
      unseatBot,
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
      seatBot,
      unseatBot,
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
