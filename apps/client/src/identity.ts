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

import { ensurePrefsLoaded, getPreference, setPreference } from './native/preferences.js';

const ID_KEY = 'mahjong.playerId';
const NAME_KEY = 'mahjong.displayName';

export function getPlayerId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
    void setPreference(ID_KEY, id);
  }
  return id;
}

export function getDisplayName(): string {
  return localStorage.getItem(NAME_KEY) ?? randomName();
}

export function setDisplayName(name: string): void {
  const trimmed = name.slice(0, 32);
  localStorage.setItem(NAME_KEY, trimmed);
  void setPreference(NAME_KEY, trimmed);
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
  await syncKey(ID_KEY);
  await syncKey(NAME_KEY);
}

async function syncKey(key: string): Promise<void> {
  const local = localStorage.getItem(key);
  const stored = await getPreference(key);
  if (local && !stored) {
    await setPreference(key, local);
  } else if (!local && stored) {
    localStorage.setItem(key, stored);
  }
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
