import type { ListLobbiesResponse, LobbySummary } from '@mahjong/protocol';

/**
 * Singleton Durable Object that tracks public summaries of every live
 * match room so the lobby-browser endpoint can return them in one
 * request. Lives separately from the per-match `MatchRoom` DOs so
 * `GET /lobbies` doesn't have to fan out across an unbounded
 * namespace.
 *
 * State is persisted to `ctx.storage` so the registry survives
 * isolate eviction — without this, CF evicts the DO after ~10s of
 * idleness (no WebSockets keep it warm) and the next `/list` returns
 * an empty map until a `MatchRoom` happens to push a *changed*
 * summary. `MatchRoom`'s diff-dedupe means a waiting lobby with a
 * stable summary would never re-register on its own. The 5-minute
 * staleness cap still evicts orphaned entries from a `MatchRoom`
 * that dropped without sending an `unregister`.
 *
 * Routes:
 *   POST /register   body `{ code, summary }` — upsert.
 *   POST /unregister body `{ code }`         — remove.
 *   GET  /list       — return `{ lobbies: LobbySummary[] }`.
 */

const STALE_MS = 5 * 60 * 1000;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
} as const;

interface Entry {
  summary: LobbySummary;
  updatedAt: number;
}

export class LobbyRegistry implements DurableObject {
  private entries = new Map<string, Entry>();

  constructor(private state: DurableObjectState) {
    // Hydrate from persistent storage on isolate start so an eviction
    // doesn't silently empty the lobby list. `blockConcurrencyWhile`
    // holds incoming fetches until the map is populated.
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.list<Entry>();
      for (const [code, entry] of stored) this.entries.set(code, entry);
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/register') {
      const body = (await req.json()) as { code?: string; summary?: LobbySummary };
      if (typeof body.code !== 'string' || !body.summary) {
        return new Response('bad body', { status: 400 });
      }
      const entry: Entry = { summary: body.summary, updatedAt: Date.now() };
      this.entries.set(body.code, entry);
      await this.state.storage.put(body.code, entry);
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/unregister') {
      const body = (await req.json()) as { code?: string };
      if (typeof body.code !== 'string') return new Response('bad body', { status: 400 });
      this.entries.delete(body.code);
      await this.state.storage.delete(body.code);
      return new Response('ok');
    }
    if (req.method === 'GET' && url.pathname === '/list') {
      const now = Date.now();
      // Lazy-evict stale entries on read so a long-quiet room doesn't
      // linger in the list. Re-listing is cheap; this is the only
      // sweep — the registry itself doesn't run timers.
      const stale: string[] = [];
      for (const [code, entry] of this.entries) {
        if (now - entry.updatedAt > STALE_MS) {
          this.entries.delete(code);
          stale.push(code);
        }
      }
      if (stale.length > 0) await this.state.storage.delete(stale);
      const body: ListLobbiesResponse = {
        lobbies: [...this.entries.values()]
          .map((e) => e.summary)
          // Sort by match code so the client-side render stays
          // consistent across polls — arbitrary but stable.
          .sort((a, b) => a.code.localeCompare(b.code)),
      };
      return new Response(JSON.stringify(body), {
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        },
      });
    }
    return new Response('not found', { status: 404 });
  }
}
