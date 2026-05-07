/**
 * Shared timings for transient overlays. The values here are
 * deliberately conservative — they pair "long enough to read" with
 * "short enough that a tap-to-dismiss feels responsive".
 */

/**
 * How long a transient overlay stays on screen before auto-dismissing.
 * Used by:
 *   - `<DiceCeremony>` — opening rolls dialog after `startHand`.
 *   - `<WinCelebration>` — celebratory 和 emblem after a win.
 *   - `<ChatBubbles>` — per-bubble lifetime for emote / chat
 *     messages floating over the felt.
 *
 * Three callers had this constant defined identically as `const
 * DISMISS_MS = 3500;` — moving it here so a future "make celebrations
 * linger" change is a one-line edit instead of a three-file grep.
 */
export const DISMISS_MS = 3500;
