import { HAIRLINE, INK_3, PAPER_HI, SANS } from '../../native/theme.js';

interface ChatBarProps {
  /** Send a chat message. Caller wires this to the live transport. */
  onSend: (text: string) => void;
}

const EMOTES = ['👍', '😎', '🎉', '🤔', '😅', '🔥'] as const;

/**
 * Six-emote chat bar — taps send `ClientMessage.t === 'chat'` over the
 * live transport. The server broadcasts the message back to all
 * connected clients tagged with the sender's seat, and `ChatBubbles`
 * renders a floating bubble near the sender. Ported from
 * `/tmp/design/design/app.jsx::ChatBar`.
 */
export function ChatBar({ onSend }: ChatBarProps) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        borderRadius: 12,
        background: PAPER_HI,
        border: `1px solid ${HAIRLINE}`,
        boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      aria-label="Send emote"
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: INK_3,
          fontFamily: SANS,
          padding: '0 6px',
        }}
      >
        Emote
      </span>
      {EMOTES.map((emote) => (
        <button
          key={emote}
          type="button"
          onClick={() => onSend(emote)}
          aria-label={`Send ${emote}`}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            transition: 'transform 0.12s ease, background 0.12s ease',
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.92)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          {emote}
        </button>
      ))}
    </div>
  );
}
