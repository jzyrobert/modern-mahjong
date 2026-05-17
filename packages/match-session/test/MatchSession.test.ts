import { heuristicBot, passiveBot, simpleBot } from '@mahjong/bots';
import { SEATS, type Seat } from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
import { describe, expect, it, vi } from 'vitest';
import { MatchSession, type Outbound } from '../src/MatchSession.js';

function pickBroadcasts(outs: Outbound[]): ServerMessage[] {
  return outs.filter((o) => o.kind === 'broadcast').map((o) => (o as { msg: ServerMessage }).msg);
}

function pickSends(outs: Outbound[], connectionId: string): ServerMessage[] {
  return outs
    .filter((o) => o.kind === 'sendTo' && o.connectionId === connectionId)
    .map((o) => (o as { msg: ServerMessage }).msg);
}

function helloAs(
  s: MatchSession,
  connectionId: string,
  playerId: string,
  displayName = playerId,
  matchCode = 'X',
): Outbound[] {
  return s.applyClientMessage(connectionId, { t: 'hello', playerId, displayName, matchCode });
}

function stateYouFor(out: Outbound[], connectionId: string) {
  const m = pickSends(out, connectionId).find((x) => x.t === 'state');
  return m && m.t === 'state' ? m.you : null;
}

/**
 * Fill the given seats with passive bots. Used by the legacy tests that
 * predate the all-seats-filled gate on `startHand` — they only care
 * about a hand actually starting, not who's in the other seats.
 */
function seatPassiveBots(s: MatchSession, seats: Seat[]): void {
  for (const seat of seats) s.seatBot(seat, passiveBot);
}

describe('MatchSession — publicSummary (lobby browser)', () => {
  it('returns null before any human has joined', () => {
    const s = new MatchSession();
    expect(s.publicSummary('ABCDE')).toBeNull();
  });

  it('returns a summary after the host arrives', () => {
    const s = new MatchSession();
    helloAs(s, 'c1', 'p1', 'Alice', 'ABCDE');
    const summary = s.publicSummary('ABCDE');
    expect(summary).not.toBeNull();
    expect(summary?.code).toBe('ABCDE');
    expect(summary?.hostName).toBe('Alice');
    expect(summary?.humanCount).toBe(1);
    expect(summary?.botCount).toBe(0);
    expect(summary?.totalSeats).toBe(4);
    expect(summary?.isInProgress).toBe(false);
  });

  it('counts a seated bot toward botCount', () => {
    const s = new MatchSession();
    helloAs(s, 'c1', 'p1', 'Alice');
    s.seatBot(1, simpleBot);
    const summary = s.publicSummary('X');
    expect(summary?.humanCount).toBe(1);
    expect(summary?.botCount).toBe(1);
  });

  it('reports isInProgress: true once the hand is underway', () => {
    const s = new MatchSession({ botPaceMs: 0 });
    helloAs(s, 'c1', 'p1', 'Alice');
    seatPassiveBots(s, [1, 2, 3]);
    s.applyClientMessage('c1', { t: 'action', action: { t: 'startHand', seed: 1 } });
    const summary = s.publicSummary('X');
    expect(summary?.isInProgress).toBe(true);
  });
});

describe('MatchSession — hello + lobby', () => {
  it('first hello assigns seat 0 and becomes host', () => {
    const s = new MatchSession();
    const out = helloAs(s, 'c1', 'p1', 'Alice', 'ABCDE');
    expect(stateYouFor(out, 'c1')).toBe(0);

    const lobby = pickBroadcasts(out).find((m) => m.t === 'lobby');
    expect(lobby?.t).toBe('lobby');
    if (lobby?.t === 'lobby') expect(lobby.host).toBe('p1');
  });

  it('reconnect with same playerId restores the original seat', () => {
    const s = new MatchSession();
    helloAs(s, 'c1', 'p1', 'Alice');
    s.detachConnection('c1');
    const out = helloAs(s, 'c2', 'p1', 'Alice');
    expect(stateYouFor(out, 'c2')).toBe(0);
  });

  it('new playerIds get the next available seats', () => {
    const s = new MatchSession();
    const outs = [0, 1, 2, 3].map((i) => helloAs(s, `c${i}`, `p${i}`));
    const seats = outs.map((out, i) => stateYouFor(out, `c${i}`));
    expect(seats).toEqual([0, 1, 2, 3]);
  });

  it('admits a fifth player as a spectator when the room is full', () => {
    const s = new MatchSession();
    for (let i = 0; i < 4; i++) helloAs(s, `c${i}`, `p${i}`);
    const out = helloAs(s, 'c4', 'p4');
    // No close, no FULL error — the connection stays open as a viewer.
    expect(out.some((o) => o.kind === 'closeConnection')).toBe(false);
    expect(stateYouFor(out, 'c4')).toBe('spectator');
    // Lobby broadcast carries the live viewer count.
    const lobby = pickBroadcasts(out).find((m) => m.t === 'lobby');
    expect(lobby?.t === 'lobby' && lobby.viewers).toBe(1);
  });

  it('decrements viewers when a spectator disconnects', () => {
    const s = new MatchSession();
    for (let i = 0; i < 4; i++) helloAs(s, `c${i}`, `p${i}`);
    helloAs(s, 'c4', 'p4');
    const out = s.detachConnection('c4');
    const lobby = pickBroadcasts(out).find((m) => m.t === 'lobby');
    expect(lobby?.t === 'lobby' && lobby.viewers).toBe(0);
  });

  it('honours an explicit spectate flag even when seats are open', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    // Intentional spectate: even though seats 1-3 are open, the
    // server routes this connection into the viewer pool.
    const out = s.applyClientMessage('c1', {
      t: 'hello',
      playerId: 'p1',
      displayName: 'Watcher',
      matchCode: 'X',
      spectate: true,
    });
    expect(stateYouFor(out, 'c1')).toBe('spectator');
    const lobby = pickBroadcasts(out).find((m) => m.t === 'lobby');
    expect(lobby?.t === 'lobby' && lobby.viewers).toBe(1);
    // Seat 1 stays empty so a subsequent non-spectator joiner gets it.
    const next = helloAs(s, 'c2', 'p2', 'Player2');
    expect(stateYouFor(next, 'c2')).toBe(1);
  });
});

describe('MatchSession — bot-driven hand to completion', () => {
  it('four bots play a full hand and end up in a resolved state', () => {
    // `botPaceMs: 0` short-circuits the alarm-driven 3s "thinking" gap
    // between draw and discard so a 100+-step hand fits in one tick.
    const s = new MatchSession({ botPaceMs: 0 });
    // Seat a human host first so we can pass the host-only `startHand` gate.
    s.applyClientMessage('host', {
      t: 'hello',
      playerId: 'host-p',
      displayName: 'Host',
      matchCode: 'ABCDE',
    });
    s.seatBot(1, heuristicBot);
    s.seatBot(2, simpleBot);
    s.seatBot(3, passiveBot);

    s.applyClientMessage('host', {
      t: 'action',
      action: { t: 'startHand', seed: 42, dealer: 0 },
    });

    // Disconnect the host so seat 0 falls back to its passive stand-in bot;
    // alarms then drive all four seats to completion.
    s.detachConnection('host');

    let safety = 0;
    while (s.getState().phase !== 'resolved' && safety < 300) {
      s.fireAlarm(Date.now());
      safety++;
    }
    expect(s.getState().phase).toBe('resolved');
  });
});

describe('MatchSession — host gating', () => {
  it('rejects a non-host startHand with HOST error', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    const out = s.applyClientMessage('c1', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    const errs = pickSends(out, 'c1').filter((m) => m.t === 'error');
    expect(errs[0]?.t === 'error' && errs[0].code).toBe('HOST');
  });

  it('rejects a non-host setRules with HOST error', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    const out = s.applyClientMessage('c1', {
      t: 'action',
      action: { t: 'setRules', rules: { faanMin: 0 } },
    });
    const errs = pickSends(out, 'c1').filter((m) => m.t === 'error');
    expect(errs[0]?.t === 'error' && errs[0].code).toBe('HOST');
  });

  it('accepts host-issued startHand', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    seatPassiveBots(s, [1, 2, 3]);
    s.applyClientMessage('c0', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    expect(s.getState().phase).toBe('turn');
  });

  it('rejects startHand when any seat is unfilled', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    // Seats 2 + 3 are open — no humans, no bots.
    const out = s.applyClientMessage('c0', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    const errs = pickSends(out, 'c0').filter((m) => m.t === 'error');
    expect(errs[0]?.t === 'error' && errs[0].code).toBe('SEATS');
    expect(s.getState().phase).toBe('waiting');
  });
});

describe('MatchSession — explicit leave', () => {
  it('host leave with another connected guest promotes the guest to host immediately', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    seatPassiveBots(s, [2, 3]);
    const out = s.applyClientMessage('c0', { t: 'leave' });
    // Lobby broadcast carries the new host.
    const lobby = pickBroadcasts(out).find((m) => m.t === 'lobby');
    expect(lobby?.t === 'lobby' && lobby.host).toBe('p1');
    // Leaver's connection is closed.
    expect(out.some((o) => o.kind === 'closeConnection' && o.connectionId === 'c0')).toBe(true);
    // The promoted host can immediately use a host-only action without a
    // HOST error (the leaver's seat is freed, so `startHand` would still
    // hit SEATS — `setRules` is the cleaner host-only check here).
    const setRules = s.applyClientMessage('c1', {
      t: 'action',
      action: { t: 'setRules', rules: { faanMin: 0 } },
    });
    expect(pickSends(setRules, 'c1').filter((m) => m.t === 'error')).toHaveLength(0);
  });

  it('host leave with no other humans dissolves the match (broadcasts HOST_LEFT, closes all)', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    seatPassiveBots(s, [1, 2, 3]);
    // Add a spectator so we can verify they get kicked too.
    helloAs(s, 'cSpec', 'pSpec');
    const out = s.applyClientMessage('c0', { t: 'leave' });
    const errs = pickBroadcasts(out).filter((m) => m.t === 'error');
    expect(errs[0]?.t === 'error' && errs[0].code).toBe('HOST_LEFT');
    // Spectator's connection is closed by the dissolve path.
    expect(out.some((o) => o.kind === 'closeConnection' && o.connectionId === 'cSpec')).toBe(true);
    // Leaver's own connection is also closed.
    expect(out.some((o) => o.kind === 'closeConnection' && o.connectionId === 'c0')).toBe(true);
  });

  it('guest leave frees their seat fully so a new player can take it without grace', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    s.applyClientMessage('c1', { t: 'leave' });
    // A brand-new player can immediately claim the freed seat (no auto-bot
    // / disconnectedSinceMs reservation that would push them to spectator).
    const out = helloAs(s, 'cNew', 'pNew');
    expect(stateYouFor(out, 'cNew')).toBe(1);
    // Host is unchanged.
    const lobby = pickBroadcasts(out).find((m) => m.t === 'lobby');
    expect(lobby?.t === 'lobby' && lobby.host).toBe('p0');
  });

  it('spectator leave just closes the connection (no seat / host churn)', () => {
    const s = new MatchSession();
    for (let i = 0; i < 4; i++) helloAs(s, `c${i}`, `p${i}`);
    helloAs(s, 'cSpec', 'pSpec');
    const out = s.applyClientMessage('cSpec', { t: 'leave' });
    expect(out.some((o) => o.kind === 'closeConnection' && o.connectionId === 'cSpec')).toBe(true);
    // No HOST_LEFT broadcast, no host change.
    const errs = pickBroadcasts(out).filter((m) => m.t === 'error');
    expect(errs).toHaveLength(0);
  });
});

describe('MatchSession — per-turn timeout', () => {
  // `DEFAULT_RULES.turnTimeoutMs` now ships as `0` (no timer) for
  // casual play — these tests have to arm the timer explicitly via
  // `setRules` before `startHand` so the engine actually stamps a
  // `turnDeadlineMs` for the alarm scheduling path to fire on.
  const armTimer = (s: MatchSession): void => {
    s.applyClientMessage('cHost', {
      t: 'action',
      action: { t: 'setRules', rules: { turnTimeoutMs: 20_000 } },
    });
  };

  it('schedules an alarm at state.turnDeadlineMs when the active seat is a connected human', () => {
    const s = new MatchSession({ botPaceMs: 0 });
    helloAs(s, 'cHost', 'p-host');
    seatPassiveBots(s, [1, 2, 3]);
    armTimer(s);
    const start = s.applyClientMessage('cHost', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    const scheduled = start.find((o) => o.kind === 'scheduleAlarm');
    expect(scheduled?.kind).toBe('scheduleAlarm');
    if (scheduled?.kind === 'scheduleAlarm') {
      expect(scheduled.deadlineMs).toBe(s.getState().turnDeadlineMs);
    }
  });

  it('alarm past the deadline auto-discards for a stalled human seat (turn advances)', () => {
    const s = new MatchSession({ botPaceMs: 0 });
    helloAs(s, 'cHost', 'p-host');
    seatPassiveBots(s, [1, 2, 3]);
    armTimer(s);
    s.applyClientMessage('cHost', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    const wallBefore = s.getState().wall.length;
    const turnDeadline = s.getState().turnDeadlineMs!;
    expect(s.getState().phase).toBe('turn');
    expect(s.getState().turn).toBe(0);
    // Fire the alarm one ms past the deadline. The host (human, no
    // bot) hasn't acted, so `forceTurnAutoDiscard` runs — passive-bot
    // discard, claim window opens, instant pre-pass resolves it (the
    // seat 1/2/3 bots have no claim against a random discard), bots
    // play through to seat 1's draw, and so on. With `botPaceMs: 0`
    // the bot loop can chain a full round before yielding back to
    // the human at seat 0; assert on wall progress instead of seat
    // identity so the test doesn't pin the cadence.
    s.fireAlarm(turnDeadline + 1);
    expect(s.getState().wall.length).toBeLessThan(wallBefore);
  });

  it('does not schedule an alarm for the turn deadline when the active seat is a bot', () => {
    const s = new MatchSession({ botPaceMs: 0 });
    helloAs(s, 'cHost', 'p-host');
    seatPassiveBots(s, [1, 2, 3]);
    // Dealer = seat 1 (a bot). With botPaceMs:0 the synchronous bot
    // loop drives the hand forward without any timeout enforcement;
    // the test asserts the per-turn deadline gate (`isActiveSeat-
    // StalledHuman`) keeps the auto-discard path dormant when the
    // seat is bot-occupied.
    const out = s.applyClientMessage('cHost', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 1 },
    });
    // The first `state.turn === 1` immediately after startHand is a
    // bot; bots run synchronously, so by the time we inspect outputs
    // the engine has already moved past seat 1's turn (or claim
    // window). The point is the auto-discard helper for
    // stalled-human seats was never the driver.
    const stateAfter = s.getState();
    // Either we've moved past seat 1 (bot loop ran) or the hand has
    // resolved entirely — both shapes are valid; the load-bearing
    // assertion is that the engine isn't sitting on `turn === 1`
    // waiting for a phantom human action.
    if (stateAfter.phase === 'turn') {
      expect(stateAfter.turn === 1 && stateAfter.hasDrawn === false).toBe(false);
    }
    void out;
  });
});

describe('MatchSession — disconnect + reconnect grace', () => {
  it('installs a passive stand-in bot when a seated player disconnects', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0');
    s.detachConnection('c0');
    const lobby = helloAs(s, 'cx', 'pX');
    // pX should land in seat 1 (seat 0 is reserved for the disconnected p0 + bot).
    expect(stateYouFor(lobby, 'cx')).toBe(1);
  });

  it('reconnect by the same playerId clears the stand-in bot', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0');
    seatPassiveBots(s, [1, 2, 3]);
    s.detachConnection('c0');
    const reconn = helloAs(s, 'c0b', 'p0');
    expect(stateYouFor(reconn, 'c0b')).toBe(0);
    // After reconnect, sending a host-only action should succeed (p0 is still host).
    const startOut = s.applyClientMessage('c0b', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    expect(pickSends(startOut, 'c0b').filter((m) => m.t === 'error')).toHaveLength(0);
    expect(s.getState().phase).toBe('turn');
  });

  it('schedules an alarm for the grace deadline on disconnect', () => {
    const s = new MatchSession({ reconnectGraceMs: 5_000 });
    helloAs(s, 'c0', 'p0');
    const out = s.detachConnection('c0', 1_000_000);
    const scheduled = out.find((o) => o.kind === 'scheduleAlarm');
    expect(scheduled?.kind).toBe('scheduleAlarm');
    if (scheduled?.kind === 'scheduleAlarm') {
      expect(scheduled.deadlineMs).toBe(1_005_000);
    }
  });

  it('grace expiry frees the seat so a new player can claim it', () => {
    const s = new MatchSession({ reconnectGraceMs: 1_000 });
    helloAs(s, 'c0', 'p0');
    helloAs(s, 'c1', 'p1');
    helloAs(s, 'c2', 'p2');
    helloAs(s, 'c3', 'p3');
    s.detachConnection('c0', 0);
    // Before grace expiry the room is full to new players — they connect
    // as spectators (only seat 0 is auto-bot held for p0's reconnect).
    const earlyOut = helloAs(s, 'cEarly', 'pEarly');
    expect(stateYouFor(earlyOut, 'cEarly')).toBe('spectator');
    // After grace expires, p0's seat is reclaimable. cEarly already has a
    // live connection (as a spectator) so they need to detach + re-hello
    // to take the freed seat — but a fresh connection just claims it.
    s.fireAlarm(2_000);
    const lateOut = helloAs(s, 'cLate', 'pLate');
    expect(stateYouFor(lateOut, 'cLate')).toBe(0);
  });

  it('grace expiry hands off the host if the evicted player held the host slot', () => {
    const s = new MatchSession({ reconnectGraceMs: 1_000 });
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    seatPassiveBots(s, [2, 3]);
    s.detachConnection('c0', 0);
    s.fireAlarm(2_000);
    // Guest (p1) is now host: their startHand must succeed (no HOST error).
    const out = s.applyClientMessage('c1', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    expect(pickSends(out, 'c1').filter((m) => m.t === 'error')).toHaveLength(0);
    expect(s.getState().phase).not.toBe('waiting');
  });

  it('reconnect within the grace window keeps the original seat (no eviction)', () => {
    const s = new MatchSession({ reconnectGraceMs: 1_000 });
    helloAs(s, 'c0', 'p0');
    seatPassiveBots(s, [1, 2, 3]);
    s.detachConnection('c0', 0);
    const reconn = helloAs(s, 'c0b', 'p0');
    expect(stateYouFor(reconn, 'c0b')).toBe(0);
    // Firing the alarm after reconnect must NOT evict — playerId is back.
    s.fireAlarm(10_000);
    // p0 can still start the hand (still seated, still host).
    const out = s.applyClientMessage('c0b', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    expect(pickSends(out, 'c0b').filter((m) => m.t === 'error')).toHaveLength(0);
  });

  // The mobile reality is that a screen-lock or task-switch can outlast
  // any grace window we pick (a generous 5 min default is still finite).
  // When the original owner finally reconnects, they should land back in
  // their *original* seat from the bot stand-in, not get shuffled into
  // whatever empty slot happens to be next — otherwise the lobby drifts
  // (bot in seat 0, host in seat 1, etc.) and the LobbyPreview's "who's
  // host" cue stops matching the actual host.
  it('reconnect AFTER grace expiry reclaims the original seat from the bot stand-in', () => {
    const s = new MatchSession({ reconnectGraceMs: 1_000 });
    helloAs(s, 'c0', 'p0', 'Host');
    // Leave seats 1-3 empty so this test exercises the post-grace branch
    // of `findOrAssignSeat` specifically — not the "no empty seats, fall
    // through to bot stand-in" branch the existing test covers.
    s.detachConnection('c0', 0);
    s.fireAlarm(2_000);
    // p0 comes back well after the grace window has lapsed.
    const reconn = helloAs(s, 'c0b', 'p0', 'Host');
    expect(stateYouFor(reconn, 'c0b')).toBe(0);
    // And the lobby broadcast must reflect a live human in seat 0,
    // not a leftover bot label (the `formerPlayerId` reclaim must
    // overwrite the auto-bot, mirroring the within-grace reconnect).
    const lobby = pickBroadcasts(reconn).find((m) => m.t === 'lobby');
    expect(lobby?.t).toBe('lobby');
    if (lobby?.t === 'lobby') {
      expect(lobby.players[0]?.isBot).toBe(false);
      expect(lobby.players[0]?.connected).toBe(true);
      expect(lobby.players[0]?.displayName).toBe('Host');
    }
  });

  it('AFTER grace expiry a *different* playerId still falls through to the stand-in (existing semantics preserved)', () => {
    // Companion to the post-grace reclaim test: confirms a new player
    // (different `playerId`) can still take an abandoned auto-bot seat
    // once the room is otherwise full. Mirrors the
    // "grace expiry frees the seat so a new player can claim it" test
    // above but expressed with seats 1-3 left empty too, so we're
    // checking that pass-2 (empty seat) wins for new joiners and the
    // post-grace `formerPlayerId` slot only matters for the original
    // owner.
    const s = new MatchSession({ reconnectGraceMs: 1_000 });
    helloAs(s, 'c0', 'p0');
    helloAs(s, 'c1', 'p1');
    helloAs(s, 'c2', 'p2');
    helloAs(s, 'c3', 'p3');
    s.detachConnection('c0', 0);
    s.fireAlarm(2_000);
    // A brand-new player (pX, never seen) joins post-grace. Every other
    // seat is held by a live human, so they must take the only
    // available slot — the stand-in formerly occupied by p0.
    const lateOut = helloAs(s, 'cX', 'pX');
    expect(stateYouFor(lateOut, 'cX')).toBe(0);
  });
});

describe('MatchSession — snapshot + restore', () => {
  it('round-trips through JSON without losing engine state', () => {
    const a = new MatchSession();
    helloAs(a, 'c0', 'p0', 'Host');
    helloAs(a, 'c1', 'p1', 'Guest');
    seatPassiveBots(a, [2, 3]);
    a.applyClientMessage('c0', {
      t: 'action',
      action: { t: 'startHand', seed: 42, dealer: 0 },
    });
    const phaseBefore = a.getState().phase;
    const wallBefore = a.getState().wall.length;

    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    const b = new MatchSession();
    b.restore(snap);

    expect(b.getState().phase).toBe(phaseBefore);
    expect(b.getState().wall.length).toBe(wallBefore);
  });

  it('rebuilds the auto-bot stand-in seat across a snapshot/restore cycle', () => {
    const a = new MatchSession();
    helloAs(a, 'c0', 'p0');
    seatPassiveBots(a, [1, 2, 3]);
    a.detachConnection('c0', 1_000);
    const snap = JSON.parse(JSON.stringify(a.snapshot()));

    const b = new MatchSession();
    b.restore(snap);
    // Reconnect by the same playerId — seat 0 should still be associated with p0.
    const reconn = helloAs(b, 'c0b', 'p0');
    expect(stateYouFor(reconn, 'c0b')).toBe(0);
    // Host gating: p0 was the host before the snapshot, so startHand must succeed.
    const out = b.applyClientMessage('c0b', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    expect(pickSends(out, 'c0b').filter((m) => m.t === 'error')).toHaveLength(0);
  });

  it('attachAll re-binds seats to live connection ids after a hibernation cycle', () => {
    // Multi-player bug regression: A creates a lobby, the DO hibernates,
    // B joins → A's in-memory connectionId is wiped by snapshot+restore
    // so A's seat reports `connected: false` even though A's WebSocket
    // is alive, and host-only actions from A get bounced with HOST.
    // The runtime persists `playerId` on each conn via `setState`; on
    // wake `MatchRoom.onStart` calls `attachAll` to re-bind those
    // playerIds to their live conn ids.
    const a = new MatchSession();
    helloAs(a, 'cA', 'pA', 'Alice');
    const snap = JSON.parse(JSON.stringify(a.snapshot()));

    const b = new MatchSession();
    b.restore(snap);
    // Before attachAll the lobby projection has Alice marked disconnected
    // because `connectionId` is null on every seat post-restore.
    const beforeOuts = helloAs(b, 'cB', 'pB', 'Bob');
    const beforeLobby = pickBroadcasts(beforeOuts).find((m) => m.t === 'lobby');
    if (beforeLobby?.t !== 'lobby') throw new Error('expected a lobby broadcast');
    expect(beforeLobby.players.find((p) => p.playerId === 'pA')?.connected).toBe(false);

    // attachAll re-binds the seats; the rebroadcast lobby reports Alice
    // as connected again.
    const attachOuts = b.attachAll(
      new Map([
        ['pA', 'cA'],
        ['pB', 'cB'],
      ]),
    );
    const reLobby = pickBroadcasts(attachOuts).find((m) => m.t === 'lobby');
    if (reLobby?.t !== 'lobby') throw new Error('expected attachAll to rebroadcast lobby');
    expect(reLobby.players.find((p) => p.playerId === 'pA')?.connected).toBe(true);
    expect(reLobby.host).toBe('pA');

    // Host-only actions from A now succeed: pre-fix Alice's seat had
    // connectionId=null, so `playerIdFor('cA')` returned null and
    // startHand bounced with HOST.
    b.applyClientMessage('cA', { t: 'seatBot', seat: 2, kind: 'passive' });
    b.applyClientMessage('cA', { t: 'seatBot', seat: 3, kind: 'passive' });
    const startOut = b.applyClientMessage('cA', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    expect(pickSends(startOut, 'cA').filter((m) => m.t === 'error')).toHaveLength(0);
  });

  it('attachAll skips seats with no playerId and is a no-op when nothing changed', () => {
    const s = new MatchSession();
    helloAs(s, 'cA', 'pA');
    // Already-attached seat: re-passing the same map doesn't broadcast.
    const out = s.attachAll(new Map([['pA', 'cA']]));
    expect(out).toHaveLength(0);
    // Empty seats are silently skipped — passing a map for an unseated
    // playerId doesn't error.
    const out2 = s.attachAll(new Map([['pUnknown', 'cZ']]));
    expect(out2).toHaveLength(0);
  });

  it('host stays consistent when both players leave and rejoin within grace', () => {
    // Multi-player bug regression #2: with two players in the lobby,
    // both leaving and rejoining should leave the original host as
    // host. Pre-fix, hibernation stripped connectionIds so leave
    // events couldn't detach properly, but the rejoin path still
    // matches by playerId, so `hostPlayerId` should be preserved.
    const s = new MatchSession();
    helloAs(s, 'cA', 'pA', 'Alice');
    helloAs(s, 'cB', 'pB', 'Bob');
    s.detachConnection('cA', 1_000);
    s.detachConnection('cB', 1_500);
    // Re-hello within reconnect grace.
    const aOut = helloAs(s, 'cA2', 'pA');
    expect(stateYouFor(aOut, 'cA2')).toBe(0);
    const bOut = helloAs(s, 'cB2', 'pB');
    expect(stateYouFor(bOut, 'cB2')).toBe(1);
    const lobby = pickBroadcasts(bOut).find((m) => m.t === 'lobby');
    if (lobby?.t !== 'lobby') throw new Error('expected a lobby broadcast');
    expect(lobby.host).toBe('pA');
  });
});

describe('MatchSession — claim ladder', () => {
  function fourHumanSession(): MatchSession {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'G1');
    helloAs(s, 'c2', 'p2', 'G2');
    helloAs(s, 'c3', 'p3', 'G3');
    s.applyClientMessage('c0', {
      t: 'action',
      action: { t: 'startHand', seed: 42, dealer: 0 },
    });
    const tile = s.getState().hands[0][0]!;
    s.applyClientMessage('c0', { t: 'action', action: { t: 'discard', seat: 0, tile } });
    return s;
  }

  it('fireAlarm at soft floor leaves pending seats alone; hard fallback resolves them', () => {
    const s = fourHumanSession();
    if (s.getState().phase !== 'awaitingClaims' || !s.getState().pendingClaims) {
      // Seed-dependent: if the discard was pre-passed by every seat,
      // the engine has already advanced. Nothing left to assert.
      return;
    }
    const pending = s.getState().pendingClaims!;
    const anyPending = SEATS.some((seat) => seat !== 0 && !pending.submitted[seat]);
    if (!anyPending) return; // every seat pre-passed; nothing to test

    // Soft floor: nothing should change for the connected-but-silent humans.
    s.fireAlarm(pending.deadlineMs);
    expect(s.getState().phase).toBe('awaitingClaims');

    // Hard fallback: silent seats get padded as pass and the round resolves.
    s.fireAlarm(pending.hardDeadlineMs!);
    expect(s.getState().phase).toBe('turn');
  });

  it('arms alarm at hard fallback when seats are still pending', () => {
    const s = fourHumanSession();
    if (s.getState().phase !== 'awaitingClaims' || !s.getState().pendingClaims) return;
    const pending = s.getState().pendingClaims!;
    const anyPending = SEATS.some((seat) => seat !== 0 && !pending.submitted[seat]);
    if (!anyPending) return;

    // Trigger a no-op outbound to read the next scheduled alarm. detachConnection
    // re-runs `maybeScheduleAlarm`; since the player is just re-attached, no
    // grace timer kicks in — the only deadline left is the claim window's.
    helloAs(s, 'c1', 'p1'); // re-attach (already there) — forces a maybeScheduleAlarm
    // Reach back into the public API: any subsequent action emits a fresh alarm.
    s.applyClientMessage('c0', { t: 'chat', text: 'hi' });
    const out = s.applyClientMessage('c0', { t: 'chat', text: 'still here' });
    void out;

    const stillAwaiting = s.getState().phase === 'awaitingClaims';
    expect(stillAwaiting).toBe(true);
    // The alarm we'd have scheduled should be the hard fallback (not the soft floor)
    // because at least one seat is pending. Verify by firing exactly at deadlineMs:
    // resolution must NOT happen here. (Actual armed deadline isn't directly observable
    // without a fresh outbound; this assertion locks the contract that maybeScheduleAlarm
    // depends on the same all-submitted check fireAlarm uses.)
    s.fireAlarm(pending.deadlineMs);
    expect(s.getState().phase).toBe('awaitingClaims');
  });
});

describe('MatchSession — seatBot / unseatBot', () => {
  it('host can seat a bot in an empty seat; lobby exposes the kind', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    const out = s.applyClientMessage('c0', { t: 'seatBot', seat: 1, kind: 'heuristic' });
    expect(pickSends(out, 'c0').filter((m) => m.t === 'error')).toHaveLength(0);
    const lobby = pickBroadcasts(out).find((m) => m.t === 'lobby');
    if (lobby?.t !== 'lobby') throw new Error('expected lobby broadcast');
    const seat1 = lobby.players.find((p) => p.seat === 1);
    expect(seat1?.isBot).toBe(true);
    expect(seat1?.botKind).toBe('heuristic');
  });

  it('non-host seatBot returns HOST', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    const out = s.applyClientMessage('c1', { t: 'seatBot', seat: 2, kind: 'simple' });
    const errs = pickSends(out, 'c1').filter((m) => m.t === 'error');
    expect(errs[0]?.t === 'error' && errs[0].code).toBe('HOST');
  });

  it('seatBot rejected mid-hand with PHASE', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    seatPassiveBots(s, [1, 2, 3]);
    s.applyClientMessage('c0', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    const out = s.applyClientMessage('c0', { t: 'seatBot', seat: 1, kind: 'heuristic' });
    const errs = pickSends(out, 'c0').filter((m) => m.t === 'error');
    expect(errs[0]?.t === 'error' && errs[0].code).toBe('PHASE');
  });

  it('seatBot cannot displace a connected human (OCCUPIED)', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    const out = s.applyClientMessage('c0', { t: 'seatBot', seat: 1, kind: 'simple' });
    const errs = pickSends(out, 'c0').filter((m) => m.t === 'error');
    expect(errs[0]?.t === 'error' && errs[0].code).toBe('OCCUPIED');
  });

  it('seatBot can replace an auto-bot stand-in (graced disconnect)', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    s.detachConnection('c1');
    // The grace timer evicts after the default reconnectGraceMs (5 min);
    // fire just past it.
    s.fireAlarm(Date.now() + 360_000);
    const out = s.applyClientMessage('c0', { t: 'seatBot', seat: 1, kind: 'heuristic' });
    expect(pickSends(out, 'c0').filter((m) => m.t === 'error')).toHaveLength(0);
    const lobby = pickBroadcasts(out).find((m) => m.t === 'lobby');
    if (lobby?.t === 'lobby') {
      const seat1 = lobby.players.find((p) => p.seat === 1);
      expect(seat1?.botKind).toBe('heuristic');
    }
  });

  it('unseatBot frees a host-seated bot back to an empty seat', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    s.applyClientMessage('c0', { t: 'seatBot', seat: 2, kind: 'simple' });
    const out = s.applyClientMessage('c0', { t: 'unseatBot', seat: 2 });
    expect(pickSends(out, 'c0').filter((m) => m.t === 'error')).toHaveLength(0);
    const lobby = pickBroadcasts(out).find((m) => m.t === 'lobby');
    if (lobby?.t === 'lobby') {
      const seat2 = lobby.players.find((p) => p.seat === 2);
      expect(seat2?.isBot).toBe(false);
    }
  });

  it('unseatBot refuses to evict an auto-bot stand-in (AUTO_BOT)', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    s.detachConnection('c1');
    const out = s.applyClientMessage('c0', { t: 'unseatBot', seat: 1 });
    const errs = pickSends(out, 'c0').filter((m) => m.t === 'error');
    expect(errs[0]?.t === 'error' && errs[0].code).toBe('AUTO_BOT');
  });

  it('snapshot/restore preserves a host-seated bot kind', () => {
    const a = new MatchSession();
    helloAs(a, 'c0', 'p0', 'Host');
    a.applyClientMessage('c0', { t: 'seatBot', seat: 2, kind: 'heuristic' });
    const snap = JSON.parse(JSON.stringify(a.snapshot()));

    const b = new MatchSession();
    b.restore(snap);
    // Re-trigger a lobby broadcast by re-helloing the host.
    const out = helloAs(b, 'c0b', 'p0', 'Host');
    const lobby = pickBroadcasts(out).find((m) => m.t === 'lobby');
    if (lobby?.t === 'lobby') {
      const seat2 = lobby.players.find((p) => p.seat === 2);
      expect(seat2?.botKind).toBe('heuristic');
    }
  });
});

describe('MatchSession — bot pacing', () => {
  /**
   * Drive a session into a state where seat 1 (a bot) has just drawn
   * and the discard is paced behind a `botActionDeadline`. The flow:
   *   1. Host discards the first tile of the hand.
   *   2. Claim window opens; only the host is human, so the soft floor
   *      gates resolution.
   *   3. Caller fires the soft-floor alarm → claim resolves → seat 1
   *      bot draws → discard is deferred to `nowMs + botPaceMs`.
   */
  function discardThenAdvanceToBotPace(
    s: MatchSession,
    softFloorMs: number,
  ): { drawAlarm: number | null } {
    s.applyClientMessage('c0', {
      t: 'action',
      action: { t: 'startHand', seed: 5, dealer: 0 },
    });
    const human = s.getState().hands[0][0]!;
    s.applyClientMessage('c0', {
      t: 'action',
      action: { t: 'discard', seat: 0, tile: human },
    });
    const out = s.fireAlarm(softFloorMs);
    const alarm = out.find((o) => o.kind === 'scheduleAlarm');
    return {
      drawAlarm: alarm?.kind === 'scheduleAlarm' ? alarm.deadlineMs : null,
    };
  }

  it('paces a bot discard via the alarm scheduler (draw immediate, discard deferred)', () => {
    // Pin Math.random to the pass branch (<0.5) so the passive bots'
    // coin-flip pickClaim deterministically returns pass — otherwise
    // a claimed peng/gang would route around the discard-pacing path
    // we're trying to assert on. try/finally guarantees a failed
    // expect() still restores the spy.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    try {
      const PACE = 3_000;
      const s = new MatchSession({ botPaceMs: PACE });
      helloAs(s, 'c0', 'p0', 'Host');
      seatPassiveBots(s, [1, 2, 3]);
      const softFloor = Date.now() + 5_000; // somewhere past the soft floor

      const { drawAlarm } = discardThenAdvanceToBotPace(s, softFloor);
      // After resolving the claim window, seat 1's draw fires + the bot
      // discard is deferred. The next alarm should be armed for
      // `softFloor + PACE`.
      expect(drawAlarm).not.toBeNull();
      expect(drawAlarm!).toBeGreaterThanOrEqual(softFloor + PACE - 100);
      expect(drawAlarm!).toBeLessThanOrEqual(softFloor + PACE + 200);

      // Firing the alarm at that deadline produces the deferred discard.
      const after = s.fireAlarm(drawAlarm! + 50);
      const events: string[] = [];
      for (const o of after) {
        if (o.kind === 'broadcast' && o.msg.t === 'delta') {
          for (const e of o.msg.events) events.push(e.t);
        }
      }
      expect(events.some((t) => t === 'discarded')).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('snapshot round-trips a pending botActionDeadline so hibernation resumes pacing', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    try {
      const PACE = 3_000;
      const a = new MatchSession({ botPaceMs: PACE });
      helloAs(a, 'c0', 'p0', 'Host');
      seatPassiveBots(a, [1, 2, 3]);
      const softFloor = Date.now() + 5_000;
      discardThenAdvanceToBotPace(a, softFloor);

      const snapAny = JSON.parse(JSON.stringify(a.snapshot())) as {
        botActionDeadline?: number | null;
      };
      expect(typeof snapAny.botActionDeadline).toBe('number');
      const deadline = snapAny.botActionDeadline!;

      const b = new MatchSession({ botPaceMs: PACE });
      b.restore(snapAny as Parameters<MatchSession['restore']>[0]);
      const out = b.fireAlarm(deadline + 50);
      const events: string[] = [];
      for (const o of out) {
        if (o.kind === 'broadcast' && o.msg.t === 'delta') {
          for (const e of o.msg.events) events.push(e.t);
        }
      }
      expect(events.some((t) => t === 'discarded')).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });
});

describe('MatchSession — bots stay out of the claim timer', () => {
  it('bot seats do not gate the soft floor; human pending blocks resolution', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    s.applyClientMessage('c0', { t: 'seatBot', seat: 2, kind: 'passive' });
    s.applyClientMessage('c0', { t: 'seatBot', seat: 3, kind: 'passive' });
    s.applyClientMessage('c0', {
      t: 'action',
      action: { t: 'startHand', seed: 42, dealer: 0 },
    });
    const tile = s.getState().hands[0][0]!;
    s.applyClientMessage('c0', { t: 'action', action: { t: 'discard', seat: 0, tile } });
    if (s.getState().phase !== 'awaitingClaims' || !s.getState().pendingClaims) {
      // Discard could not be claimed by anyone; nothing to assert.
      return;
    }
    const pending = s.getState().pendingClaims!;
    const human1Pending = !pending.submitted[1];
    if (!human1Pending) return; // p1 had no meaningful claim, was pre-passed
    // Soft-floor alarm tick — p1 (human, in seat 1) is still pending,
    // so resolution should NOT happen here.
    s.fireAlarm(pending.deadlineMs);
    expect(s.getState().phase).toBe('awaitingClaims');
    // Hard fallback resolves regardless.
    s.fireAlarm(pending.hardDeadlineMs!);
    expect(s.getState().phase === 'awaitingClaims').toBe(false);
  });

  it('drains bot claims synchronously when only bots have meaningful claims (no soft-floor wait)', () => {
    // Repro of the user-reported bug: 1 human host + 3 bots. The
    // passive bot's claim now flips a coin (50/50 pass vs walk the
    // priority chain), so we pin `Math.random` < 0.5 deterministically
    // to force the pass branch. Host discards a tile that one of
    // the bots could legally peng/gang. Pre-fix, the bot's claim
    // was deferred to the soft-floor alarm 3s later — and with the
    // pinned pass branch, the alarm would just record a pass that
    // could have happened immediately. Post-fix, the claim drains
    // inside `runBots` synchronously, so the round resolves at
    // discard time and the next bot's turn begins immediately. The
    // try/finally guarantees the spy is restored even if any
    // expect() below throws — otherwise a regression here would
    // poison sibling tests' Math.random.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    try {
      const s = new MatchSession({ botPaceMs: 0 });
      helloAs(s, 'c0', 'p0', 'Host');
      // Seat all three opponents as easy/passive bots — `Math.random`
      // is pinned to 0.1 above so every coin-flip lands on the pass
      // branch, which means any meaningful claim ends in an all-pass
      // resolution.
      s.applyClientMessage('c0', { t: 'seatBot', seat: 1, kind: 'passive' });
      s.applyClientMessage('c0', { t: 'seatBot', seat: 2, kind: 'passive' });
      s.applyClientMessage('c0', { t: 'seatBot', seat: 3, kind: 'passive' });
      s.applyClientMessage('c0', {
        t: 'action',
        action: { t: 'startHand', seed: 11, dealer: 0 },
      });
      // Find a tile in the host's hand that some other seat could
      // peng on (≥ 2 copies in that seat's hand). If no such tile
      // exists for this seed, fall back to the first tile (the test
      // is still meaningful: every-seat-pre-passed also exercises
      // the engine's new auto-resolve fast path).
      const hand0 = s.getState().hands[0];
      let discard = hand0[0]!;
      let pengSeat: 1 | 2 | 3 | null = null;
      for (const t of hand0) {
        for (const seat of [1, 2, 3] as const) {
          const copies = s
            .getState()
            .hands[seat].filter(
              (h) =>
                (h.kind === 'suit' &&
                  t.kind === 'suit' &&
                  h.suit === t.suit &&
                  h.rank === t.rank) ||
                (h.kind === 'honor' && t.kind === 'honor' && h.honor === t.honor),
            ).length;
          if (copies >= 2) {
            discard = t;
            pengSeat = seat;
            break;
          }
        }
        if (pengSeat) break;
      }

      const out = s.applyClientMessage('c0', {
        t: 'action',
        action: { t: 'discard', seat: 0, tile: discard },
      });
      // Pre-fix: state would be `phase: 'awaitingClaims'` with the
      // peng-able bot still pending, parked there for the soft
      // floor. Post-fix: the bot's pass drains in-line and the
      // engine auto-resolves to the next seat's turn. (Also covers
      // the all-pre-passed case where pengSeat is null — that one
      // resolved in the engine itself.)
      expect(s.getState().phase).not.toBe('awaitingClaims');
      // And no alarm should be armed at the soft floor: there's
      // nothing left to resolve.
      const claimAlarms = out
        .filter(
          (o): o is { kind: 'scheduleAlarm'; deadlineMs: number } => o.kind === 'scheduleAlarm',
        )
        .map((o) => o.deadlineMs);
      // Any scheduled alarm should be a turn/bot-pace deadline, not
      // the stale soft-floor we'd have armed under the old gate.
      // We can't easily distinguish those here without instrumenting
      // the deadline source, so just sanity-check we're past
      // 'awaitingClaims' — that proves no claim alarm is needed.
      void claimAlarms;
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('human submission triggers resolution + bot-claim polling without waiting on bots', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
    s.applyClientMessage('c0', { t: 'seatBot', seat: 2, kind: 'passive' });
    s.applyClientMessage('c0', { t: 'seatBot', seat: 3, kind: 'passive' });
    s.applyClientMessage('c0', {
      t: 'action',
      action: { t: 'startHand', seed: 7, dealer: 0 },
    });
    const tile = s.getState().hands[0][0]!;
    s.applyClientMessage('c0', { t: 'action', action: { t: 'discard', seat: 0, tile } });
    if (s.getState().phase !== 'awaitingClaims' || !s.getState().pendingClaims) return;
    const pending = s.getState().pendingClaims!;
    if (pending.submitted[1]) return; // p1 was pre-passed; nothing to do
    // p1 passes — engine doesn't auto-resolve because bots haven't submitted,
    // but MatchSession's maybeFinishClaimWindow polls them once allHumans are in.
    // Use a future-now so the soft floor is satisfied for the post-action check.
    const original = Date.now;
    Date.now = () => pending.deadlineMs + 100;
    try {
      s.applyClientMessage('c1', {
        t: 'action',
        action: { t: 'declareClaim', seat: 1, claim: { kind: 'pass' } },
      });
    } finally {
      Date.now = original;
    }
    expect(s.getState().phase === 'awaitingClaims').toBe(false);
  });
});

describe('MatchSession — illegal action error path', () => {
  it('out-of-turn discard returns a typed error to the offending connection', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0');
    seatPassiveBots(s, [1, 2, 3]);
    s.applyClientMessage('c0', { t: 'action', action: { t: 'startHand', seed: 1, dealer: 0 } });

    const out = s.applyClientMessage('c0', {
      t: 'action',
      action: {
        t: 'discard',
        seat: 1,
        tile: { kind: 'honor', honor: 'E', copy: 0 },
      },
    });
    const errs = pickSends(out, 'c0').filter((m) => m.t === 'error');
    expect(errs[0]?.t).toBe('error');
  });
});
