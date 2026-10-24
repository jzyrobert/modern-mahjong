import type { Event, GameState } from '@mahjong/game-logic';
import type { PublicPlayer, StatsEvent } from '@mahjong/protocol';
import { Platform } from 'react-native';
import { getPlayerId, newRandomId } from '../identity';
import type { JoinInfo } from './join-info';
import { resolveServerHost } from './server-host';

/**
 * Anonymous play statistics: fire-and-forget beacons to the Worker's
 * `POST /stats/event` (see `apps/server/src/stats.ts`). Every match
 * mode reports from the client because solo and LAN never touch the
 * server; an online room's four clients each report, and the dashboard
 * counts a hand once per (room, seed).
 *
 * Off under automation (`navigator.webdriver`, so Playwright never
 * beacons), Do-Not-Track / Global Privacy Control, and spectators.
 * Failures are swallowed — stats must never affect play.
 */

const VISIT_KEY = 'mahjong.stats.lastVisitDay';

function enabled(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.webdriver) return false;
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return false;
  return true;
}

function platform(): StatsEvent['platform'] {
  const os = Platform.OS;
  return os === 'web' || os === 'android' || os === 'ios' ? os : 'other';
}

function send(event: StatsEvent): void {
  if (!enabled()) return;
  try {
    // `text/plain` keeps this a CORS simple request (no preflight).
    fetch(`${resolveServerHost().replace(/\/$/, '')}/stats/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // fetch unavailable (static render) — nothing to report.
  }
}

/** Once per UTC day per device: the daily-active-player row. */
export function reportVisit(): void {
  if (!enabled() || typeof localStorage === 'undefined') return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(VISIT_KEY) === today) return;
    localStorage.setItem(VISIT_KEY, today);
  } catch {
    return;
  }
  send({ k: 'visit', player: getPlayerId(), platform: platform() });
}

export function reportTutorial(lessonId: string): void {
  send({
    k: 'tutorial',
    player: getPlayerId(),
    platform: platform(),
    match: newRandomId(),
    mode: 'tutorial',
    room: lessonId.slice(0, 32),
  });
}

interface TrackedMatch {
  key: string;
  id: string;
  handNo: number;
  /** Null when the hand was already under way (resume / reconnect). */
  handStartedAt: number | null;
  discards: number;
  handEnded: boolean;
}

let current: TrackedMatch | null = null;

/** Forget the active match so the next solo game gets a fresh id
 *  (solo's join key never changes). Called from `leave()`. */
export function statsLeaveMatch(): void {
  current = null;
}

function joinKey(join: JoinInfo): string {
  if (join.kind === 'solo') return 'solo';
  if (join.kind === 'lan') return `lan:${join.hostUrl}:${join.code}`;
  return `online:${join.code}`;
}

function trackedFor(join: JoinInfo): TrackedMatch {
  const key = joinKey(join);
  // A reconnect re-subscribes with the same join — keep the same id.
  if (current?.key !== key) {
    current = {
      key,
      id: newRandomId(),
      handNo: 0,
      handStartedAt: null,
      discards: 0,
      handEnded: false,
    };
  }
  return current;
}

/**
 * Feed one `delta` batch. Emits `handStart` on `handStarted` and one
 * `handEnd` on the hand's first `won` / `drawn-game`.
 */
export function statsOnEvents(
  join: JoinInfo | null,
  events: readonly Event[],
  state: GameState,
  you: number | 'spectator' | null,
  players: readonly PublicPlayer[],
): void {
  if (join === null || typeof you !== 'number') return;
  const match = trackedFor(join);
  const seated = players.filter((p) => p.seat !== null);
  const bots = seated.filter((p) => p.isBot);
  const common = {
    player: getPlayerId(),
    platform: platform(),
    match: match.id,
    mode: join.kind,
    room: join.kind === 'solo' ? undefined : join.code,
    humans: seated.length - bots.length,
    bots: bots.length,
    botKinds: bots.flatMap((p) => (p.botKind ? [p.botKind] : [])),
  } as const;

  for (const event of events) {
    if (event.t === 'handStarted') {
      match.handNo += 1;
      match.handStartedAt = Date.now();
      match.discards = 0;
      match.handEnded = false;
      send({ k: 'handStart', ...common });
    } else if (event.t === 'discarded') {
      match.discards += 1;
    } else if ((event.t === 'won' || event.t === 'drawn-game') && !match.handEnded) {
      match.handEnded = true;
      const timed = match.handStartedAt !== null;
      const base = {
        k: 'handEnd',
        ...common,
        seed: Number.isInteger(state.seed) ? state.seed : undefined,
        handNo: match.handNo > 0 ? match.handNo : undefined,
        durationMs: timed ? Date.now() - (match.handStartedAt ?? 0) : undefined,
        discards: timed ? match.discards : undefined,
      } as const;
      if (event.t === 'drawn-game') {
        send({ ...base, outcome: 'draw' });
      } else {
        const winner = players.find((p) => p.seat === event.seat);
        send({
          ...base,
          outcome: 'win',
          winner: event.seat === you ? 'me' : winner?.isBot ? 'bot' : 'human',
          selfDraw: event.selfDraw,
          faan: Math.min(event.faan, 100),
          patterns: event.breakdown.map((b) => b.english.slice(0, 48)).slice(0, 24),
        });
      }
    }
  }
}
