import { Platform } from 'react-native';
import type { RendererChoice } from '../state/game';

/**
 * Which render layer to mount — the Three.js scene (`src/three/`) or the
 * classic React Native shells. Universal module: no `three` import here
 * so native bundles never pull the WebGL tree in.
 *
 * Precedence (highest first):
 *   1. `globalThis.__MAHJONG_TEST_RENDERER__` — set by Playwright /
 *      the screenshot verifier via `addInitScript`.
 *   2. `?renderer=classic|3d` query param — manual override + the
 *      Lighthouse / smoke configs.
 *   3. The persisted `settings.renderer` (`auto` | `3d` | `classic`).
 *   4. `auto` → `'3d'` on web with a working WebGL2 context, else
 *      `'classic'`. Native is always `'classic'` (three needs a DOM
 *      canvas; `expo-gl` is out of scope for this pass).
 */
export type ResolvedRenderer = '3d' | 'classic';

declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_RENDERER__: ResolvedRenderer | undefined;
}

let webgl2Probe: boolean | null = null;

/** Cached WebGL2 availability probe. Creates one throw-away context. */
export function hasWebGL2(): boolean {
  if (webgl2Probe !== null) return webgl2Probe;
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    webgl2Probe = false;
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    webgl2Probe = gl !== null;
    // Free the context eagerly — browsers cap live contexts at ~16.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2Probe = false;
  }
  return webgl2Probe;
}

/** Test seam — lets unit tests pin the probe without a DOM. */
export function __setWebGL2ProbeForTests(value: boolean | null): void {
  webgl2Probe = value;
}

function queryOverride(): ResolvedRenderer | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const v = new URLSearchParams(window.location.search).get('renderer');
    if (v === '3d' || v === 'classic') return v;
  } catch {
    /* no-op — no location in SSR */
  }
  return null;
}

/**
 * The session override in effect, if any — the test-harness global or
 * the `?renderer=` query param — with where it came from. `null` when
 * the persisted setting is what decides. Lets the settings panel say
 * *why* the status pill disagrees with the selected option.
 */
export function rendererOverride(): { value: ResolvedRenderer; source: 'test' | 'query' } | null {
  const test = globalThis.__MAHJONG_TEST_RENDERER__;
  if (test === '3d' || test === 'classic') return { value: test, source: 'test' };
  const q = queryOverride();
  if (q) return { value: q, source: 'query' };
  return null;
}

export function resolveRenderer(setting: RendererChoice): ResolvedRenderer {
  const test = globalThis.__MAHJONG_TEST_RENDERER__;
  if (test === '3d' || test === 'classic') return test;
  const q = queryOverride();
  if (q) return q;
  if (Platform.OS !== 'web') return 'classic';
  if (setting === 'classic') return 'classic';
  if (setting === '3d') return '3d';
  return hasWebGL2() ? '3d' : 'classic';
}
