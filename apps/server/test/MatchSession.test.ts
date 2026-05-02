import { heuristicBot, passiveBot, simpleBot } from '@mahjong/bots';
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

  it('rejects a fifth player when the room is full', () => {
    const s = new MatchSession();
    for (let i = 0; i < 4; i++) helloAs(s, `c${i}`, `p${i}`);
    const out = helloAs(s, 'c4', 'p4');
    const errs = pickSends(out, 'c4').filter((m) => m.t === 'error');
    expect(errs[0]?.t).toBe('error');
    expect(errs[0]?.t === 'error' && errs[0].code).toBe('FULL');
    expect(out.some((o) => o.kind === 'closeConnection')).toBe(true);
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
    s.applyClientMessage('c0', {
      t: 'action',
      action: { t: 'startHand', seed: 1, dealer: 0 },
    });
    expect(s.getState().phase).toBe('turn');
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
    // Before grace expiry the room is full to new players (only seat 0 is auto-bot held).
    const earlyOut = helloAs(s, 'cEarly', 'pEarly');
    const earlyErrs = pickSends(earlyOut, 'cEarly').filter((m) => m.t === 'error');
    expect(earlyErrs[0]?.t === 'error' && earlyErrs[0].code).toBe('FULL');
    // After grace expires, p0's seat is reclaimable.
    s.fireAlarm(2_000);
    const lateOut = helloAs(s, 'cLate', 'pLate');
    expect(stateYouFor(lateOut, 'cLate')).toBe(0);
  });

  it('grace expiry hands off the host if the evicted player held the host slot', () => {
    const s = new MatchSession({ reconnectGraceMs: 1_000 });
    helloAs(s, 'c0', 'p0', 'Host');
    helloAs(s, 'c1', 'p1', 'Guest');
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

describe('MatchSession — illegal action error path', () => {
  it('out-of-turn discard returns a typed error to the offending connection', () => {
    const s = new MatchSession();
    helloAs(s, 'c0', 'p0');
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
