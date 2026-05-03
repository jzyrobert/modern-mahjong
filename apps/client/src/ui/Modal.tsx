import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { HAIRLINE, INK, PAPER, SANS } from '../native/theme.js';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ open, title, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 80,
      }}
      onClick={onClose}
      onKeyDown={() => {
        /* escape handled at the window level */
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        style={{
          background: PAPER,
          color: INK,
          border: `1px solid ${HAIRLINE}`,
          padding: 24,
          borderRadius: 12,
          minWidth: 360,
          maxWidth: '90vw',
          fontFamily: SANS,
        }}
      >
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
