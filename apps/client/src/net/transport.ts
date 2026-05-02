import type { ClientMessage, ServerMessage } from '@mahjong/protocol';

export type TransportStatus = 'connecting' | 'open' | 'closed';

export interface Transport {
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): () => void;
  onStatus(cb: (s: TransportStatus) => void): () => void;
  status(): TransportStatus;
  close(): void;
}

interface WsTransportOptions {
  /** Fully-formed WebSocket URL. */
  wsUrl: string;
  /** Hello payload to send immediately on `open`. */
  hello: ClientMessage & { t: 'hello' };
}

/**
 * Generic WebSocket-backed `Transport` factory shared by online + LAN flows.
 * Reconnect / heartbeats are intentionally left to the caller; for v1 a
 * dropped socket flips to `closed` and the UI is expected to surface a
 * "reconnect" affordance.
 */
function createWsTransport(opts: WsTransportOptions): Transport {
  const ws = new WebSocket(opts.wsUrl);
  const messageListeners = new Set<(m: ServerMessage) => void>();
  const statusListeners = new Set<(s: TransportStatus) => void>();
  let _status: TransportStatus = 'connecting';

  function setStatus(s: TransportStatus) {
    _status = s;
    for (const cb of statusListeners) cb(s);
  }

  ws.addEventListener('open', () => {
    setStatus('open');
    ws.send(JSON.stringify(opts.hello));
  });
  ws.addEventListener('close', () => setStatus('closed'));
  ws.addEventListener('message', (ev) => {
    try {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ServerMessage;
      for (const cb of messageListeners) cb(m);
    } catch {
      /* ignore */
    }
  });

  return {
    send(msg) {
      if (_status === 'open') ws.send(JSON.stringify(msg));
    },
    onMessage(cb) {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onStatus(cb) {
      statusListeners.add(cb);
      cb(_status);
      return () => statusListeners.delete(cb);
    },
    status() {
      return _status;
    },
    close() {
      ws.close();
    },
  };
}

interface MatchOptions {
  matchCode: string;
  playerId: string;
  displayName: string;
}

/** Online transport via partysocket-routed WebSocket. */
export function createOnlineTransport(opts: { host: string } & MatchOptions): Transport {
  const url = new URL(`/parties/match-room/${opts.matchCode}`, opts.host);
  url.searchParams.set('playerId', opts.playerId);
  url.searchParams.set('name', opts.displayName);
  return createWsTransport({
    wsUrl: url.toString().replace(/^http/, 'ws'),
    hello: helloFor(opts),
  });
}

/**
 * LAN transport: connects to the host's bundled WebSocket server. The
 * `hostUrl` is a typed-in or QR-scanned `http://lan-ip:port` (or
 * `ws://lan-ip:port`) that the host advertises; we always upgrade to a
 * `ws://...path` URL pointing at the well-known `/ws` endpoint exposed by
 * the host's native LanServer plugin.
 */
export function createLanTransport(opts: { hostUrl: string } & MatchOptions): Transport {
  const url = new URL(opts.hostUrl);
  // Force the websocket protocol; the LAN host is plain http (no LAN cert).
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
  url.searchParams.set('matchCode', opts.matchCode);
  url.searchParams.set('playerId', opts.playerId);
  url.searchParams.set('name', opts.displayName);
  return createWsTransport({ wsUrl: url.toString(), hello: helloFor(opts) });
}

function helloFor(opts: MatchOptions): ClientMessage & { t: 'hello' } {
  return {
    t: 'hello',
    playerId: opts.playerId,
    displayName: opts.displayName,
    matchCode: opts.matchCode,
  };
}

/**
 * True when the page is being served from a private-range LAN IP — i.e.,
 * the user opened a host's QR URL in their browser. We use this to
 * default the lobby UX into "LAN guest" mode.
 */
export function isLanOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return false;
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /\.local$/.test(host)
  );
}
