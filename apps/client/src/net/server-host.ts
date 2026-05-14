import Constants from 'expo-constants';

/**
 * Resolve the online-match server URL with this precedence:
 * 1. **Web only** — `?serverUrl=…` query string. Used by the
 *    Playwright multi-player e2e (`apps/client/e2e/online-multi-
 *    player.spec.ts`) to point the browser at an in-process test
 *    server. Native has no URL bar so this is a no-op there.
 * 2. `EXPO_PUBLIC_SERVER_URL` — runtime env, baked at build time but
 *    overridable via `.env`. CI sets this from a GitHub secret;
 *    local dev can override per-shell. Wins over the static
 *    `extra.serverUrl` so staging / preview deploys can target a
 *    different Worker without forking `app.json`.
 * 3. Dev fallback: derive the host from Expo's dev-server `hostUri`
 *    (LAN IP, e.g. `192.168.1.5:8081` → `http://192.168.1.5:8787`).
 *    Reaches the dev wrangler server from both Android emulator and
 *    a physical device on the same network, as long as wrangler is
 *    bound to `0.0.0.0` (see `apps/server/package.json`'s `dev` script).
 * 4. `expo-constants` `extra.serverUrl` — canonical production
 *    Worker URL baked into `app.json`. Acts as a safety net when
 *    `EXPO_PUBLIC_SERVER_URL` ends up unset / misconfigured (e.g.
 *    secret pointing at the Pages URL by mistake), and as the
 *    default for native release builds where neither env nor
 *    hostUri is available.
 * 5. Last-resort `http://localhost:8787` — only useful in iOS simulator
 *    or with `adb reverse tcp:8787 tcp:8787` configured.
 */
export function resolveServerHost(): string {
  if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
    const fromQuery = new URLSearchParams(window.location.search).get('serverUrl');
    if (fromQuery) return fromQuery;
  }
  if (process.env.EXPO_PUBLIC_SERVER_URL) return process.env.EXPO_PUBLIC_SERVER_URL;
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:8787`;
    }
  }
  const extra = Constants.expoConfig?.extra as { serverUrl?: string } | undefined;
  if (extra?.serverUrl) return extra.serverUrl;
  return 'http://localhost:8787';
}
