import type { QualityChoice, RendererChoice } from '../../state/game';

/**
 * Option lists + hint copy for the settings panel's segmented
 * controls. Pure data so the copy can be unit-tested and reused by a
 * future 3D HUD without importing React Native.
 */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export const RENDERER_OPTIONS: readonly SegmentOption<RendererChoice>[] = [
  { value: 'auto', label: 'Auto' },
  { value: '3d', label: '3D' },
  { value: 'classic', label: 'Classic' },
];

export const QUALITY_OPTIONS: readonly SegmentOption<QualityChoice>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
  { value: 'high', label: 'High' },
];

export const RENDERER_HINT = '3D needs WebGL2; Classic is the original table.';

export interface RendererOverrideInfo {
  value: '3d' | 'classic';
  source: 'test' | 'query';
}

/**
 * Second hint line under the renderer control. When a session override
 * (`?renderer=` or the test harness) is deciding instead of the setting,
 * say so — otherwise "Resolves to 3D" next to a "Classic active" pill
 * reads as a contradiction.
 */
export function rendererDetail(
  choice: RendererChoice,
  webgl2: boolean,
  override: RendererOverrideInfo | null = null,
): string {
  if (override) {
    const to = override.value === '3d' ? '3D' : 'Classic';
    const by = override.source === 'query' ? `?renderer=${override.value}` : 'the test harness';
    return `Overridden to ${to} for this session by ${by}. Your choice applies next visit.`;
  }
  switch (choice) {
    case 'auto':
      return webgl2
        ? 'Resolves to 3D on this device. Switches immediately.'
        : 'WebGL2 is unavailable here, so Auto resolves to Classic.';
    case '3d':
      return webgl2
        ? 'Physically lit table, one draw call for all 136 tiles.'
        : 'This browser has no WebGL2 — the Classic table will show instead.';
    case 'classic':
      return 'The original flat table. Lightest on battery.';
  }
}

export function qualityHint(choice: QualityChoice): string {
  switch (choice) {
    case 'auto':
      return 'Picks a tier from your device and steps down if frames drop.';
    case 'low':
      return 'Sharpness capped at 1.5×, small shadows, no reflections. Best battery.';
    case 'mid':
      return 'Full sharpness, soft shadows, reflections. The phone default.';
    case 'high':
      return 'Everything on: large shadows, reflections, bloom + vignette.';
  }
}
