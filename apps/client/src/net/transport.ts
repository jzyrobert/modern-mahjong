import type { ClientMessage, ServerMessage } from '@mahjong/protocol';

export type TransportStatus = 'connecting' | 'open' | 'closed';

export interface Transport {
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): () => void;
  onStatus(cb: (s: TransportStatus) => void): () => void;
  status(): TransportStatus;
  close(): void;
}

/** Online transport via partysocket WebSocket. */
export function createOnlineTransport(opts: {
  host: string;
  matchCode: string;
  playerId: string;
  displayName: string;
}): Transport {
  const url = new URL(`/parties/match-room/${opts.matchCode}`, opts.host);
  url.searchParams.set('playerId', opts.playerId);
  url.searchParams.set('name', opts.displayName);

  const ws = new WebSocket(url.toString().replace(/^http/, 'ws'));
  const messageListeners = new Set<(m: ServerMessage) => void>();
  const statusListeners = new Set<(s: TransportStatus) => void>();
  let _status: TransportStatus = 'connecting';

  function setStatus(s: TransportStatus) {
    _status = s;
    for (const cb of statusListeners) cb(s);
  }

  ws.addEventListener('open', () => {
    setStatus('open');
    ws.send(
      JSON.stringify({
        t: 'hello',
        playerId: opts.playerId,
        displayName: opts.displayName,
        matchCode: opts.matchCode,
      }),
    );
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
