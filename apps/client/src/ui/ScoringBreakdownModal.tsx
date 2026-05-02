import { type FaanBreakdown, type HandResult, type Tile, tileLabel } from '@mahjong/game-logic';
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
        <div style={{ marginLeft: 'auto' }}>
          <FlatTile t={tile} />
        </div>
      </div>

      {breakdown.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No bonus patterns — base hand only.</p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {breakdown.map((b, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: breakdown order is stable engine output and entries can repeat names
            <BreakdownRow key={i} entry={b} />
          ))}
          <li
            style={{
              borderTop: '2px solid #444',
              paddingTop: 8,
              display: 'flex',
              justifyContent: 'space-between',
              fontWeight: 600,
            }}
          >
            <span>Total</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{faan}</span>
          </li>
        </ul>
      )}

      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function BreakdownRow({ entry }: { entry: FaanBreakdown }) {
  return (
    <li
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 0',
        borderBottom: '1px solid #222',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>{entry.name}</span>
        <span style={{ opacity: 0.7, fontSize: 13 }}>{entry.english}</span>
        <span
          style={{
            marginLeft: 'auto',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          +{entry.faan}
        </span>
      </div>
      {entry.tiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {entry.tiles.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: tile composition order is engine-defined and copies of the same tile are intentional duplicates
            <FlatTile key={i} t={t} />
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Static tile renderer. Avoids `Tile` (the framer-motion variant) because it
 * uses `layoutId={`tile-${tileId(...)}`}` for FLIP animations — rendering it
 * here would clash with the same tile shown elsewhere on the page (winner's
 * hand, last discard) and trigger animation glitches.
 */
function FlatTile({ t }: { t: Tile }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff',
        color: '#222',
        borderRadius: 4,
        border: '1px solid #2228',
        boxShadow: '0 1px 2px #0006',
        width: 26,
        height: 36,
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      {tileLabel(t)}
    </span>
  );
}
