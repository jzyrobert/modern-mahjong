import { type StatsEvent, parseStatsEvent } from '@mahjong/protocol';
import { STATS_DASHBOARD_HTML } from './stats-dashboard.js';

/**
 * Play statistics on D1 (`STATS` binding, schema in
 * `migrations/0001_stats.sql`).
 *
 * - `POST /stats/event` — the client's fire-and-forget beacon. Body is
 *   a JSON `StatsEvent` sent as `text/plain` (a CORS "simple request",
 *   so browsers skip the preflight). Geography is stamped here from
 *   `request.cf`; the IP is never stored. The write runs under
 *   `waitUntil` so the response returns before D1 does.
 * - `GET /stats/summary?days=N` — aggregates for the dashboard, gated
 *   on `Authorization: Bearer <STATS_ADMIN_TOKEN>`. One D1 `batch`, so
 *   one round-trip however many panels the page shows.
 * - `GET /stats` — the dashboard page itself (static HTML; it asks for
 *   the token and calls `/stats/summary`).
 *
 * Every route is a no-op 503 until the binding / secret exist, so a
 * worker deployed without D1 keeps serving matches.
 */
export interface StatsEnv {
  STATS?: D1Database;
  STATS_ADMIN_TOKEN?: string;
}

const MAX_BODY_BYTES = 4096;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
} as const;

/** Returns a response for `/stats*` paths, or null for anything else. */
export async function handleStats(
  req: Request,
  env: StatsEnv,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (pathname !== '/stats' && !pathname.startsWith('/stats/')) return null;
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (pathname === '/stats/event' && req.method === 'POST') return ingest(req, env, ctx);
  if (pathname === '/stats/summary' && req.method === 'GET') return summary(req, env);
  if (pathname === '/stats' && req.method === 'GET') {
    return new Response(STATS_DASHBOARD_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return new Response('Not found', { status: 404, headers: CORS });
}

async function ingest(req: Request, env: StatsEnv, ctx: ExecutionContext): Promise<Response> {
  if (!env.STATS) return new Response(null, { status: 503, headers: CORS });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413, headers: CORS });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400, headers: CORS });
  }
  const parsed = parseStatsEvent(raw);
  if (!parsed.ok) return new Response(null, { status: 400, headers: CORS });
  const db = env.STATS;
  ctx.waitUntil(
    db
      .batch(statementsFor(db, parsed.event, geoOf(req), Date.now()))
      .then(() => undefined)
      .catch((e) => console.warn('stats write failed', e)),
  );
  return new Response(null, { status: 204, headers: CORS });
}

interface Geo {
  country: string | null;
  region: string | null;
  city: string | null;
  continent: string | null;
  timezone: string | null;
}

function geoOf(req: Request): Geo {
  const cf = (req as { cf?: Record<string, unknown> }).cf ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v.slice(0, 64) : null);
  return {
    country: str(cf.country),
    region: str(cf.region),
    city: str(cf.city),
    continent: str(cf.continent),
    timezone: str(cf.timezone),
  };
}

/** UTC 'YYYY-MM-DD'. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Exported for the unit test: maps one event onto its D1 statements. */
export function statementsFor(
  db: D1Database,
  e: StatsEvent,
  geo: Geo,
  now: number,
): D1PreparedStatement[] {
  const day = dayOf(now);
  const appVersion = e.appVersion ?? null;
  if (e.k === 'visit') {
    return [
      db
        .prepare(
          `INSERT OR IGNORE INTO visits
             (day, player, ts, platform, app_version, country, region, city, continent, timezone)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          day,
          e.player,
          now,
          e.platform,
          appVersion,
          geo.country,
          geo.region,
          geo.city,
          geo.continent,
          geo.timezone,
        ),
    ];
  }
  const started = e.k === 'handStart' ? 1 : 0;
  const finished = e.k === 'handEnd' ? 1 : 0;
  const upsertMatch = db
    .prepare(
      `INSERT INTO matches
         (id, player, mode, room, humans, bots, bot_kinds, platform,
          country, region, city, continent, day, started_at, last_at,
          hands_started, hands_finished)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_at = excluded.last_at,
         hands_started = hands_started + excluded.hands_started,
         hands_finished = hands_finished + excluded.hands_finished`,
    )
    .bind(
      e.match,
      e.player,
      e.mode,
      e.room ?? null,
      e.humans ?? null,
      e.bots ?? null,
      e.botKinds ? [...e.botKinds].sort().join(',') : null,
      e.platform,
      geo.country,
      geo.region,
      geo.city,
      geo.continent,
      day,
      now,
      now,
      started,
      finished,
    );
  if (e.k !== 'handEnd') return [upsertMatch];
  const insertHand = db
    .prepare(
      `INSERT INTO hands
         (match_id, day, ts, mode, room, seed, hand_no, outcome, winner,
          self_draw, faan, patterns, duration_ms, discards, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      e.match,
      day,
      now,
      e.mode,
      e.room ?? null,
      e.seed ?? null,
      e.handNo ?? null,
      e.outcome,
      e.winner ?? null,
      e.selfDraw === undefined ? null : e.selfDraw ? 1 : 0,
      e.faan ?? null,
      e.patterns ? JSON.stringify(e.patterns) : null,
      e.durationMs ?? null,
      e.discards ?? null,
      geo.country,
    );
  return [upsertMatch, insertHand];
}

/** Constant-time string compare so the token can't be probed by timing. */
function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// An online room is played by up to four reporting clients; a hand is
// counted once per (room, seed). Solo hands are one report each.
const UNIQUE_HAND = `CASE WHEN room IS NOT NULL AND mode IN ('online','lan')
  THEN mode || ':' || room || ':' || seed ELSE CAST(id AS TEXT) END`;

const SUMMARY_QUERIES = {
  players: 'SELECT COUNT(DISTINCT player) AS n FROM visits WHERE day >= ?1',
  newPlayers: `SELECT COUNT(*) AS n FROM
    (SELECT MIN(day) AS first FROM visits GROUP BY player) WHERE first >= ?1`,
  modes: `SELECT mode, COUNT(*) AS matches,
      COUNT(DISTINCT CASE WHEN mode IN ('online','lan') THEN room END) AS rooms,
      SUM(hands_finished = 0) AS abandoned,
      AVG(hands_finished) AS avgHands
    FROM matches WHERE day >= ?1 AND mode != 'tutorial' GROUP BY mode ORDER BY matches DESC`,
  hands: `SELECT mode, COUNT(*) AS reports, COUNT(DISTINCT ${UNIQUE_HAND}) AS hands,
      SUM(outcome = 'win') AS wins, SUM(self_draw = 1) AS selfDraws,
      AVG(CASE WHEN outcome = 'win' THEN faan END) AS avgFaan,
      AVG(duration_ms) AS avgDurationMs, AVG(discards) AS avgDiscards
    FROM hands WHERE day >= ?1 GROUP BY mode ORDER BY hands DESC`,
  dailyPlayers: 'SELECT day, COUNT(*) AS n FROM visits WHERE day >= ?1 GROUP BY day',
  dailyMatches: `SELECT day, COUNT(*) AS n FROM matches
    WHERE day >= ?1 AND mode != 'tutorial' GROUP BY day`,
  dailyHands: `SELECT day, COUNT(DISTINCT ${UNIQUE_HAND}) AS n FROM hands
    WHERE day >= ?1 GROUP BY day`,
  countryPlayers: `SELECT country, COUNT(DISTINCT player) AS n FROM visits
    WHERE day >= ?1 GROUP BY country`,
  countryMatches: `SELECT country, COUNT(*) AS n FROM matches
    WHERE day >= ?1 AND mode != 'tutorial' GROUP BY country`,
  countryHands: `SELECT country, COUNT(DISTINCT ${UNIQUE_HAND}) AS n FROM hands
    WHERE day >= ?1 GROUP BY country`,
  cities: `SELECT city, country, COUNT(DISTINCT player) AS n FROM visits
    WHERE day >= ?1 AND city IS NOT NULL GROUP BY city, country ORDER BY n DESC LIMIT 15`,
  platforms: `SELECT platform, COUNT(DISTINCT player) AS n FROM visits
    WHERE day >= ?1 GROUP BY platform ORDER BY n DESC`,
  soloOutcomes: `SELECT COALESCE(winner, 'draw') AS winner, SUM(self_draw = 1) AS selfDraws,
      COUNT(*) AS n FROM hands WHERE day >= ?1 AND mode = 'solo' GROUP BY winner`,
  faan: `SELECT faan, COUNT(*) AS n FROM hands
    WHERE day >= ?1 AND outcome = 'win' AND faan IS NOT NULL GROUP BY faan ORDER BY faan`,
  patterns: `SELECT p.value AS pattern, COUNT(*) AS n FROM hands, json_each(hands.patterns) AS p
    WHERE hands.day >= ?1 AND hands.patterns IS NOT NULL
    GROUP BY p.value ORDER BY n DESC LIMIT 20`,
  botMixes: `SELECT bot_kinds AS mix, COUNT(*) AS n FROM matches
    WHERE day >= ?1 AND mode = 'solo' AND bot_kinds IS NOT NULL
    GROUP BY bot_kinds ORDER BY n DESC LIMIT 8`,
  tutorials: `SELECT room AS lesson, COUNT(*) AS n, COUNT(DISTINCT player) AS players
    FROM matches WHERE day >= ?1 AND mode = 'tutorial' GROUP BY room ORDER BY n DESC`,
} as const;

async function summary(req: Request, env: StatsEnv): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  if (!env.STATS || !env.STATS_ADMIN_TOKEN) return json({ error: 'stats not configured' }, 503);
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!sameToken(token, env.STATS_ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401);

  const daysParam = Number(new URL(req.url).searchParams.get('days') ?? 30);
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(Math.round(daysParam), 1), 3650) : 30;
  const since = dayOf(Date.now() - (days - 1) * 86_400_000);
  const db = env.STATS;
  const keys = Object.keys(SUMMARY_QUERIES) as (keyof typeof SUMMARY_QUERIES)[];
  const results = await db.batch(keys.map((k) => db.prepare(SUMMARY_QUERIES[k]).bind(since)));
  const rows = Object.fromEntries(keys.map((k, i) => [k, results[i]?.results ?? []])) as Record<
    keyof typeof SUMMARY_QUERIES,
    Record<string, unknown>[]
  >;

  return json({
    days,
    since,
    players: Number(rows.players[0]?.n ?? 0),
    newPlayers: Number(rows.newPlayers[0]?.n ?? 0),
    modes: rows.modes,
    hands: rows.hands,
    daily: mergeByKey('day', {
      players: rows.dailyPlayers,
      matches: rows.dailyMatches,
      hands: rows.dailyHands,
    }),
    countries: mergeByKey('country', {
      players: rows.countryPlayers,
      matches: rows.countryMatches,
      hands: rows.countryHands,
    }),
    cities: rows.cities,
    platforms: rows.platforms,
    soloOutcomes: rows.soloOutcomes,
    faan: rows.faan,
    patterns: rows.patterns,
    botMixes: rows.botMixes,
    tutorials: rows.tutorials,
  });
}

/** Joins several `{ <key>, n }` row sets into one row per key. */
function mergeByKey(
  key: string,
  sets: Record<string, Record<string, unknown>[]>,
): Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>();
  for (const [name, rows] of Object.entries(sets)) {
    for (const row of rows) {
      const k = String(row[key] ?? 'unknown');
      const entry = merged.get(k) ?? { [key]: k };
      entry[name] = Number(row.n ?? 0);
      merged.set(k, entry);
    }
  }
  return [...merged.values()];
}
