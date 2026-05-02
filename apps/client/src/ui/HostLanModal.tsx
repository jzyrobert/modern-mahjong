import { generateMatchCode } from '@mahjong/protocol';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
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
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hostUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(hostUrl, { width: 240, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        /* malformed URL — leave the QR cleared */
      });
    return () => {
      cancelled = true;
    };
  }, [hostUrl]);

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
        <input
          value={hostUrl}
          onChange={(e) => setHostUrl(e.target.value)}
          placeholder="http://192.168.1.42:7777"
          style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
        />
      </label>
      <p style={{ fontSize: 13 }}>
        Match code:{' '}
        <code style={{ background: '#000a', padding: '2px 6px', borderRadius: 4 }}>
          {matchCode}
        </code>
      </p>
      {qrDataUrl && (
        <div style={{ textAlign: 'center', margin: '12px 0' }}>
          <img
            src={qrDataUrl}
            alt="Host URL QR"
            width={240}
            height={240}
            style={{ background: '#fff', padding: 8, borderRadius: 8 }}
          />
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{hostUrl}</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
