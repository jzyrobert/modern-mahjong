import type { ServerMessage } from '@mahjong/protocol';
import { router } from 'expo-router';
import { type MutableRefObject, useEffect } from 'react';
import { useRecorder } from '../replay/recorder';
import { playDiceRoll, playTileClick } from '../sound';
import { useGame } from '../state/game';
import { saveSoloSnapshot } from '../state/solo-persist';
import { useTutorial } from '../state/tutorial';
import { type JoinInfo, matchCodeFor } from './join-info';
import type { Transport } from './transport';

interface UseWireRouterArgs {
  /** Live transport — the hook subscribes to its inbound stream on
   *  every change. `null` is a no-op (no subscription wired). */
  transport: Transport | null;
  /** Latest-value ref for the active join descriptor. The hook reads
   *  this on every inbound message to know whether the active match
   *  is solo (for the snapshot mirror) and to stamp the recorder
   *  header. Mirrors the state field of the same name. */
  reconnectInfoRef: MutableRefObject<JoinInfo | null>;
  /** Latest-value ref for the wall-clock timestamp of the most recent
   *  meaningful (non-pass) `declareClaim` action. Read by the `PHASE`
   *  error handler to decide whether to flash a "claim missed" toast
   *  — see the `send` callback in `transport-context.tsx`. */
  lastMeaningfulClaimRef: MutableRefObject<number>;
  /** Cutoff window beyond which a `PHASE` error is no longer treated
   *  as a claim-window race. Passed in so the constant stays
   *  co-located with the producer-side bookkeeping. */
  claimRaceWindowMs: number;
  /** Match teardown — invoked on a server `HOST_LEFT` so guests bounce
   *  back to the lobby instead of stranding on the match route. */
  teardown: () => void;
}

/**
 * Subscribes to the active transport's inbound `ServerMessage` stream
 * and fans each message out to the relevant zustand stores + side-
 * effects (recorder draft, sound cues, draw flash, claim-race state,
 * solo snapshot mirror, HOST_LEFT route bounce).
 *
 * Extracted from the inline `useEffect` in `TransportProvider` so the
 * routing logic is testable in isolation and so the provider itself
 * stays focused on connection lifecycle.
 */
export function useWireRouter({
  transport,
  reconnectInfoRef,
  lastMeaningfulClaimRef,
  claimRaceWindowMs,
  teardown,
}: UseWireRouterArgs): void {
  const setState = useGame((s) => s.setState);
  const setLobby = useGame((s) => s.setLobby);
  const appendEvents = useGame((s) => s.appendEvents);
  const pushChat = useGame((s) => s.pushChat);
  const flashClaimMissed = useGame((s) => s.flashClaimMissed);
  const flashClaimAnnouncement = useGame((s) => s.flashClaimAnnouncement);
  const flashDrawAnimation = useGame((s) => s.flashDrawAnimation);
  const recorderStartMatch = useRecorder((s) => s.startMatch);
  const recorderOnDelta = useRecorder((s) => s.onDelta);
  const recorderOnState = useRecorder((s) => s.onState);
  const recorderOnLobby = useRecorder((s) => s.onLobby);

  useEffect(() => {
    if (!transport) return;
    // Track whether the recorder draft has been started for this transport
    // session. The first `state` message begins the draft; subsequent
    // `state` messages (reconnect) update the latest frame instead.
    //
    // Seed from the existing draft so a transport swap mid-match (e.g.,
    // AppState foreground rejoin re-establishing the socket) keeps
    // appending to the same draft rather than wiping it with a fresh
    // `startMatch` — that bug left online recordings starting from the
    // reconnect point with all pre-background frames gone. We only treat
    // the draft as continuing this transport when it's for the same
    // match; an explicit join to a different code falls through to
    // `startMatch`, which replaces the stale draft.
    const draftAtMount = useRecorder.getState().draft;
    const joinAtMount = reconnectInfoRef.current;
    let recorderStarted =
      draftAtMount !== null &&
      joinAtMount !== null &&
      draftAtMount.header.matchCode === matchCodeFor(joinAtMount) &&
      draftAtMount.header.joinKind === joinAtMount.kind;
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
              matchCode: matchCodeFor(join),
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
            if (event.t === 'discarded') playTileClick();
            else if (event.t === 'opened') playDiceRoll();
            else if (event.t === 'drew') {
              // Trigger the local user's draw popup + flip animation
              // (DrawTileOverlay reads `useGame.drawAnimation`). Skip
              // for spectators (no own seat) and for bot draws — they
              // shouldn't get a face-down popup the user doesn't see
              // the tile of.
              const you = useGame.getState().you;
              if (typeof you === 'number' && event.seat === you) {
                flashDrawAnimation(event.tile);
              }
            } else if (event.t === 'claimsResolved' && event.result.kind === 'win') {
              // Only the meld-completing claims (chi/peng/gang) clack
              // a tile face-up. `hu` is handled separately if/when a
              // win-sting cue gets added.
              const kind = event.result.claim.kind;
              if (kind === 'chi' || kind === 'peng' || kind === 'gang') {
                playTileClick();
                flashClaimAnnouncement({ seat: event.result.seat, kind });
              }
            } else if (event.t === 'gangDeclared') {
              // Concealed / promoted gangs don't flow through
              // `claimsResolved` but still flip tiles into a meld.
              playTileClick();
            }
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
            if (lastMeaningfulClaimRef.current > 0 && elapsed < claimRaceWindowMs) {
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
      if (isStateUpdate) persistSoloIfActive(reconnectInfoRef.current);
    });
  }, [
    transport,
    setState,
    setLobby,
    appendEvents,
    pushChat,
    flashClaimMissed,
    flashClaimAnnouncement,
    flashDrawAnimation,
    teardown,
    recorderStartMatch,
    recorderOnState,
    recorderOnDelta,
    recorderOnLobby,
    reconnectInfoRef,
    lastMeaningfulClaimRef,
    claimRaceWindowMs,
  ]);
}

/** Mirror the live solo engine to localStorage so a reload of
 *  `/match?solo=1` can rebuild the bot loop from the persisted
 *  snapshot — see `apps/client/src/state/solo-persist.ts` and
 *  `apps/client/app/match.tsx`. Online + LAN have their own
 *  server-side rebind, so they skip this entirely. */
function persistSoloIfActive(join: JoinInfo | null): void {
  if (join?.kind !== 'solo') return;
  const { state, lobby, you } = useGame.getState();
  if (state === null || lobby === null || you === null) return;
  saveSoloSnapshot({ state, lobby, you });
}
