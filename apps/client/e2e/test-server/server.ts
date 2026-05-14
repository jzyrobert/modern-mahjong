import { type IncomingMessage, createServer } from 'node:http';
import { MatchSession, type Outbound } from '@mahjong/match-session';
import type { ListLobbiesResponse } from '@mahjong/protocol';
import { type WebSocket, WebSocketServer } from 'ws';

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
 *
 * Also exposes `GET /lobbies` over plain HTTP so the lobby-browser
 * client path can be exercised against the same in-process sessions.
 * Each room's `publicSummary(code)` is aggregated on every request;
 * rooms with no human host return null and are filtered out. Lives on
 * the same port as the WS upgrades via an explicit `http.Server` that
 * the WSS attaches to in `noServer` mode.
 */
interface RoomCtx {
  session: MatchSession;
  /** Live connection id → ws so `Outbound.kind === 'sendTo'` can target one. */
  connections: Map<string, WebSocket>;
  // `setTimeout` returns `number` under the Expo/DOM-typed `tsconfig.json`
  // (extends `expo/tsconfig.base` → `lib: ["DOM", "ESNext"]`), even though
  // this file actually runs in Node — Node's setTimeout return value is
  // assignment-compatible with `number` at runtime, so we type it as
  // `ReturnType<typeof setTimeout>` to stay portable.
  alarmTimer: ReturnType<typeof setTimeout> | null;
}

export interface TestServerHandle {
  /** Bound port (useful when started with `port: 0` to grab a free one). */
  port: number;
  /** Close all sockets + the listening server. */
  close(): Promise<void>;
}

export function startTestServer(port = 0): Promise<TestServerHandle> {
  return new Promise((resolve, reject) => {
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

    // Plain HTTP server hosts both the WS upgrade path and the
    // `GET /lobbies` endpoint. The WSS attaches in `noServer` mode so
    // we control the upgrade handler ourselves.
    const httpServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/lobbies') {
        const lobbies = [];
        for (const [code, ctx] of rooms) {
          const summary = ctx.session.publicSummary(code);
          if (summary !== null) lobbies.push(summary);
        }
        lobbies.sort((a, b) => a.code.localeCompare(b.code));
        const body: ListLobbiesResponse = { lobbies };
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(body));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const wss = new WebSocketServer({ noServer: true });
    const acceptUpgrade = (req: IncomingMessage, matchCode: string) => {
      wss.handleUpgrade(req, req.socket, Buffer.alloc(0), (ws) => {
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
    };

    httpServer.on('upgrade', (req, socket, _head) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const m = /\/parties\/match-room\/([^/?]+)/.exec(url.pathname);
      if (!m) {
        socket.destroy();
        return;
      }
      acceptUpgrade(req, m[1] ?? '');
    });

    httpServer.on('error', reject);
    httpServer.listen(port, '127.0.0.1', () => {
      const addr = httpServer.address();
      if (typeof addr === 'object' && addr !== null) {
        resolve({
          port: addr.port,
          close: () =>
            new Promise<void>((done) => {
              for (const ctx of rooms.values()) {
                if (ctx.alarmTimer) clearTimeout(ctx.alarmTimer);
                for (const ws of ctx.connections.values()) ws.terminate();
              }
              wss.close();
              httpServer.close(() => done());
            }),
        });
      } else {
        reject(new Error('http.Server.address() returned non-object'));
      }
    });
  });
}
