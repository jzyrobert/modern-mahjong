import type { Action, Claim, Event, GameState, RuleConfig, Seat } from '@mahjong/game-logic';
import { z } from 'zod';

/**
 * Wire format between clients and the authoritative server (whether
 * partyserver online or a host's Capacitor app on the LAN).
 *
 * `Action` and `GameState` are intentionally re-used from the game-logic
 * package; we attach zod schemas only at the message-envelope level so the
 * server can fast-reject malformed payloads. Action validity beyond shape
 * is enforced by the engine reducer, not here.
 */

export interface PublicPlayer {
  playerId: string;
  displayName: string;
  seat: Seat | null;
  /** Whether this seat is currently filled by a connected human. */
  connected: boolean;
  /** Whether this seat is filled by a bot. */
  isBot: boolean;
}

export type ClientMessage =
  | { t: 'hello'; playerId: string; displayName: string; matchCode: string }
  | { t: 'action'; action: Action }
  | { t: 'chat'; text: string }
  | { t: 'leave' };

export type ServerMessage =
  | { t: 'state'; state: GameState; you: Seat | 'spectator' }
  | { t: 'delta'; events: Event[]; state: GameState }
  | { t: 'lobby'; players: PublicPlayer[]; host: string | null; rules: RuleConfig }
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
