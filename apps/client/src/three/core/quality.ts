import type { QualityChoice } from '../../state/game';

/**
 * Quality tiers — see ARCHITECTURE.md §4. `auto` resolves from device
 * hints once at mount; the loop can downgrade one step (never upgrade)
 * when the measured p95 frame time stays above `DOWNGRADE_P95_MS` for
 * `DOWNGRADE_WINDOW_MS`.
 */
export type QualityTier = 'low' | 'mid' | 'high';

export interface QualityProfile {
  tier: QualityTier;
  /** Device-pixel-ratio clamp. */
  maxDpr: number;
  /** Shadow-map edge in texels; 0 disables shadows. */
  shadowMapSize: number;
  /** Environment reflections on tile / felt materials. */
  envReflections: boolean;
  /** Pointer / gyro camera parallax. */
  parallax: boolean;
  /** Bloom + vignette pass. */
  postFx: boolean;
  /** Anisotropic filtering on the face atlas. */
  anisotropy: number;
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  low: {
    tier: 'low',
    maxDpr: 1.5,
    shadowMapSize: 512,
    envReflections: false,
    parallax: false,
    postFx: false,
    anisotropy: 2,
  },
  mid: {
    tier: 'mid',
    maxDpr: 2,
    shadowMapSize: 1024,
    envReflections: true,
    parallax: true,
    postFx: false,
    anisotropy: 4,
  },
  high: {
    tier: 'high',
    maxDpr: 2,
    shadowMapSize: 2048,
    envReflections: true,
    parallax: true,
    postFx: true,
    anisotropy: 8,
  },
};

export const DOWNGRADE_P95_MS = 12;
export const DOWNGRADE_WINDOW_MS = 2000;

export interface DeviceHints {
  hardwareConcurrency?: number | undefined;
  deviceMemoryGb?: number | undefined;
  /** `(pointer: coarse)` — touch-first device. */
  coarsePointer?: boolean | undefined;
  /** Smaller viewport edge in CSS px. */
  shortEdgePx?: number | undefined;
  /** Renderer string from WEBGL_debug_renderer_info, lower-cased. */
  glRenderer?: string | undefined;
}

/** Pure tier pick from hints — unit-tested. */
export function pickTier(hints: DeviceHints): QualityTier {
  const gl = hints.glRenderer ?? '';
  // Software rasterisers (headless CI, VMs) get `low` so the verifier's
  // CPU-side numbers are comparable and shadows don't dominate.
  if (/swiftshader|llvmpipe|softpipe|mesa offscreen/.test(gl)) return 'low';
  const cores = hints.hardwareConcurrency ?? 8;
  const mem = hints.deviceMemoryGb ?? 8;
  if (cores <= 4 || mem <= 3) return 'low';
  if (hints.coarsePointer) return 'mid';
  if ((hints.shortEdgePx ?? 1080) < 900) return 'mid';
  return 'high';
}

/** Lower-cased unmasked renderer string (`WEBGL_debug_renderer_info`),
 *  falling back to `gl.RENDERER`; `undefined` when the context refuses. */
export function glRendererString(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
): string | undefined {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(raw).toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Device hints for `pickTier`. Pass a live context to read its renderer
 * string, or the already-lower-cased string itself when the caller only
 * has a cached probe (`renderer.ts` keeps one so universal code can ask
 * about the tier without opening a second context).
 */
export function readDeviceHints(
  gl?: WebGL2RenderingContext | WebGLRenderingContext | string,
): DeviceHints {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number };
  const glRenderer = typeof gl === 'string' ? gl : gl ? glRendererString(gl) : undefined;
  return {
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemoryGb: nav.deviceMemory,
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    shortEdgePx: Math.min(window.innerWidth, window.innerHeight),
    glRenderer,
  };
}

export function resolveQuality(setting: QualityChoice, hints: DeviceHints): QualityProfile {
  const tier: QualityTier = setting === 'auto' ? pickTier(hints) : setting;
  return QUALITY_PROFILES[tier];
}

export function downgrade(tier: QualityTier): QualityTier {
  return tier === 'high' ? 'mid' : 'low';
}
