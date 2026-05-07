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
