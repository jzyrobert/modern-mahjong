import type { ServerMessage } from '@mahjong/protocol';
import { type Connection, type ConnectionContext, Server, type WSMessage } from 'partyserver';
import { MatchSession, type Outbound } from './MatchSession.js';

export { botByKind } from './MatchSession.js';

/**
 * Authoritative match room. One Durable Object per match code. Owns a
 * MatchSession that handles all game logic; this class is the thin
 * adapter that translates partyserver lifecycle calls into session
 * inputs and dispatches the resulting Outbound messages to the right
 * connections / broadcast / DO alarm.
 */
export class MatchRoom extends Server {
  static override options = { hibernate: true };

  private session = new MatchSession();

  override onConnect(conn: Connection, ctx: ConnectionContext): void {
    void ctx;
    conn.send(JSON.stringify({ t: 'pong' } satisfies ServerMessage));
  }

  override onMessage(conn: Connection, raw: WSMessage): void {
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
    this.dispatch(this.session.applyClientMessage(conn.id, parsed));
  }

  override onClose(conn: Connection): void {
    this.dispatch(this.session.detachConnection(conn.id));
  }

  override async alarm(): Promise<void> {
    this.dispatch(this.session.fireAlarm(Date.now()));
  }

  private dispatch(outs: Outbound[]): void {
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
          if (this.ctx?.storage?.setAlarm) this.ctx.storage.setAlarm(out.deadlineMs);
          break;
      }
    }
  }
}
