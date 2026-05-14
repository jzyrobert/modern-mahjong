/**
 * Re-create info captured every time someone joins a match. The
 * provider mirrors this into both React state (so route components
 * can reconstruct the URL on reload — `/match?code=…&host=…` or
 * `?solo=1`) and a parallel ref (so callbacks that need the latest
 * value can read it without forcing a re-render).
 *
 * Lives in its own module so the `use-wire-router` and `use-reconnect`
 * hooks can import the type + helper without pulling in
 * `transport-context.tsx`'s React surface.
 */
export type JoinInfo =
  | { kind: 'online'; code: string; spectate?: boolean }
  | { kind: 'lan'; hostUrl: string; code: string }
  | { kind: 'solo' };

/** The match code we stamp into the recorder header for a given join.
 *  Solo sessions don't have a server-assigned code, so they all share
 *  the sentinel `'SOLO'`. */
export function matchCodeFor(join: JoinInfo): string {
  return join.kind === 'solo' ? 'SOLO' : join.code;
}
