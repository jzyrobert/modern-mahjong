import type { Action, Claim, Event, GameState, RuleConfig, Seat } from '@mahjong/game-logic';
import { z } from 'zod';

/**
 * Wire format between clients and the authoritative server (whether
 * a `partyserver` Durable Object online or a host's Expo app on the
 * LAN, via the embedded `expo-lan-server` HTTP+WS server).
 *
 * `Action` and `GameState` are intentionally re-used from the game-logic
 * package; we attach zod schemas only at the message-envelope level so the
 * server can fast-reject malformed payloads. Action validity beyond shape
 * is enforced by the engine reducer, not here.
 */

/**
 * Bot strategy identifier. Must stay in sync with the registry in
 * `@mahjong/bots`; declared here so the wire layer can validate it
 * without depending on the bots package.
 */
export const BOT_KINDS = ['simple', 'heuristic', 'passive'] as const;
export type BotKind = (typeof BOT_KINDS)[number];

/**
 * Canonical user-facing label for each bot strategy. The internal kind
 * names are an implementation detail of `@mahjong/bots` (`passive` was
 * named for its docstring, not for what users want to see in a lobby
 * card). All UI surfaces — server `botDisplayName`, solo lobby
 * projection, picker text, home-page blurb — read from this map so the
 * label stays in lockstep.
 */
export const BOT_LABELS = {
  passive: 'Easy',
  simple: 'Standard',
  heuristic: 'Smart',
} as const satisfies Record<BotKind, string>;

/**
 * User-facing "this seat is a bot" status label — e.g. `Bot (Easy)`.
 * Pre-2026-05 this also served as the bot's displayName, so the only
 * thing distinguishing one bot from another in the lobby/scoreboard
 * was their difficulty. Now bots are assigned a human-like name from
 * `BOT_NAME_POOL` at seat time (see `pickRandomBotName`) and this
 * label is rendered as a chip / inline marker beside that name, so
 * the table reads "Riley · Bot (Easy)" instead of "Bot (Easy)".
 */
export function botDisplayName(kind: BotKind): string {
  return `Bot (${BOT_LABELS[kind]})`;
}

/**
 * Pool of human-readable first names the server picks from when seating
 * a bot. Kept short, gender-neutral, and visually distinct from each
 * other so a four-handed table is easy to read at a glance. Lives in
 * the protocol package because both the authoritative server
 * (`MatchSession`) and the in-process solo transport need to draw from
 * the same list — otherwise online and solo would project different
 * name styles into the same `PublicPlayer.displayName` field.
 */
export const BOT_NAME_POOL: readonly string[] = [
  'Aiko',
  'Bao',
  'Casey',
  'Dao',
  'Elena',
  'Finn',
  'Haru',
  'Iris',
  'Jin',
  'Kai',
  'Lin',
  'Mei',
  'Niko',
  'Pia',
  'Rin',
  'Sora',
  'Tao',
  'Una',
  'Vera',
  'Yu',
] as const;

/**
 * Pick a name from `BOT_NAME_POOL` that isn't already in use by another
 * seat at this table. The pool comfortably exceeds the table size (4
 * seats, 20 names), so the collision path is only relevant when the
 * pool is bumped down in size for tests — there's a deterministic
 * fallback to the first pool entry so the function never returns
 * undefined.
 */
export function pickRandomBotName(
  taken: Iterable<string>,
  rng: () => number = Math.random,
): string {
  const used = new Set<string>();
  for (const name of taken) used.add(name);
  const available = BOT_NAME_POOL.filter((n) => !used.has(n));
  const pool = available.length > 0 ? available : BOT_NAME_POOL;
  return pool[Math.floor(rng() * pool.length)] ?? BOT_NAME_POOL[0]!;
}

export interface PublicPlayer {
  playerId: string;
  displayName: string;
  seat: Seat | null;
  /** Whether this seat is currently filled by a connected human. */
  connected: boolean;
  /** Whether this seat is filled by a bot. */
  isBot: boolean;
  /** Strategy kind when `isBot` is true; older servers omit it. */
  botKind?: BotKind;
}

export type ClientMessage =
  | { t: 'hello'; playerId: string; displayName: string; matchCode: string }
  | { t: 'action'; action: Action }
  | { t: 'chat'; text: string }
  | { t: 'leave' }
  /** Host-only; server enforces seat-empty + between-hands phase. */
  | { t: 'seatBot'; seat: Seat; kind: BotKind }
  /** Host-only; frees the seat for a joiner. */
  | { t: 'unseatBot'; seat: Seat };

export type ServerMessage =
  | { t: 'state'; state: GameState; you: Seat | 'spectator' }
  | { t: 'delta'; events: Event[]; state: GameState }
  | {
      t: 'lobby';
      players: PublicPlayer[];
      host: string | null;
      rules: RuleConfig;
      /**
       * Live count of non-seated spectator connections — clients without
       * a seat (joined a full room or explicitly opted in as observer).
       * Defaults to 0 when the server hasn't been upgraded; older clients
       * just ignore the field.
       */
      viewers?: number;
    }
  | { t: 'error'; code: string; detail?: string }
  | { t: 'pong' }
  /**
   * Server-broadcast chat / emote. `from` is the sender's seat, or
   * 'spectator' if they're connected without a seat. `ts` is the server
   * clock at receive — clients use it to scope auto-dismissal and to
   * order overlapping bubbles deterministically.
   */
  | { t: 'chat'; from: Seat | 'spectator'; text: string; ts: number };

export const helloSchema = z.object({
  t: z.literal('hello'),
  playerId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(32),
  matchCode: z.string().min(1).max(16),
});

export const chatSchema = z.object({
  t: z.literal('chat'),
  text: z.string().min(1).max(280),
});

export const leaveSchema = z.object({ t: z.literal('leave') });

const seatLiteral = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const seatBotSchema = z.object({
  t: z.literal('seatBot'),
  seat: seatLiteral,
  kind: z.enum(BOT_KINDS),
});

export const unseatBotSchema = z.object({
  t: z.literal('unseatBot'),
  seat: seatLiteral,
});

/**
 * We do not deeply schema-validate Action — its discriminated-union shape is
 * enforced by the engine reducer (which throws IllegalActionError on
 * anything malformed). At the wire boundary we just check the envelope.
 */
export const actionEnvelopeSchema = z.object({
  t: z.literal('action'),
  action: z.unknown(),
});

export const clientMessageSchema = z.union([
  helloSchema,
  actionEnvelopeSchema,
  chatSchema,
  leaveSchema,
  seatBotSchema,
  unseatBotSchema,
]);

export type ParsedClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(
  raw: unknown,
): { ok: true; msg: ClientMessage } | { ok: false; error: string } {
  const r = clientMessageSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: r.error.message };
  // Cast Action through; the engine validates it.
  return { ok: true, msg: r.data as ClientMessage };
}

/** Match codes: 5 chars from a confusion-resistant alphabet (no 0/O/1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateMatchCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 5; i++) {
    s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  }
  return s;
}

export function isValidMatchCode(code: string): boolean {
  if (code.length !== 5) return false;
  return [...code].every((c) => CODE_ALPHABET.includes(c));
}

export type { Action, Claim, Event, GameState, RuleConfig, Seat };
