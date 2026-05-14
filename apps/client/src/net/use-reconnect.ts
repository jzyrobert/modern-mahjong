import { type MutableRefObject, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { JoinInfo } from './join-info';

interface UseReconnectOnForegroundArgs {
  reconnectInfoRef: MutableRefObject<JoinInfo | null>;
  joinOnline: (code: string, opts?: { asSpectator?: boolean }) => void;
  joinLan: (hostUrl: string, code: string) => void;
}

/**
 * Listens for `AppState` inactive/background → active transitions and
 * re-joins the last online or LAN match.
 *
 * We don't proactively close the socket on background — short screen
 * locks shouldn't kick the user off their match. On foreground we
 * always rebuild the online/LAN socket because on Android the OS can
 * suspend the underlying WebSocket within seconds of the app being
 * backgrounded WITHOUT firing a `close` event — the socket sits in a
 * zombie `open` state until TCP-level retransmits eventually time out,
 * which the user perceives as the lobby being stuck reconnecting for
 * 20–30 s. The pre-2026-05 logic only rejoined when `transport` was
 * already null (the iOS pattern, where a long-suspended WS does flip
 * to `closed`); the Android zombie window had no such trigger.
 *
 * Forcing a fresh socket on every foreground edge is safe: the
 * caller's `swap` closes the previous transport, the server's
 * 5-minute reconnect grace reseats us by playerId, and
 * `MatchSession.snapshot/restore` round-trips the engine state so the
 * user lands back where they were. Solo has no socket and stays alive
 * across visibility flips by design — the in-process bot loop has no
 * server snapshot to restore.
 */
export function useReconnectOnForeground({
  reconnectInfoRef,
  joinOnline,
  joinLan,
}: UseReconnectOnForegroundArgs): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev.match(/inactive|background/) && next === 'active') {
        const info = reconnectInfoRef.current;
        if (!info || info.kind === 'solo') return;
        if (info.kind === 'online') {
          joinOnline(info.code, info.spectate ? { asSpectator: true } : undefined);
        } else if (info.kind === 'lan') joinLan(info.hostUrl, info.code);
      }
    });
    return () => sub.remove();
  }, [joinOnline, joinLan, reconnectInfoRef]);
}
