import { HAIRLINE, INK, SANS, SERIF } from '../../native/theme.js';

export type CallAction = 'chow' | 'pung' | 'kong' | 'win' | 'pass';

interface CallButtonProps {
  action: CallAction;
  onClick: () => void;
  disabled?: boolean;
}

const LABELS: Record<CallAction, { en: string; cn: string }> = {
  chow: { en: 'Chow', cn: '吃' },
  pung: { en: 'Pung', cn: '碰' },
  kong: { en: 'Kong', cn: '槓' },
  win: { en: 'Win', cn: '糊' },
  pass: { en: 'Pass', cn: '過' },
};

const COLORS: Record<CallAction, string> = {
  chow: 'linear-gradient(135deg, oklch(0.75 0.13 150), oklch(0.65 0.15 155))',
  pung: 'linear-gradient(135deg, oklch(0.7 0.13 230), oklch(0.6 0.15 235))',
  kong: 'linear-gradient(135deg, oklch(0.72 0.13 280), oklch(0.62 0.15 285))',
  win: 'linear-gradient(135deg, oklch(0.78 0.16 75), oklch(0.68 0.18 60))',
  pass: 'oklch(0.92 0.012 85)',
};

/**
 * Action button used in the claim bar — bilingual (TC serif Chinese +
 * Nunito English) with a per-action gradient. Ported from
 * `/tmp/design/design/app.jsx::CallButton`.
 *
 * Engine claim kinds map to design actions:
 *   chi  → chow  (吃)
 *   peng → pung  (碰)
 *   gong → kong  (槓)
 *   hu   → win   (糊)
 *   pass → pass  (過)
 */
export function CallButton({ action, onClick, disabled }: CallButtonProps) {
  const isPass = action === 'pass';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 18px',
        background: COLORS[action],
        color: isPass ? INK : 'white',
        border: isPass ? `1.5px solid ${HAIRLINE}` : 'none',
        borderRadius: 14,
        fontFamily: SANS,
        fontWeight: 800,
        fontSize: 14,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        boxShadow: isPass ? 'none' : '0 6px 18px rgba(0,0,0,0.18), inset 0 -3px 0 rgba(0,0,0,0.15)',
        transition: 'transform 120ms, box-shadow 120ms',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
      }}
    >
      <span style={{ fontFamily: SERIF, fontSize: 18 }}>{LABELS[action].cn}</span>
      <span>{LABELS[action].en}</span>
    </button>
  );
}
