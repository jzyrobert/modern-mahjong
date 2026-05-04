import { useEffect, useState } from 'react';

/**
 * Fullscreen API helpers + a `useFullscreen()` hook. Only used by the
 * mobile shell — desktop already runs in a window large enough that
 * the toggle would be noise. Webkit-prefixed fallbacks exist because
 * older mobile Safari (iPad pre-iOS 12) only exposes the prefixed API.
 */

interface WebkitDocument {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebkitElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function doc(): (Document & WebkitDocument) | null {
  if (typeof document === 'undefined') return null;
  return document as Document & WebkitDocument;
}

export function isFullscreenSupported(): boolean {
  const d = doc();
  if (!d) return false;
  return Boolean(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreenActive(): boolean {
  const d = doc();
  if (!d) return false;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

export async function toggleFullscreen(): Promise<void> {
  const d = doc();
  if (!d) return;
  if (isFullscreenActive()) {
    await Promise.resolve(d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    return;
  }
  const el = d.documentElement as HTMLElement & WebkitElement;
  await Promise.resolve(el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
}

export function useFullscreen(): {
  supported: boolean;
  active: boolean;
  toggle: () => void;
} {
  const [active, setActive] = useState<boolean>(() => isFullscreenActive());
  useEffect(() => {
    const onChange = () => setActive(isFullscreenActive());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange as EventListener);
    };
  }, []);
  return {
    supported: isFullscreenSupported(),
    active,
    toggle: () => {
      void toggleFullscreen();
    },
  };
}
