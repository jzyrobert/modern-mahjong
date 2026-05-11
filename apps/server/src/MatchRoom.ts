import { MatchSession, type MatchSessionSnapshot, type Outbound } from '@mahjong/match-session';
import type { ServerMessage } from '@mahjong/protocol';
import { type Connection, type ConnectionContext, Server, type WSMessage } from 'partyserver';

export { botByKind } from '@mahjong/match-session';

const STORAGE_KEY = 'session-snapshot';

/** Per-WS state we persist via partyserver `Connection.setState`. Survives DO hibernation. */
interface ConnState {
  playerId: string;
}

/**
 * Authoritative match room. One Durable Object per match code. Owns a
 * MatchSession that handles all game logic; this class is the thin
 * adapter that translates partyserver lifecycle calls into session
 * inputs and dispatches the resulting Outbound messages to the right
 * connections / broadcast / DO alarm. Snapshot-and-restore wires the
 * session through DO storage so a hibernated room rehydrates correctly.
 */
export class MatchRoom extends Server {
  static override options = { hibernate: true };

  private session = new MatchSession();

  override async onStart(): Promise<void> {
    const snap = await this.ctx?.storage?.get<MatchSessionSnapshot>(STORAGE_KEY);
    if (snap) this.session.restore(snap);
    // Cloudflare keeps WebSockets alive across hibernation but the JS heap
    // is rebuilt from scratch — so the in-memory seat→connection mapping
    // is gone. Each conn carries the player's identity via `setState`
    // (set on hello below); rebuild the mapping by walking live conns.
    const byPlayer = new Map<string, string>();
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.playerId) byPlayer.set(conn.state.playerId, conn.id);
    }
    if (byPlayer.size > 0) await this.dispatch(this.session.attachAll(byPlayer));
  }

  override onConnect(conn: Connection, ctx: ConnectionContext): void {
    void ctx;
    conn.send(JSON.stringify({ t: 'pong' } satisfies ServerMessage));
  }

  override async onMessage(conn: Connection, raw: WSMessage): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      conn.send(
        JSON.stringify({
          t: 'error',
          code: 'PARSE',
          detail: 'invalid JSON',
        } satisfies ServerMessage),
      );
      return;
    }
    // Stash the player's identity on the WS so wake-from-hibernation can
    // rebind seat ↔ connection. setState mirrors to the runtime's
    // serialised attachment, which survives the DO restart.
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { t?: unknown }).t === 'hello'
    ) {
      const playerId = (parsed as { playerId?: unknown }).playerId;
      if (typeof playerId === 'string') conn.setState({ playerId } satisfies ConnState);
    }
    await this.dispatch(this.session.applyClientMessage(conn.id, parsed));
  }

  override async onClose(conn: Connection): Promise<void> {
    await this.dispatch(this.session.detachConnection(conn.id));
  }

  override async alarm(): Promise<void> {
    await this.dispatch(this.session.fireAlarm(Date.now()));
  }

  private async dispatch(outs: Outbound[]): Promise<void> {
    for (const out of outs) {
      switch (out.kind) {
        case 'sendTo': {
          const conn = this.getConnection(out.connectionId);
          if (conn) conn.send(JSON.stringify(out.msg));
          break;
        }
        case 'broadcast':
          this.broadcast(JSON.stringify(out.msg));
          break;
        case 'closeConnection': {
          const conn = this.getConnection(out.connectionId);
          if (conn) conn.close();
          break;
        }
        case 'scheduleAlarm':
          if (this.ctx?.storage?.setAlarm) await this.ctx.storage.setAlarm(out.deadlineMs);
          break;
      }
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (this.ctx?.storage?.put) {
      await this.ctx.storage.put(STORAGE_KEY, this.session.snapshot());
    }
  }
}
