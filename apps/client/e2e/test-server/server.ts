import { type WebSocket, WebSocketServer } from 'ws';
import { MatchSession, type Outbound } from '../../../../apps/server/src/MatchSession.js';

/**
 * In-process test-only WebSocket server that wraps the real `MatchSession`
 * class so multi-player e2e flows can run against the production protocol
 * without needing wrangler/Cloudflare workers in CI. The browser pages
 * connect via `ws://127.0.0.1:<port>/parties/match-room/<code>?...` —
 * the same URL shape `createOnlineTransport` uses against the production
 * partyserver.
 *
 * One `MatchSession` is allocated per match-code prefix in the URL.
 * Sessions live for the lifetime of the test server (no persistence —
 * tests should use a fresh server per test or per test file).
 */
interface RoomCtx {
  session: MatchSession;
  /** Live connection id → ws so `Outbound.kind === 'sendTo'` can target one. */
  connections: Map<string, WebSocket>;
  alarmTimer: NodeJS.Timeout | null;
}

export interface TestServerHandle {
  /** Bound port (useful when started with `port: 0` to grab a free one). */
  port: number;
  /** Close all sockets + the listening server. */
  close(): Promise<void>;
}

export function startTestServer(port = 0): Promise<TestServerHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, host: '127.0.0.1' });
    const rooms = new Map<string, RoomCtx>();
    let nextConnId = 1;

    const getOrCreate = (matchCode: string): RoomCtx => {
      let ctx = rooms.get(matchCode);
      if (!ctx) {
        ctx = { session: new MatchSession(), connections: new Map(), alarmTimer: null };
        rooms.set(matchCode, ctx);
      }
      return ctx;
    };

    const dispatch = (ctx: RoomCtx, outs: Outbound[]): void => {
      for (const out of outs) {
        if (out.kind === 'sendTo') {
          ctx.connections.get(out.connectionId)?.send(JSON.stringify(out.msg));
        } else if (out.kind === 'broadcast') {
          const payload = JSON.stringify(out.msg);
          for (const ws of ctx.connections.values()) ws.send(payload);
        } else if (out.kind === 'closeConnection') {
          ctx.connections.get(out.connectionId)?.close();
        } else if (out.kind === 'scheduleAlarm') {
          if (ctx.alarmTimer) clearTimeout(ctx.alarmTimer);
          const delay = Math.max(0, out.deadlineMs - Date.now());
          ctx.alarmTimer = setTimeout(() => {
            ctx.alarmTimer = null;
            dispatch(ctx, ctx.session.fireAlarm(Date.now()));
          }, delay);
        }
      }
    };

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const m = /\/parties\/match-room\/([^/?]+)/.exec(url.pathname);
      if (!m) {
        ws.close();
        return;
      }
      const matchCode = m[1] ?? '';
      const connectionId = `c${nextConnId++}`;
      const ctx = getOrCreate(matchCode);
      ctx.connections.set(connectionId, ws);

      ws.on('message', (data) => {
        let msg: unknown;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        dispatch(ctx, ctx.session.applyClientMessage(connectionId, msg));
      });

      ws.on('close', () => {
        ctx.connections.delete(connectionId);
        dispatch(ctx, ctx.session.detachConnection(connectionId, Date.now()));
      });
    });

    wss.on('error', reject);
    wss.on('listening', () => {
      const addr = wss.address();
      if (typeof addr === 'object' && addr !== null) {
        resolve({
          port: addr.port,
          close: () =>
            new Promise<void>((done) => {
              for (const ctx of rooms.values()) {
                if (ctx.alarmTimer) clearTimeout(ctx.alarmTimer);
                for (const ws of ctx.connections.values()) ws.terminate();
              }
              wss.close(() => done());
            }),
        });
      } else {
        reject(new Error('WebSocketServer.address() returned non-object'));
      }
    });
  });
}
