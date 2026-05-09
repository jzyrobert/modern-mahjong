import type { ReplayEnvelope, ReplayHeader, ReplayRecord } from './types';

/**
 * localStorage-backed replay persistence.
 *
 * One key per record (`mj.replay.v1.<id>`) plus an index key
 * (`mj.replay.v1.index`) holding the list of headers in
 * most-recent-first order. We split header from full record so the
 * library route can list ~50 entries without paying the cost of
 * deserialising every multi-megabyte frame array.
 *
 * On native, `expo-sqlite/localStorage/install` polyfills localStorage
 * onto SQLite, so capacity is effectively unbounded. On web we share
 * the origin's ~5–10 MB cap with everything else; quota errors surface
 * via `saveRecord` returning `false` so the caller can show the user
 * a "storage full — clear old replays" toast. Quota-based pruning
 * keeps the total bounded so steady-state usage doesn't drift over.
 */

const INDEX_KEY = 'mj.replay.v1.index';
const RECORD_PREFIX = 'mj.replay.v1.';

interface Index {
  version: 1;
  headers: ReplayHeader[];
}

function readIndex(): Index {
  if (typeof localStorage === 'undefined') return { version: 1, headers: [] };
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return { version: 1, headers: [] };
    const parsed = JSON.parse(raw) as Partial<Index>;
    if (parsed.version !== 1 || !Array.isArray(parsed.headers)) {
      return { version: 1, headers: [] };
    }
    return parsed as Index;
  } catch {
    return { version: 1, headers: [] };
  }
}

function writeIndex(index: Index): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

function recordKey(id: string): string {
  return `${RECORD_PREFIX}${id}`;
}

/**
 * Returns headers most-recent-first. Cheap — only reads the index, not
 * the frame blobs.
 */
export function listHeaders(): ReplayHeader[] {
  return readIndex().headers;
}

export function loadRecord(id: string): ReplayRecord | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(recordKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReplayEnvelope>;
    if (parsed.version !== 1 || !parsed.record) return null;
    return parsed.record;
  } catch {
    return null;
  }
}

/**
 * Insert or update a record. On insert, prunes the oldest entries past
 * `quota`. Returns `false` when localStorage rejected the write
 * (typically web quota exceeded) so the caller can surface an error.
 */
export function saveRecord(record: ReplayRecord, quota: number): boolean {
  if (typeof localStorage === 'undefined') return false;
  const envelope: ReplayEnvelope = { version: 1, record };
  let payload: string;
  try {
    payload = JSON.stringify(envelope);
  } catch {
    return false;
  }
  try {
    localStorage.setItem(recordKey(record.header.id), payload);
  } catch {
    return false;
  }
  const index = readIndex();
  const filtered = index.headers.filter((h) => h.id !== record.header.id);
  filtered.unshift(record.header);
  // Quota prune: drop oldest beyond the cap.
  let pruned = filtered;
  if (filtered.length > quota) {
    pruned = filtered.slice(0, quota);
    for (const drop of filtered.slice(quota)) {
      try {
        localStorage.removeItem(recordKey(drop.id));
      } catch {
        /* silent — best-effort cleanup */
      }
    }
  }
  return writeIndex({ version: 1, headers: pruned });
}

export function deleteRecord(id: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(recordKey(id));
  } catch {
    /* silent */
  }
  const index = readIndex();
  const filtered = index.headers.filter((h) => h.id !== id);
  if (filtered.length !== index.headers.length) {
    writeIndex({ version: 1, headers: filtered });
  }
}

export function clearAll(): void {
  if (typeof localStorage === 'undefined') return;
  const index = readIndex();
  for (const h of index.headers) {
    try {
      localStorage.removeItem(recordKey(h.id));
    } catch {
      /* silent */
    }
  }
  writeIndex({ version: 1, headers: [] });
}

/**
 * Sum of payload bytes across stored records. Cheap-ish — reads each
 * record string but doesn't parse them. Used by the settings panel to
 * show "12.4 MB used" without an O(M) JSON.parse pass.
 */
export function approximateStorageBytes(): number {
  if (typeof localStorage === 'undefined') return 0;
  const index = readIndex();
  let total = 0;
  for (const h of index.headers) {
    const raw = localStorage.getItem(recordKey(h.id));
    if (raw) total += raw.length;
  }
  return total;
}
