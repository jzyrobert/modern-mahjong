import type { Action, Seat } from '@mahjong/game-logic';
import { emptyState, soloRulesFrom, startHand } from '@mahjong/game-logic';
import type { BotKind, ServerMessage } from '@mahjong/protocol';
import Constants from 'expo-constants';
import { router } from 'expo-router';
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
import { useRecorder } from '../replay/recorder';
import { playDiscard } from '../sound';
import { useGame } from '../state/game';
import { type SoloSnapshot, clearSoloSnapshot, saveSoloSnapshot } from '../state/solo-persist';
import { LESSONS, useTutorial } from '../state/tutorial';
import { type SoloTransportControls, createSoloTransport } from './solo-transport';
import {
  type Transport,
  type TransportStatus,
  createLanTransport,
  createOnlineTransport,
} from './transport';

/**
 * Shape of the reconnect info we capture every time someone joins.
 * Mirrors the runtime ref used by the AppState foreground re-join,
 * but exposed as state through the context so route components can
 * reconstruct the URL (`/match?code=…&host=…` / `?solo=1`) on a
 * reload.
 */
export type JoinInfo =
  | { kind: 'online'; code: string }
  | { kind: 'lan'; hostUrl: string; code: string }
  | { kind: 'solo' };

interface TransportContextValue {
  matchCode: string | null;
  hasTransport: boolean;
  /** 'idle' before any join, otherwise the underlying transport's status. */
  status: 'idle' | TransportStatus;
  /** Resolved server host string for the most recent online join, for diagnostics. */
  resolvedHost: string;
  /** Last successful join descriptor — null before any join + after `leave`. */
  joinInfo: JoinInfo | null;
  joinOnline: (code: string) => void;
  joinLan: (hostUrl: string, code: string) => void;
  joinSolo: () => void;
  /** Tutorial entry point. Forces all bots to `passive`, seeds the
   *  engine to a deterministic wall via `lesson.seed` + `lesson.dealer`,
   *  and kicks the lesson controller into step 0 so the welcome
   *  overlay surfaces as soon as `<Match>` mounts. */
  joinSoloTutorial: (lessonId: string) => void;
  /** Reload-survival entry point: seed a fresh solo transport with the
   *  persisted engine snapshot read from `mj.activeMatch.solo.v1`.
   *  See `apps/client/app/match.tsx`. */
  joinSoloResume: (snap: SoloSnapshot) => void;
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
  /** Re-create info captured the last time we joined, exposed via the
   *  context so route components can rebuild the URL on reload. The
   *  parallel ref mirrors the same value for callbacks that need the
   *  latest value without the extra re-render churn of treating it as
   *  a useCallback dep (AppState foreground listener, status close
   *  handler). */
  const [joinInfo, setJoinInfo] = useState<JoinInfo | null>(null);
  const reconnectInfoRef = useRef<JoinInfo | null>(null);

  const setState = useGame((s) => s.setState);
  const setLobby = useGame((s) => s.setLobby);
  const appendEvents = useGame((s) => s.appendEvents);
  const pushChat = useGame((s) => s.pushChat);
  const flashClaimMissed = useGame((s) => s.flashClaimMissed);
  const reset = useGame((s) => s.reset);
  const recorderStartMatch = useRecorder((s) => s.startMatch);
  const recorderOnDelta = useRecorder((s) => s.onDelta);
  const recorderOnState = useRecorder((s) => s.onState);
  const recorderOnLobby = useRecorder((s) => s.onLobby);
  const recorderFinalizeMatch = useRecorder((s) => s.finalizeMatch);

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

  // Mirror the join descriptor into the React state (for URL
  // reconstruction on reload) and the parallel ref (for callbacks that
  // need the latest value without a useCallback dep churn).
  const recordJoin = useCallback((info: JoinInfo) => {
    reconnectInfoRef.current = info;
    setJoinInfo(info);
  }, []);

  const joinOnline = useCallback(
    (code: string) => {
      recordJoin({ kind: 'online', code });
      // Switching transports invalidates any prior solo snapshot — the
      // engine state about to arrive belongs to a different match.
      clearSoloSnapshot();
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
    [swap, recordJoin],
  );

  const joinLan = useCallback(
    (hostUrl: string, code: string) => {
      recordJoin({ kind: 'lan', hostUrl, code });
      clearSoloSnapshot();
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
    [swap, recordJoin],
  );

  const joinSolo = useCallback(() => {
    recordJoin({ kind: 'solo' });
    // Fresh solo launch wipes any stale snapshot from a previous run —
    // the new transport will overwrite it on its first `setState` /
    // `setLobby`, but clearing first guarantees a hard reload between
    // `joinSolo()` and the first emit lands on the lobby, not the
    // previous match's mid-hand state.
    clearSoloSnapshot();
    const skills = useGame.getState().settings.botSkills;
    swap(
      createSoloTransport({
        playerId: getPlayerId(),
        displayName: getDisplayName(),
        botSkills: skills,
      }),
      'SOLO',
    );
  }, [swap, recordJoin]);

  const joinSoloTutorial = useCallback(
    (lessonId: string) => {
      const lesson = LESSONS[lessonId];
      if (!lesson) {
        console.warn(`joinSoloTutorial: unknown lesson "${lessonId}"`);
        return;
      }
      recordJoin({ kind: 'solo' });
      clearSoloSnapshot();
      // Pre-build the engine state at the lesson's deterministic seed
      // so the wall is identical every run. `seedState` lands the
      // transport straight in `phase: 'turn'`, skipping the dice
      // ceremony + lobby waiting room — without it the user would
      // have to tap "Start match" themselves before the welcome
      // overlay made any sense. `soloRulesFrom()` strips the claim
      // fairness windows so user discards don't park awaiting a
      // soft floor that no other human is waiting on. We additionally
      // zero `turnTimeoutMs` for the lesson — a confused new player
      // shouldn't get yanked off their tile pick after 20 s while
      // they read the caption.
      // Tutorials run with `faanMin: 0` so basic winning shapes
      // qualify — lessons are pedagogical, not balanced ruleset
      // play. The default rule (3 faan) would reject most simple
      // winning hands the lesson scripts can produce.
      const tutorialRules = {
        ...soloRulesFrom(),
        turnTimeoutMs: 0,
        faanMin: 0 as const,
      };
      const tutorialState = startHand(emptyState(tutorialRules), lesson.seed, lesson.dealer).state;
      // Force every bot to `passive` for the duration of the lesson —
      // a heuristic bot might claim or self-draw mid-walkthrough,
      // which would invalidate the script's predicates. The user's
      // `settings.botSkills` is left untouched so leaving the tutorial
      // returns them to their preferred mix.
      //
      // Layer per-seat scripted moves on top via the existing
      // `__MAHJONG_TEST_BOT_SCRIPTS__` global, which `solo-transport`
      // already consumes inside `withTestScript`. Lessons define
      // these to engineer specific scenarios (e.g. bot 3 discards
      // a specific face so the user gets a chi opportunity); empty
      // scripts make the global a no-op. The teardown path clears
      // the global so a regular post-lesson solo match doesn't
      // inherit the tutorial's scripts.
      const w = globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: unknown };
      w.__MAHJONG_TEST_BOT_SCRIPTS__ = lesson.botScripts;
      swap(
        createSoloTransport({
          playerId: getPlayerId(),
          displayName: getDisplayName(),
          botSkills: ['passive', 'passive', 'passive'],
          seedState: tutorialState,
        }),
        'SOLO',
      );
      useTutorial.getState().begin(lessonId);
    },
    [swap, recordJoin],
  );

  const joinSoloResume = useCallback(
    (snap: SoloSnapshot) => {
      recordJoin({ kind: 'solo' });
      // Hydrate the zustand store BEFORE creating the transport so the
      // first render after route mount already has the engine + lobby
      // wired up. Without this, the brief gap between transport creation
      // and the deferred `setTimeout(() => emit(state), 0)` flashes the
      // "stranded" recovery screen.
      useGame.getState().setState(snap.state, snap.you);
      useGame.getState().setLobby(snap.lobby);
      const skills = useGame.getState().settings.botSkills;
      swap(
        createSoloTransport({
          playerId: getPlayerId(),
          displayName: getDisplayName(),
          botSkills: skills,
          seedState: snap.state,
        }),
        'SOLO',
      );
    },
    [swap, recordJoin],
  );

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

  // Tear down all local transport / match state. Used by both an
  // explicit `leave()` and the HOST_LEFT server message, which both
  // need to reset the same fields plus reset the engine store.
  const teardown = useCallback(() => {
    // Persist the in-memory replay draft (auto or explicit) before the
    // store gets cleared. Reads the live settings off the zustand
    // store so teardowns triggered by HOST_LEFT respect the user's
    // current toggles even if they flipped them mid-match.
    const settings = useGame.getState().settings;
    recorderFinalizeMatch(settings.autoRecordReplays, settings.replayQuota);
    // Tear down any in-flight tutorial too — leaving the match
    // mid-lesson should drop the lesson, same as the Skip button.
    useTutorial.getState().dismiss();
    // Clear any lesson-installed bot scripts unconditionally on
    // match teardown, so a follow-up regular solo match doesn't
    // inherit them (e.g. bot 3 stuck pre-discarding a specific
    // tile). Existing e2e specs that set scripts via page.evaluate
    // do so per-test and never trigger teardown mid-test, so this
    // is safe to wipe.
    const w = globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: unknown };
    w.__MAHJONG_TEST_BOT_SCRIPTS__ = undefined;
    setTransport(null);
    setMatchCode(null);
    setStatus('idle');
    reconnectInfoRef.current = null;
    setJoinInfo(null);
    reset();
  }, [reset, recorderFinalizeMatch]);

  const leave = useCallback(() => {
    transport?.send({ t: 'leave' });
    transport?.close();
    clearSoloSnapshot();
    teardown();
  }, [transport, teardown]);

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

  // Mirror the live solo engine to localStorage so a reload of
  // `/match?solo=1` can rebuild the bot loop from the persisted
  // snapshot — see `apps/client/src/state/solo-persist.ts` and
  // `apps/client/app/match.tsx`. Online + LAN have their own
  // server-side rebind (PR #211 + the `joinOnline`/`joinLan`
  // recovery in `match.tsx`), so they skip this entirely.
  const persistSoloIfActive = useCallback(() => {
    if (reconnectInfoRef.current?.kind !== 'solo') return;
    const { state, lobby, you } = useGame.getState();
    if (state === null || lobby === null || you === null) return;
    saveSoloSnapshot({ state, lobby, you });
  }, []);

  // Wire inbound messages into the zustand store + side-effects.
  useEffect(() => {
    if (!transport) return;
    // Track whether the recorder draft has been started for this transport
    // session. The first `state` message begins the draft; subsequent
    // `state` messages (reconnect) update the latest frame instead.
    let recorderStarted = false;
    return transport.onMessage((m: ServerMessage) => {
      // Any inbound that mutates engine / lobby state needs to flow back
      // into the solo snapshot so a reload of `/match?solo=1` rebuilds
      // from up-to-date data. Online + LAN are no-ops in
      // `persistSoloIfActive` (it gates on `kind === 'solo'`).
      const isStateUpdate = m.t === 'state' || m.t === 'delta' || m.t === 'lobby';
      switch (m.t) {
        case 'state': {
          setState(m.state, m.you);
          const join = reconnectInfoRef.current;
          // Tutorial sessions don't tee into the replay library —
          // saving them would pollute the user's saved-matches list
          // with throwaway lesson runs. Auto-record stays honoured
          // for ordinary solo matches.
          if (useTutorial.getState().active !== null) break;
          if (join && !recorderStarted) {
            recorderStartMatch({
              state: m.state,
              you: m.you,
              matchCode: join.kind === 'solo' ? 'SOLO' : join.code,
              joinKind: join.kind,
              rules: m.state.rules,
            });
            recorderStarted = true;
          } else if (recorderStarted) {
            recorderOnState(m.state);
          }
          break;
        }
        case 'delta':
          setState(m.state);
          appendEvents(m.events);
          recorderOnDelta(m.events, m.state);
          for (const event of m.events) {
            if (event.t === 'discarded') playDiscard();
          }
          break;
        case 'lobby':
          setLobby(m);
          recorderOnLobby(m);
          break;
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
          // Host explicitly left an online/LAN match with no other
          // humans present, so the server dissolved the room and
          // closed every remaining socket. Mirror the leaver's tear-
          // down on the guests' side: drop the transport, clear the
          // engine state, and bounce back to the lobby instead of
          // landing on `Match.tsx`'s "No active match" stranded
          // screen.
          if (m.code === 'HOST_LEFT') {
            transport?.close();
            teardown();
            router.replace('/');
          }
          return;
        }
        case 'pong':
          return;
        case 'chat':
          pushChat({ from: m.from, text: m.text, ts: m.ts });
          return;
      }
      if (isStateUpdate) persistSoloIfActive();
    });
  }, [
    transport,
    setState,
    setLobby,
    appendEvents,
    pushChat,
    flashClaimMissed,
    teardown,
    persistSoloIfActive,
    recorderStartMatch,
    recorderOnState,
    recorderOnDelta,
    recorderOnLobby,
  ]);

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
      joinInfo,
      joinOnline,
      joinLan,
      joinSolo,
      joinSoloTutorial,
      joinSoloResume,
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
      joinInfo,
      joinOnline,
      joinLan,
      joinSolo,
      joinSoloTutorial,
      joinSoloResume,
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
