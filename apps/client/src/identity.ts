/**
 * Per-device durable identity. Generated on first launch and persisted to
 * localStorage AND `@capacitor/preferences`. The display name is
 * independently editable any time.
 *
 * iOS WebViews aggressively evict localStorage under storage pressure, so
 * `hydrateIdentity()` (called at app startup) reseeds localStorage from
 * native Preferences when the WebView has been wiped. Web builds where
 * the Preferences plugin import fails silently fall back to localStorage
 * only.
 */

const ID_KEY = 'mahjong.playerId';
const NAME_KEY = 'mahjong.displayName';

type PreferencesPlugin = typeof import('@capacitor/preferences').Preferences;

// IMPORTANT: Capacitor's plugin proxy implements `.then` (it forwards to the
// native bridge), which means returning the proxy from a Promise chain
// confuses JS into thinking the proxy is a thenable. JS then calls
// `proxy.then(resolve, reject)` to chain, the proxy dispatches a `then` RPC
// to the bridge, and on web it throws "Preferences.then() is not implemented
// on web". So we keep the plugin in a closure variable and never let it
// surface as a Promise resolution value.
let prefs: PreferencesPlugin | null = null;
let loadOnce: Promise<void> | null = null;

function ensurePrefsLoaded(): Promise<void> {
  if (!loadOnce) {
    loadOnce = (async () => {
      try {
        const m = await import('@capacitor/preferences');
        prefs = m.Preferences;
      } catch {
        /* plugin missing on this platform — localStorage is the only persistence */
      }
    })();
  }
  return loadOnce;
}

export function getPlayerId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
    void mirrorToPreferences(ID_KEY, id);
  }
  return id;
}

export function getDisplayName(): string {
  return localStorage.getItem(NAME_KEY) ?? randomName();
}

export function setDisplayName(name: string): void {
  const trimmed = name.slice(0, 32);
  localStorage.setItem(NAME_KEY, trimmed);
  void mirrorToPreferences(NAME_KEY, trimmed);
}

/**
 * Read identity from native Preferences and seed localStorage with any
 * values it's missing — and conversely, push localStorage values into
 * Preferences when Preferences is empty (e.g., first launch after a web
 * → installed-app upgrade). Idempotent. No-ops on web where the plugin
 * isn't available.
 *
 * Call once at app startup before the first render so the lobby's
 * controlled inputs see a stable initial value.
 */
export async function hydrateIdentity(): Promise<void> {
  await ensurePrefsLoaded();
  if (!prefs) return;
  await syncKey(ID_KEY);
  await syncKey(NAME_KEY);
}

async function syncKey(key: string): Promise<void> {
  if (!prefs) return;
  const local = localStorage.getItem(key);
  const stored = (await prefs.get({ key })).value;
  if (local && !stored) {
    await prefs.set({ key, value: local });
  } else if (!local && stored) {
    localStorage.setItem(key, stored);
  }
}

async function mirrorToPreferences(key: string, value: string): Promise<void> {
  await ensurePrefsLoaded();
  if (!prefs) return;
  await prefs.set({ key, value });
}

function randomName(): string {
  const adjectives = ['Quick', 'Lucky', 'Silent', 'Bold', 'Calm', 'Wild', 'Sharp', 'Bright'];
  const animals = ['Crane', 'Tiger', 'Phoenix', 'Dragon', 'Carp', 'Sparrow', 'Fox', 'Bear'];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)]!;
  const b = animals[Math.floor(Math.random() * animals.length)]!;
  const name = `${a} ${b}`;
  setDisplayName(name);
  return name;
}
