import type { Action, Seat } from '@mahjong/game-logic';
import { emptyState, soloRulesFrom, startHand } from '@mahjong/game-logic';
import type { BotKind, ListLobbiesResponse } from '@mahjong/protocol';
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
import { AppState } from 'react-native';
import { getDisplayName, getPlayerId } from '../identity';
import { stop as lanStop, unadvertise as lanUnadvertise } from '../native/lan-server';
import { useRecorder } from '../replay/recorder';
import { useGame } from '../state/game';
import { type SoloSnapshot, clearSoloSnapshot } from '../state/solo-persist';
import { LESSONS, useTutorial } from '../state/tutorial';
import type { JoinInfo } from './join-info';
import { getActiveLanHostBridge, stopLanHostBridge } from './lan-host-bridge';
import { resolveServerHost } from './server-host';
import { type SoloTransportControls, createSoloTransport } from './solo-transport';
import {
  type Transport,
  type TransportStatus,
  createLanTransport,
  createOnlineTransport,
  fetchLobbyList,
} from './transport';
import { useReconnectOnForeground } from './use-reconnect';
import { useWireRouter } from './use-wire-router';

interface TransportContextValue {
  matchCode: string | null;
  hasTransport: boolean;
  /** 'idle' before any join, otherwise the underlying transport's status. */
  status: 'idle' | TransportStatus;
  /** Resolved server host string for the most recent online join, for diagnostics. */
  resolvedHost: string;
  /** Last successful join descriptor — null before any join + after `leave`. */
  joinInfo: JoinInfo | null;
  /**
   * Join an online match. Pass `{ asSpectator: true }` to force the
   * server into spectator mode even when seats are open — drives the
   * lobby-browser "Watch" path.
   */
  joinOnline: (code: string, opts?: { asSpectator?: boolean }) => void;
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
  /** Fetch the public lobby list from the configured online server.
   *  Returns null on any error (offline, server doesn't support it,
   *  parse failure). The lobby-browser modal calls this on open + on
   *  manual refresh. */
  fetchOpenLobbies: () => Promise<ListLobbiesResponse | null>;
}

const TransportContext = createContext<TransportContextValue | null>(null);

const CLAIM_RACE_WINDOW_MS = 5_000;

/**
 * Single source of truth for the live transport. Owns the WebSocket /
 * solo-bot loop and exposes join / leave / send / sendChat actions to
 * the rest of the app via `useTransport()`. Inbound `ServerMessage`
 * routing lives in `useWireRouter` (`./use-wire-router.ts`); the
 * AppState foreground-rejoin listener lives in
 * `useReconnectOnForeground` (`./use-reconnect.ts`).
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

  const reset = useGame((s) => s.reset);
  const recorderFinalizeMatch = useRecorder((s) => s.finalizeMatch);

  // Tracks the wall-clock timestamp of the user's most recent
  // non-pass `declareClaim` action. Used by the wire router's error
  // handler to recognise a server `PHASE` bounce that's racing with a
  // hard-fallback resolution — when it fires within
  // `CLAIM_RACE_WINDOW_MS` of a meaningful claim attempt, the router
  // surfaces a "claim missed" toast so the user knows their click
  // landed too late.
  const lastMeaningfulClaimRef = useRef<number>(0);

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
    (code: string, opts?: { asSpectator?: boolean }) => {
      const spectate = opts?.asSpectator === true;
      recordJoin({ kind: 'online', code, ...(spectate ? { spectate: true } : {}) });
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
          ...(spectate ? { spectate: true } : {}),
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
      // Mirror `joinOnline`: tell the lobby's connection-status line
      // which host we're trying so a failed connection surfaces the
      // actual URL ("Tried http://192.168.1.42:7777") instead of the
      // useless "Tried (no host)" fallback.
      setResolvedHost(hostUrl);
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
      // Tutorials can override the per-lesson faanMin via the
      // optional Lesson.faanMin field — the rob-the-kong lesson
      // raises it so the user's intermediate ron on the peng
      // discard falls below the floor and the engine pre-passes
      // them (their concealed-hand ron is 1 faan, faanMin: 2 gates
      // it out; the rob, with its +1 搶槓 faan, clears).
      const rulesWithLessonFaan =
        typeof lesson.faanMin === 'number'
          ? { ...tutorialRules, faanMin: lesson.faanMin }
          : tutorialRules;
      const baseState = startHand(
        emptyState(rulesWithLessonFaan),
        lesson.seed,
        lesson.dealer,
      ).state;
      const tutorialState = lesson.prepareState ? lesson.prepareState(baseState) : baseState;
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
      const w = globalThis as {
        __MAHJONG_TEST_BOT_SCRIPTS__?: unknown;
        __MAHJONG_TUTORIAL_FORCE_PASS__?: boolean;
      };
      w.__MAHJONG_TEST_BOT_SCRIPTS__ = lesson.botScripts;
      // Force every bot to pass on unscripted claim windows for the
      // duration of the lesson — without this, `passiveBot.pickClaim`
      // flips a coin and will peng/gang/hu if it can. A passive bot
      // holding a pair matching the user's nudged discard (e.g. an
      // honour pair the peng lesson nudges the user to discard) would
      // opportunistically peng mid-walkthrough and silently break the
      // lesson's predicates. Cleared on tutorial teardown below.
      w.__MAHJONG_TUTORIAL_FORCE_PASS__ = true;
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

  const fetchOpenLobbies = useCallback(async () => {
    const host = resolveServerHost();
    return fetchLobbyList(host);
  }, []);

  // Tear down all local transport / match state. Used by both an
  // explicit `leave()` and the HOST_LEFT server message (handled
  // inside `useWireRouter`), which both need to reset the same
  // fields plus reset the engine store.
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
    const w = globalThis as {
      __MAHJONG_TEST_BOT_SCRIPTS__?: unknown;
      __MAHJONG_TUTORIAL_FORCE_PASS__?: boolean | undefined;
    };
    w.__MAHJONG_TEST_BOT_SCRIPTS__ = undefined;
    w.__MAHJONG_TUTORIAL_FORCE_PASS__ = undefined;
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
    // If we're the LAN host (the in-process bridge is wired), tear
    // down the embedded NanoHTTPD server + mDNS advertisement here.
    // Without this, the server keeps running after the host leaves
    // and the next `Host LAN match` either rebinds onto another port
    // (orphaning the old one) or fails with EADDRINUSE on 7777. The
    // bridge check is cheap and only true when this client started a
    // server in `Lobby.tsx`'s `onHostLan`, so it's a no-op for guests
    // and for online/solo matches.
    if (getActiveLanHostBridge() !== null) {
      stopLanHostBridge();
      // Fire-and-forget teardown: both calls are best-effort cleanup,
      // and the next `lanStart` defensively re-runs them anyway
      // (`Lobby.onHostLan`). A native-side error here would only
      // delay the next host attempt by one EADDRINUSE retry, so we
      // log to surface real regressions but don't await/abort.
      lanUnadvertise().catch((err) => console.warn('leave: lanUnadvertise failed', err));
      lanStop().catch((err) => console.warn('leave: lanStop failed', err));
    }
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
  //
  // When the close arrives while the app is already foregrounded — the
  // most common shape of "screen-lock blip" on Android, where the WS
  // close fires *after* the AppState transition has settled — we also
  // proactively re-join here. Without this, the AppState listener sees
  // `transport` still non-null at the moment foreground fires and bails
  // out, then the close lands a tick later but there's no subsequent
  // foreground edge to retrigger it, so the user stays stuck on a dead
  // transport until they manually retry.
  useEffect(() => {
    if (!transport) return;
    return transport.onStatus((s) => {
      setStatus(s);
      if (s !== 'closed') return;
      const info = reconnectInfoRef.current;
      if (!info || info.kind === 'solo') return;
      setTransport(null);
      if (AppState.currentState === 'active') {
        if (info.kind === 'online') {
          joinOnline(info.code, info.spectate ? { asSpectator: true } : undefined);
        } else if (info.kind === 'lan') joinLan(info.hostUrl, info.code);
      }
    });
  }, [transport, joinOnline, joinLan]);

  useWireRouter({
    transport,
    reconnectInfoRef,
    lastMeaningfulClaimRef,
    claimRaceWindowMs: CLAIM_RACE_WINDOW_MS,
    teardown,
  });

  useReconnectOnForeground({ reconnectInfoRef, joinOnline, joinLan });

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
      fetchOpenLobbies,
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
      fetchOpenLobbies,
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
