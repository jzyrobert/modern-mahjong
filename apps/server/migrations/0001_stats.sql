-- Play statistics (D1 `STATS` binding). Written by `src/stats.ts` from
-- the client's fire-and-forget beacons; read back by `/stats/summary`.
-- Geography comes from Cloudflare's `request.cf` at ingest — no IP
-- address is stored. `day` is the UTC 'YYYY-MM-DD' of `ts` so the
-- dashboard's range filters hit an index instead of computing dates.

-- One row per player per UTC day the app was opened (daily actives).
CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL,
  player TEXT NOT NULL,
  ts INTEGER NOT NULL,
  platform TEXT,
  app_version TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  continent TEXT,
  timezone TEXT,
  PRIMARY KEY (day, player)
) WITHOUT ROWID;

-- One row per match a client took part in (an online room with four
-- humans is four rows sharing `room`). Tutorials land here with
-- mode 'tutorial' and the lesson id in `room`.
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  mode TEXT NOT NULL,
  room TEXT,
  humans INTEGER,
  bots INTEGER,
  bot_kinds TEXT,
  platform TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  continent TEXT,
  day TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  hands_started INTEGER NOT NULL DEFAULT 0,
  hands_finished INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS matches_day ON matches(day);

-- One row per finished hand, from the reporting client's seat.
-- `winner` is relative to the reporter: 'me' | 'human' | 'bot' | NULL
-- (drawn game). `patterns` is a JSON array of the faan pattern names.
CREATE TABLE IF NOT EXISTS hands (
  id INTEGER PRIMARY KEY,
  match_id TEXT NOT NULL,
  day TEXT NOT NULL,
  ts INTEGER NOT NULL,
  mode TEXT NOT NULL,
  room TEXT,
  seed INTEGER,
  hand_no INTEGER,
  outcome TEXT NOT NULL,
  winner TEXT,
  self_draw INTEGER,
  faan INTEGER,
  patterns TEXT,
  duration_ms INTEGER,
  discards INTEGER,
  country TEXT
);
CREATE INDEX IF NOT EXISTS hands_day ON hands(day);
