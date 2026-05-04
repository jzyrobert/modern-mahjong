/**
 * Per-device durable identity. Generated on first launch and persisted to
 * `localStorage`.
 *
 * On native (iOS/Android Expo build) `localStorage` is provided by the
 * `expo-sqlite/localStorage/install` polyfill imported once at app
 * startup — this gives durable storage that survives WebView wipes and
 * app reinstalls without needing a separate native-preferences mirror.
 * The display name is independently editable any time.
 */

const ID_KEY = 'mahjong.playerId';
const NAME_KEY = 'mahjong.displayName';

export function getPlayerId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = newPlayerId();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

/**
 * Generate a UUID-v4-shaped ID. We don't need cryptographic strength
 * (this just identifies one device's player handle within a match
 * room), so a `Math.random`-based generator is fine. RN's Hermes
 * runtime doesn't expose `globalThis.crypto.randomUUID`, so the
 * legacy `crypto.randomUUID()` call from the web build doesn't work
 * here.
 */
function newPlayerId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getDisplayName(): string {
  return localStorage.getItem(NAME_KEY) ?? randomName();
}

export function setDisplayName(name: string): void {
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
