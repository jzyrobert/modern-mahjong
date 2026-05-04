import { useEffect, useState } from 'react';
import { INK_3 } from '../native/theme.js';
import { Modal } from './Modal.js';
import { GhostButton, PrimaryButton, TextField } from './buttons.js';

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

  useEffect(() => {
    if (open) setUrl(defaultUrl);
  }, [open, defaultUrl]);

  return (
    <Modal open={open} onClose={onClose} title="Join LAN match">
      <div style={{ fontSize: 12, color: INK_3, lineHeight: 1.5, marginBottom: 14 }}>
        Get the host's URL and match code from whoever's hosting, then paste them in.
      </div>
      <TextField
        label="Host URL"
        value={url}
        onChange={setUrl}
        placeholder="http://192.168.1.42:7777"
        style={{ marginBottom: 14 }}
      />
      <TextField
        label="Match code"
        value={code}
        onChange={(v) => setCode(v.toUpperCase())}
        placeholder="ABCDE"
        mono
        maxLength={5}
        style={{ marginBottom: 18 }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton
          onClick={() => onJoin(url.trim(), code)}
          disabled={!url || code.length !== 5}
        >
          Join match
        </PrimaryButton>
      </div>
    </Modal>
  );
}
