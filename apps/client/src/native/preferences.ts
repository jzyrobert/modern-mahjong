/**
 * Lazy-loaded `@capacitor/preferences` accessor. Native shells (iOS,
 * Android) get persistent storage that survives a WebView wipe; on web
 * the plugin import fails silently and these helpers no-op so callers
 * can rely on localStorage as the source of truth.
 *
 * IMPORTANT: Capacitor's plugin proxy implements `.then` (it forwards to
 * the native bridge), which means returning the proxy from a Promise
 * chain confuses JS into thinking the proxy is a thenable. JS then calls
 * `proxy.then(resolve, reject)` to chain, the proxy dispatches a `then`
 * RPC to the bridge, and on web it throws "Preferences.then() is not
 * implemented on web". So we keep the plugin in a closure variable and
 * never let it surface as a Promise resolution value.
 */
type PreferencesPlugin = typeof import('@capacitor/preferences').Preferences;

let prefs: PreferencesPlugin | null = null;
let loadOnce: Promise<void> | null = null;

export function ensurePrefsLoaded(): Promise<void> {
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

/**
 * Set a string preference. Resolves to true if the write went to native
 * storage, false if Preferences isn't available on this platform.
 */
export async function setPreference(key: string, value: string): Promise<boolean> {
  await ensurePrefsLoaded();
  if (!prefs) return false;
  await prefs.set({ key, value });
  return true;
}

/**
 * Read a string preference; returns null if the key is unset or the
 * Preferences plugin isn't available.
 */
export async function getPreference(key: string): Promise<string | null> {
  await ensurePrefsLoaded();
  if (!prefs) return null;
  const { value } = await prefs.get({ key });
  return value ?? null;
}
