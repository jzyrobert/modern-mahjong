import type { ServerMessage } from '@mahjong/protocol';
import { MatchSession, type Outbound } from './MatchSession';

/**
 * In-process host bridge. The role that `MatchRoom` plays on the
 * Cloudflare Worker side, minus the Durable Object hibernation +
 * storage glue — those don't apply when the same app process owns
 * both the embedded WebSocket server and the engine. The bridge
 * consumes `connection` / `message` / `close` events surfaced by
 * whichever transport hosts the LAN server (today: the
 * `expo-lan-server` Expo Module) and dispatches the session's
 * `Outbound` effects back through `send` / `close`.
 *
 * Kept in this package — rather than alongside the LAN UI in
 * `apps/client/src/net/` — so the package's vitest setup can cover
 * the engine + bridge together without dragging vitest into the
 * Expo app. The client adds a thin wiring file that supplies the
 * real expo-lan-server module + a process-singleton helper.
 */

interface Subscription {
  remove(): void;
}

/**
 * Minimal native-module surface the bridge consumes. Generic over
 * the underlying transport so the bridge can be tested against a
 * fake without standing up a real WebSocket server.
 */
export interface LanHostBridgeNative {
  addListener(event: 'connection', cb: (e: { id: string; query: string }) => void): Subscription;
  addListener(event: 'message', cb: (e: { id: string; data: string }) => void): Subscription;
  addListener(event: 'close', cb: (e: { id: string }) => void): Subscription;
  send(opts: { id: string; data: string }): Promise<void>;
  close(opts: { id: string }): Promise<void>;
}

export interface LanHostBridgeOptions {
  native: LanHostBridgeNative;
  /** Time source for alarms — defaults to `Date.now`. */
  now?: () => number;
  /**
   * Scheduler for `scheduleAlarm` outbounds. Defaults to `setTimeout`
   * / `clearTimeout`. Tests inject a fake to advance time synchronously.
   */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class LanHostBridge {
  private session: MatchSession;
  private connectionSubscription: Subscription | null = null;
  private messageSubscription: Subscription | null = null;
  private closeSubscription: Subscription | null = null;
  /**
   * Connection ids the bridge has seen open and hasn't been told are
   * closed. The session itself tracks seat → connectionId; this set
   * is only consulted to fan out `broadcast` outbounds — the session
   * doesn't surface its connection roster directly.
   */
  private openConnections = new Set<string>();
  private alarmHandle: unknown = null;
  private alarmDeadline: number | null = null;
  private disposed = false;
  private readonly native: LanHostBridgeNative;
  private readonly now: () => number;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(opts: LanHostBridgeOptions) {
    this.session = new MatchSession();
    this.native = opts.native;
    this.now = opts.now ?? Date.now;
    this.setTimer =
      opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms) as unknown as ReturnType<typeof setTimeout>);
    this.clearTimer =
      opts.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

    this.connectionSubscription = this.native.addListener('connection', (e) => {
      void this.onConnection(e.id);
    });
    this.messageSubscription = this.native.addListener('message', (e) => {
      void this.onMessage(e.id, e.data);
    });
    this.closeSubscription = this.native.addListener('close', (e) => {
      void this.onClose(e.id);
    });
  }

  /** Tear down all subscriptions + cancel any pending alarm. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connectionSubscription?.remove();
    this.messageSubscription?.remove();
    this.closeSubscription?.remove();
    this.connectionSubscription = null;
    this.messageSubscription = null;
    this.closeSubscription = null;
    if (this.alarmHandle !== null) {
      this.clearTimer(this.alarmHandle);
      this.alarmHandle = null;
      this.alarmDeadline = null;
    }
    this.openConnections.clear();
  }

  /**
   * Mirror `MatchRoom.onConnect`: greet new sockets with a `pong` so
   * the client knows the upgrade landed at an actual server (vs. a
   * 1006 close from a NAT/firewall that ate the upgrade).
   */
  private async onConnection(connectionId: string): Promise<void> {
    if (this.disposed) return;
    this.openConnections.add(connectionId);
    await this.send(connectionId, { t: 'pong' });
  }

  private async onMessage(connectionId: string, raw: string): Promise<void> {
    if (this.disposed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.send(connectionId, {
        t: 'error',
        code: 'PARSE',
        detail: 'invalid JSON',
      });
      return;
    }
    await this.dispatch(this.session.applyClientMessage(connectionId, parsed));
  }

  private async onClose(connectionId: string): Promise<void> {
    if (this.disposed) return;
    this.openConnections.delete(connectionId);
    await this.dispatch(this.session.detachConnection(connectionId, this.now()));
  }

  /** Fire the alarm; invoked by setTimer or directly by tests. */
  private async fireAlarm(): Promise<void> {
    if (this.disposed) return;
    this.alarmHandle = null;
    this.alarmDeadline = null;
    await this.dispatch(this.session.fireAlarm(this.now()));
  }

  private async dispatch(outs: Outbound[]): Promise<void> {
    if (this.disposed) return;
    for (const out of outs) {
      switch (out.kind) {
        case 'sendTo':
          await this.send(out.connectionId, out.msg);
          break;
        case 'broadcast':
          for (const id of this.openConnections) {
            await this.send(id, out.msg);
          }
          break;
        case 'closeConnection':
          this.openConnections.delete(out.connectionId);
          await this.native.close({ id: out.connectionId }).catch(() => undefined);
          break;
        case 'scheduleAlarm':
          this.scheduleAlarm(out.deadlineMs);
          break;
      }
    }
  }

  private async send(connectionId: string, msg: ServerMessage): Promise<void> {
    // The transport's `send` rejects when the underlying socket has
    // already closed (race between an outbound and the `close` event).
    // Swallow — the next `onClose` will reconcile the state.
    await this.native.send({ id: connectionId, data: JSON.stringify(msg) }).catch(() => undefined);
  }

  /**
   * Replace the active alarm if `deadlineMs` is sooner than the current
   * one, or set the first one. Matches `ctx.storage.setAlarm`'s
   * "latest set wins" contract for the cases the session relies on
   * (a single pending claim-window).
   */
  private scheduleAlarm(deadlineMs: number): void {
    if (this.alarmDeadline !== null && deadlineMs >= this.alarmDeadline) return;
    if (this.alarmHandle !== null) this.clearTimer(this.alarmHandle);
    this.alarmDeadline = deadlineMs;
    const delay = Math.max(0, deadlineMs - this.now());
    this.alarmHandle = this.setTimer(() => {
      void this.fireAlarm();
    }, delay);
  }
}
