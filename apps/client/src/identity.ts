/**
 * Per-device durable identity. Generated on first launch and persisted to
 * `localStorage`.
 *
 * On native (iOS/Android Expo build) `localStorage` is provided by the
 * `expo-sqlite/localStorage/install` polyfill imported once at app
 * startup — this gives durable storage that survives WebView wipes and
 * app reinstalls without needing a separate native-preferences mirror.
 * The display name is independently editable any time.
 *
 * SSR: Expo Router's static export (`web.output: "static"`) renders every
 * route in Node, where `localStorage` is not defined. Every accessor
 * here must therefore tolerate a missing store — an unguarded
 * `localStorage.getItem` from a `useState` lazy initialiser was what
 * threw inside the `/` route's Suspense boundary and made React mark it
 * client-rendered (`<!--$!-->`, React error #419 on every page load).
 * With no store we return a transient, non-persisted value; the client
 * re-reads the real one after hydration.
 */

const ID_KEY = 'mahjong.playerId';
const NAME_KEY = 'mahjong.displayName';

/** True when a `localStorage` implementation exists (browser, or the
 *  `expo-sqlite/localStorage/install` polyfill on native). False during
 *  static rendering in Node. */
function hasStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

export function getPlayerId(): string {
  if (!hasStorage()) return newPlayerId();
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = newPlayerId();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

/**
 * Generate a UUID-v4-shaped ID. RN's Hermes runtime doesn't expose
 * `globalThis.crypto.randomUUID`, so the legacy `crypto.randomUUID()`
 * call from the web build doesn't work here. `Math.random` is fine
 * since we don't need cryptographic strength (these IDs identify
 * matches / players locally).
 *
 * Exported so other modules that need a local-only id (e.g. the
 * replay recorder) don't have to copy-paste the regex.
 */
export function newRandomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const newPlayerId = newRandomId;

/**
 * Persisted display name, minting (and persisting) a random one on first
 * launch. Returns `''` when no store exists (static render) so the server
 * never bakes a random name into the HTML — see `useIsHydrated` for how
 * the lobby defers reading this until the client is hydrated.
 */
export function getDisplayName(): string {
  if (!hasStorage()) return '';
  return localStorage.getItem(NAME_KEY) ?? randomName();
}

export function setDisplayName(name: string): void {
  if (!hasStorage()) return;
  const trimmed = name.slice(0, 32);
  localStorage.setItem(NAME_KEY, trimmed);
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
