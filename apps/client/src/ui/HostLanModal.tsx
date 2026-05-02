import { generateMatchCode } from '@mahjong/protocol';
import { useEffect, useRef, useState } from 'react';
import { isLanServerAvailable } from '../native/lan-server.js';
import { Modal } from './Modal.js';

interface HostLanModalProps {
  open: boolean;
  onClose: () => void;
  onHosted: (hostUrl: string, matchCode: string) => void;
}

export function HostLanModal({ open, onClose, onHosted }: HostLanModalProps) {
  const [hostUrl, setHostUrl] = useState('');
  const [matchCode] = useState(() => generateMatchCode());
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copyHostUrl() {
    if (!hostUrl) return;
    try {
      await navigator.clipboard.writeText(hostUrl);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopyState('idle'), 1500);
  }

  return (
    <Modal open={open} onClose={onClose} title="Host LAN match">
      {!isLanServerAvailable() && (
        <p style={{ fontSize: 12, opacity: 0.7 }}>
          Native LAN-server plugin not available in this build. Paste the host address you want to
          advertise and guests can join over the same LAN.
        </p>
      )}
      <label style={{ display: 'block', margin: '12px 0' }}>
        Host URL
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <input
            value={hostUrl}
            onChange={(e) => setHostUrl(e.target.value)}
            placeholder="http://192.168.1.42:7777"
            style={{ flex: 1, padding: 8 }}
          />
          <button type="button" disabled={!hostUrl} onClick={copyHostUrl} style={{ minWidth: 64 }}>
            {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Failed' : 'Copy'}
          </button>
        </div>
      </label>
      <p style={{ fontSize: 13 }}>
        Match code:{' '}
        <code style={{ background: '#000a', padding: '2px 6px', borderRadius: 4 }}>
          {matchCode}
        </code>
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={!hostUrl} onClick={() => onHosted(hostUrl, matchCode)}>
          Start hosting
        </button>
      </div>
    </Modal>
  );
}
