import { useState } from 'react';
import { Modal } from './Modal.js';

interface JoinLanModalProps {
  open: boolean;
  onClose: () => void;
  onJoin: (hostUrl: string, matchCode: string) => void;
  /** Optional default — pre-fills the host URL when the page is being served from an LAN origin. */
  defaultUrl?: string;
}

export function JoinLanModal({ open, onClose, onJoin, defaultUrl = '' }: JoinLanModalProps) {
  const [url, setUrl] = useState(defaultUrl);
  const [code, setCode] = useState('');

  return (
    <Modal open={open} onClose={onClose} title="Join LAN match">
      <label style={{ display: 'block', margin: '12px 0' }}>
        Host URL
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://192.168.1.42:7777"
          style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
        />
      </label>
      <label style={{ display: 'block', margin: '12px 0' }}>
        Match code
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={5}
          placeholder="ABCDE"
          style={{
            display: 'block',
            width: '100%',
            padding: 8,
            marginTop: 4,
            fontFamily: 'monospace',
            textTransform: 'uppercase',
          }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!url || code.length !== 5}
          onClick={() => onJoin(url.trim(), code)}
        >
          Join
        </button>
      </div>
    </Modal>
  );
}
