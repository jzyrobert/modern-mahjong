import { SURFACE_BG } from './theme.js';

/**
 * Native-platform setup. Imports Capacitor plugins lazily so the web
 * build doesn't require the native runtime, and silently no-ops on
 * platforms where a plugin isn't available.
 */

let pending: Promise<void> | null = null;

export function initNativeIfAvailable(): Promise<void> {
  if (!pending) pending = doInit();
  return pending;
}

async function doInit(): Promise<void> {
  let core: typeof import('@capacitor/core') | null = null;
  try {
    core = await import('@capacitor/core');
  } catch {
    return;
  }
  if (!core.Capacitor.isNativePlatform()) return;

  await Promise.allSettled([setupStatusBar(), lockLandscape()]);
}

async function setupStatusBar(): Promise<void> {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: SURFACE_BG });
  } catch {
    /* plugin missing on this platform */
  }
}

async function lockLandscape(): Promise<void> {
  try {
    const { ScreenOrientation } = await import('@capacitor/screen-orientation');
    await ScreenOrientation.lock({ orientation: 'landscape' });
  } catch {
    /* plugin missing on this platform */
  }
}

export async function vibrateLight(): Promise<void> {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* plugin missing — no-op on web */
  }
}
