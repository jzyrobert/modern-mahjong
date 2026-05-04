/**
 * Inline SVG icons used by the lobby's `ModeCard` rows. Extracted out of
 * `Lobby.tsx` so the menu file stays focused on layout. Each icon paints
 * with `currentColor`, so the parent's `color:` flows through.
 */

export function GlobeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
    </svg>
  );
}

export function BotIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3" />
      <circle cx="9" cy="13" r="1.4" />
      <circle cx="15" cy="13" r="1.4" />
      <path d="M9 17h6" />
    </svg>
  );
}

export function WifiIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path d="M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  );
}

export function BoxIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 2l9 4.5v9L12 20l-9-4.5v-9z" />
      <path d="M12 22V12" />
      <path d="M21 7l-9 5-9-5" />
    </svg>
  );
}
