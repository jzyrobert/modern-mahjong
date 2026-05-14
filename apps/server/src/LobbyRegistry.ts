import type { ListLobbiesResponse, LobbySummary } from '@mahjong/protocol';

/**
 * Singleton Durable Object that tracks public summaries of every live
 * match room so the lobby-browser endpoint can return them in one
 * request. Lives separately from the per-match `MatchRoom` DOs so
 * `GET /lobbies` doesn't have to fan out across an unbounded
 * namespace.
 *
 * State is intentionally in-memory only: if Cloudflare evicts this
 * DO, `MatchRoom`s re-register on their next lobby broadcast (every
 * seat-change / phase-change / chat / etc. triggers one). The
 * 5-minute staleness cap evicts orphaned entries from a `MatchRoom`
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

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/register') {
      const body = (await req.json()) as { code?: string; summary?: LobbySummary };
      if (typeof body.code !== 'string' || !body.summary) {
        return new Response('bad body', { status: 400 });
      }
      this.entries.set(body.code, { summary: body.summary, updatedAt: Date.now() });
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/unregister') {
      const body = (await req.json()) as { code?: string };
      if (typeof body.code !== 'string') return new Response('bad body', { status: 400 });
      this.entries.delete(body.code);
      return new Response('ok');
    }
    if (req.method === 'GET' && url.pathname === '/list') {
      const now = Date.now();
      // Lazy-evict stale entries on read so a long-quiet room doesn't
      // linger in the list. Re-listing is cheap; this is the only
      // sweep — the registry itself doesn't run timers.
      for (const [code, entry] of this.entries) {
        if (now - entry.updatedAt > STALE_MS) this.entries.delete(code);
      }
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
