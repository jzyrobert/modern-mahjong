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

  // Track the active transport's connection status so the lobby can
  // surface "Connecting…" / "Couldn't reach server" feedback. When an
  // online / LAN socket flips to `closed` unexpectedly (OS suspending
  // the ws after a long background, a network blip, a server restart),
  // null the transport so the AppState foreground handler — and any
  // explicit user retry — can rejoin via `findOrAssignSeat`'s
  // playerId-match branch within the server's reconnect grace.
  // Skipped for solo (the in-process loop never closes unexpectedly)
  // and after `leave()` (which clears `reconnectInfoRef.current`).
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
      // Backgrounding: don't proactively close the socket. A short
      // screen lock (a few seconds — checking notifications, glancing
      // at the time) shouldn't kick the user off their match. iOS
      // will suspend long-backgrounded WebSockets on its own; that
      // surfaces as a `closed` status, which the onStatus effect
      // above nulls the transport on. A foreground re-tick then
      // re-joins via `findOrAssignSeat`'s playerId-match branch.
      // The previous behaviour (proactive close + null on every
      // background) generated a server-visible disconnect on every
      // brief lock, exhausting the seat's reconnect grace if the
      // user toggled visibility a few times in quick succession.
      if (prev.match(/inactive|background/) && next === 'active') {
        const info = reconnectInfoRef.current;
        if (info && info.kind !== 'solo' && !transport) {
          // Identity comes from localStorage so playerId is stable
          // across the suspend; the server reseats us by playerId
          // within the reconnect-grace window (default 60s).
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
