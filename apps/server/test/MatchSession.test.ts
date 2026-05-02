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

describe('MatchSession — hello + lobby', () => {
  it('first hello assigns seat 0 and becomes host', () => {
    const s = new MatchSession();
    const out = s.applyClientMessage('c1', {
      t: 'hello',
      playerId: 'p1',
      displayName: 'Alice',
      matchCode: 'ABCDE',
    });
    const stateMsg = pickSends(out, 'c1').find((m) => m.t === 'state');
    expect(stateMsg && stateMsg.t === 'state' && stateMsg.you).toBe(0);

    const lobby = pickBroadcasts(out).find((m) => m.t === 'lobby');
    expect(lobby?.t).toBe('lobby');
    if (lobby?.t === 'lobby') expect(lobby.host).toBe('p1');
  });

  it('reconnect with same playerId restores the original seat', () => {
    const s = new MatchSession();
    s.applyClientMessage('c1', {
      t: 'hello',
      playerId: 'p1',
      displayName: 'Alice',
      matchCode: 'ABCDE',
    });
    s.detachConnection('c1');
    const out = s.applyClientMessage('c2', {
      t: 'hello',
      playerId: 'p1',
      displayName: 'Alice',
      matchCode: 'ABCDE',
    });
    const stateMsg = pickSends(out, 'c2').find((m) => m.t === 'state');
    expect(stateMsg && stateMsg.t === 'state' && stateMsg.you).toBe(0);
  });

  it('new playerIds get the next available seats', () => {
    const s = new MatchSession();
    const out0 = s.applyClientMessage('c0', {
      t: 'hello',
      playerId: 'p0',
      displayName: 'A',
      matchCode: 'X',
    });
    const out1 = s.applyClientMessage('c1', {
      t: 'hello',
      playerId: 'p1',
      displayName: 'B',
      matchCode: 'X',
    });
    const out2 = s.applyClientMessage('c2', {
      t: 'hello',
      playerId: 'p2',
      displayName: 'C',
      matchCode: 'X',
    });
    const out3 = s.applyClientMessage('c3', {
      t: 'hello',
      playerId: 'p3',
      displayName: 'D',
      matchCode: 'X',
    });
    const seats = [out0, out1, out2, out3].map((out, i) => {
      const m = pickSends(out, `c${i}`).find((x) => x.t === 'state');
      return m && m.t === 'state' ? m.you : null;
    });
    expect(seats).toEqual([0, 1, 2, 3]);
  });

  it('rejects a fifth player when the room is full', () => {
    const s = new MatchSession();
    for (let i = 0; i < 4; i++) {
      s.applyClientMessage(`c${i}`, {
        t: 'hello',
        playerId: `p${i}`,
        displayName: `${i}`,
        matchCode: 'X',
      });
    }
    const out = s.applyClientMessage('c4', {
      t: 'hello',
      playerId: 'p4',
      displayName: '4',
      matchCode: 'X',
    });
    const errs = pickSends(out, 'c4').filter((m) => m.t === 'error');
    expect(errs[0]?.t).toBe('error');
    expect(errs[0]?.t === 'error' && errs[0].code).toBe('FULL');
    expect(out.some((o) => o.kind === 'closeConnection')).toBe(true);
  });
});

describe('MatchSession — bot-driven hand to completion', () => {
  it('four bots play a full hand and end up in a resolved state', () => {
    const s = new MatchSession();
    s.seatBot(0, heuristicBot);
    s.seatBot(1, heuristicBot);
    s.seatBot(2, simpleBot);
    s.seatBot(3, passiveBot);

    // Kick off a hand directly via an action message.
    const startOut = s.applyClientMessage('host', {
      t: 'action',
      action: { t: 'startHand', seed: 42, dealer: 0 },
    });
    expect(startOut.length).toBeGreaterThan(0);

    // Pump the alarm a few times; each call drains one claim window
    // and may chain into bot turns. Bots also drive their own actions
    // synchronously when an alarm fires.
    let safety = 0;
    while (s.getState().phase !== 'resolved' && safety < 200) {
      s.fireAlarm(Date.now());
      safety++;
    }
    expect(s.getState().phase).toBe('resolved');
  });
});

describe('MatchSession — illegal action error path', () => {
  it('out-of-turn discard returns a typed error to the offending connection', () => {
    const s = new MatchSession();
    s.applyClientMessage('c0', {
      t: 'hello',
      playerId: 'p0',
      displayName: 'A',
      matchCode: 'X',
    });
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
