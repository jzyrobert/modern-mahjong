import { generateMatchCode } from '@mahjong/protocol';
import { useEffect, useRef, useState } from 'react';
import { isLanServerAvailable } from '../native/lan-server.js';
import { CREAM, HAIRLINE, INK, INK_3, MONO, PAPER_HI, SANS } from '../native/theme.js';
import { Modal } from './Modal.js';
import { GhostButton, PrimaryButton } from './buttons.js';

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
      <div style={{ fontSize: 12, color: INK_3, lineHeight: 1.5, marginBottom: 14 }}>
        {isLanServerAvailable()
          ? 'Share the URL and match code with anyone on the same Wi-Fi.'
          : 'Native LAN-server plugin not available in this build. Paste the host address you want to advertise; guests on the same Wi-Fi can join with the match code below.'}
      </div>

      <div style={{ marginBottom: 14 }}>
        <Label>Host URL</Label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={hostUrl}
            onChange={(e) => setHostUrl(e.target.value)}
            placeholder="http://192.168.1.42:7777"
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 8,
              border: `1px solid ${HAIRLINE}`,
              background: PAPER_HI,
              fontFamily: SANS,
              fontSize: 14,
              fontWeight: 600,
              color: INK,
              outline: 'none',
            }}
          />
          <GhostButton onClick={copyHostUrl} disabled={!hostUrl}>
            {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Failed' : 'Copy'}
          </GhostButton>
        </div>
      </div>

      <div
        style={{
          background: CREAM,
          border: `1px solid ${HAIRLINE}`,
          borderRadius: 10,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Label>Match code</Label>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: 5,
              color: INK,
              marginTop: 2,
            }}
          >
            {matchCode}
          </div>
        </div>
        <div style={{ fontSize: 11, color: INK_3, textAlign: 'right', maxWidth: 140 }}>
          Share with guests so they can find this match.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton onClick={() => onHosted(hostUrl, matchCode)} disabled={!hostUrl}>
          Start hosting
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function Label({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: INK_3,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}
