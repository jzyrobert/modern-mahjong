import type { Seat } from '@mahjong/game-logic';
import { type BotKind, botDisplayName } from '@mahjong/protocol';
import type { LobbyState } from '../../state/game';

export interface OppIdentity {
  /** Lobby roster entry for this seat, or `null` when the lobby
   *  hasn't synced yet (e.g. mid-tab-resume before the first lobby
   *  delta lands). */
  name: string;
  isBot: boolean;
  /** Difficulty kind when this seat is a bot whose configuration the
   *  lobby has published. `null` for human seats or bots whose kind
   *  hasn't propagated yet — callers fall back to a generic "Bot"
   *  label in that case (see `botLabel`). */
  botKind: BotKind | null;
  /** Display string for the bot's difficulty (e.g. "Bot (Easy)").
   *  `null` for human seats. Falls back to a bare `"Bot"` when the
   *  seat is a bot but `botKind` hasn't synced yet, so the UI never
   *  surfaces nothing during the brief mid-sync gap. */
  botLabel: string | null;
}

/**
 * Resolve the display identity for an opponent seat from the lobby
 * roster — the bit of derivation that `OppHandStrip`, `DenseOppRow`,
 * and the spectator view all need: a stable name with a `Seat N`
 * fallback, a bot flag, a bot-kind enum, and the rendered
 * `botLabel` string (`"Bot (Easy)"` / `"Bot"` / `null`).
 *
 * Lives in its own module so the same shape flows through every
 * opponent surface — a change to the bot-label format or the
 * `Seat N` fallback wording stays one edit.
 */
export function oppIdentity(lobby: LobbyState | null, seat: Seat): OppIdentity {
  const player = lobby?.players.find((p) => p.seat === seat);
  const name = player?.displayName ?? `Seat ${seat}`;
  const isBot = player?.isBot ?? false;
  const botKind: BotKind | null = player?.botKind ?? null;
  const botLabel = isBot ? (botKind ? botDisplayName(botKind) : 'Bot') : null;
  return { name, isBot, botKind, botLabel };
}
