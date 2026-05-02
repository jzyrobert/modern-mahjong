import { type HandResult, tileLabel } from '@mahjong/game-logic';
import { Modal } from './Modal.js';

type WinResult = Extract<HandResult, { kind: 'win' }>;

interface ScoringBreakdownModalProps {
  open: boolean;
  onClose: () => void;
  result: WinResult;
  faanMin: number;
}

export function ScoringBreakdownModal({
  open,
  onClose,
  result,
  faanMin,
}: ScoringBreakdownModalProps) {
  if (!open) return null;
  const { winner, from, selfDraw, tile, faan, breakdown } = result;
  return (
    <Modal open onClose={onClose} title={`Seat ${winner} wins — ${faan} faan`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          {selfDraw ? 'Self-draw' : `Discarded by seat ${from}`} · Min faan: {faanMin}
        </div>
        <div
          aria-label={`winning tile ${tileLabel(tile)}`}
          style={{
            marginLeft: 'auto',
            background: '#fff',
            color: '#222',
            borderRadius: 6,
            border: '1px solid #2228',
            boxShadow: '0 2px 4px #0006',
            width: 36,
            height: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {tileLabel(tile)}
        </div>
      </div>

      {breakdown.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No bonus patterns — base hand only.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px', fontWeight: 600 }}>Pattern</th>
              <th style={{ padding: '6px 8px', fontWeight: 600, opacity: 0.7 }}>English</th>
              <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right', width: 60 }}>
                Faan
              </th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((b, i) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: breakdown order is stable engine output and entries can repeat names
                key={i}
                style={{ borderBottom: i === breakdown.length - 1 ? 'none' : '1px solid #222' }}
              >
                <td style={{ padding: '6px 8px', fontFamily: 'system-ui, sans-serif' }}>
                  {b.name}
                </td>
                <td style={{ padding: '6px 8px', opacity: 0.7, fontSize: 13 }}>{b.english}</td>
                <td
                  style={{
                    padding: '6px 8px',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  +{b.faan}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid #444' }}>
              <td colSpan={2} style={{ padding: '8px', fontWeight: 600 }}>
                Total
              </td>
              <td
                style={{
                  padding: '8px',
                  textAlign: 'right',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {faan}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
