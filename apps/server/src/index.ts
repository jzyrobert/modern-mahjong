import { routePartykitRequest } from 'partyserver';
import { MatchRoom } from './MatchRoom.js';

export { MatchRoom };

export interface Env {
  MatchRoom: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(req, env as unknown as Record<string, unknown>)) ??
      new Response('Not found', { status: 404 })
    );
  },
};
