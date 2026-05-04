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
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
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
