import { Platform } from 'react-native';
import type { RendererChoice } from '../state/game';
import { glRendererString, pickTier, readDeviceHints } from './core/quality';

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
 *
 * `core/quality` is a pure module (no `three` import), so pulling
 * `pickTier` in here keeps this file safe for universal code.
 */
export type ResolvedRenderer = '3d' | 'classic';

declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_RENDERER__: ResolvedRenderer | undefined;
}

interface GLProbe {
  webgl2: boolean;
  /** Lower-cased unmasked renderer string; `undefined` without WebGL2. */
  renderer: string | undefined;
}

let glProbe: GLProbe | null = null;

/**
 * Cached WebGL2 probe. Creates one throw-away context, reads the
 * renderer string off it (so `resolveMenuBackdrop` can tell a software
 * rasteriser from a GPU without opening a second context) and loses it.
 */
function probeGL(): GLProbe {
  if (glProbe) return glProbe;
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    glProbe = { webgl2: false, renderer: undefined };
    return glProbe;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    const renderer = gl ? glRendererString(gl) : undefined;
    // Free the context eagerly — browsers cap live contexts at ~16.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    glProbe = { webgl2: gl !== null, renderer };
  } catch {
    glProbe = { webgl2: false, renderer: undefined };
  }
  return glProbe;
}

/** Cached WebGL2 availability. */
export function hasWebGL2(): boolean {
  return probeGL().webgl2;
}

/** Test seam — lets unit tests pin the probe without a DOM. */
export function __setGLProbeForTests(value: GLProbe | null): void {
  glProbe = value;
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

/**
 * Whether the lobby should mount the Three.js menu backdrop
 * (`Menu3DBackdrop`). Tighter than `resolveRenderer`: the backdrop is
 * decoration, so under `auto` the `low` quality tier — software
 * rasterisers (headless CI, Lighthouse's Chrome) and weak devices —
 * keeps the DOM-only menu while the table itself still renders in 3D.
 * On software GL every frame is a ~0.5 s main-thread task, which is
 * what sank the Lighthouse performance score to 0.66.
 *
 * An explicit `'3d'` — the test global, the `?renderer=3d` query or the
 * persisted setting — means the user (or the verifier, which runs on
 * SwiftShader) insisted, so it mounts regardless of tier.
 */
export function resolveMenuBackdrop(setting: RendererChoice): boolean {
  if (resolveRenderer(setting) !== '3d') return false;
  if (setting === '3d' || rendererOverride() !== null) return true;
  return pickTier(readDeviceHints(probeGL().renderer)) !== 'low';
}
