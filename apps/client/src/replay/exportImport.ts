import * as Clipboard from 'expo-clipboard';
import { saveRecord } from './storage';
import type { ReplayEnvelope, ReplayRecord } from './types';

/**
 * Copy a `ReplayRecord` to the clipboard as JSON. Returns the byte
 * length of the payload so the caller can show "Copied N KB" feedback.
 */
export async function exportRecordToClipboard(record: ReplayRecord): Promise<number> {
  const json = JSON.stringify({ version: 1, record } satisfies ReplayEnvelope);
  await Clipboard.setStringAsync(json);
  return json.length;
}

export type ImportResult = { kind: 'ok'; record: ReplayRecord } | { kind: 'error'; error: string };

/**
 * Try to parse the user's pasted JSON as a replay. On success, assigns a
 * fresh id (so duplicates don't collide with anything already saved)
 * and writes to storage. Lightweight envelope validation only — engine
 * state shape is enforced by playback rendering.
 */
export function tryImportRecord(text: string, quota: number): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { kind: 'error', error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { kind: 'error', error: 'Top level must be a JSON object' };
  }
  const env = parsed as Partial<ReplayEnvelope>;
  if (env.version !== 1) {
    return { kind: 'error', error: `Unsupported replay version: ${String(env.version)}` };
  }
  const rec = env.record;
  if (!rec || typeof rec !== 'object') {
    return { kind: 'error', error: 'Missing `record` field' };
  }
  if (!Array.isArray(rec.frames) || rec.frames.length === 0) {
    return { kind: 'error', error: 'Replay has no frames' };
  }
  if (!rec.header || typeof rec.header !== 'object') {
    return { kind: 'error', error: 'Missing `header`' };
  }
  if (!Array.isArray(rec.bookmarks)) {
    return { kind: 'error', error: 'Missing `bookmarks`' };
  }
  // Re-id so an imported replay never collides with an existing one.
  const fresh: ReplayRecord = {
    ...rec,
    header: { ...rec.header, id: newReplayId() },
  };
  if (!saveRecord(fresh, quota)) {
    return { kind: 'error', error: 'Storage full — clear old replays first' };
  }
  return { kind: 'ok', record: fresh };
}

function newReplayId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
