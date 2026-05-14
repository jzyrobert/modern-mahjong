import { routePartykitRequest } from 'partyserver';
import { LobbyRegistry } from './LobbyRegistry.js';
import { MatchRoom } from './MatchRoom.js';

export { MatchRoom, LobbyRegistry };

export interface Env {
  MatchRoom: DurableObjectNamespace;
  LobbyRegistry: DurableObjectNamespace;
}

const CORS_PREFLIGHT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
} as const;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Public lobby-browser endpoint. Proxies to the singleton
    // `LobbyRegistry` DO, which keeps the live summary map. CORS is
    // open so the static client hosted on a different origin (Pages,
    // LAN device) can read it.
    if (url.pathname === '/lobbies' && (req.method === 'GET' || req.method === 'OPTIONS')) {
      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_PREFLIGHT_HEADERS });
      }
      const id = env.LobbyRegistry.idFromName('global');
      const stub = env.LobbyRegistry.get(id);
      // The registry's `/list` handler does the real work + sets CORS.
      return stub.fetch('http://internal/list');
    }
    return (
      (await routePartykitRequest(req, env as unknown as Record<string, unknown>)) ??
      new Response('Not found', { status: 404 })
    );
  },
};
