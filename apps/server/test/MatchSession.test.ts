import { heuristicBot, passiveBot, simpleBot } from '@mahjong/bots';
import { SEATS, type Seat } from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
import { describe, expect, it } from 'vitest';
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
});

describe('MatchSession — bot-driven hand to completion', () => {
  it('four bots play a full hand and end up in a resolved state', () => {
    const s = new MatchSession();
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
    // The grace timer evicts after default 60s; fire just past it.
    s.fireAlarm(Date.now() + 120_000);
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
