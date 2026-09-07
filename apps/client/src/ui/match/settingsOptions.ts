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

/** Geometry of a `SkinChip` (swatch + label pill) in CSS px. */
export interface ChipMetrics {
  /** Swatch width inside the pill. */
  swatchWidth: number;
  /** Pill padding on the swatch side. */
  padLeft: number;
  /** Gap between swatch and label. */
  gap: number;
  /** Pill padding on the label side. */
  padRight: number;
  /** Pill border, each side. */
  border: number;
  /** Conservative advance per label character (13 px / 700 sans). */
  charWidth: number;
}

export const CHIP_METRICS: Omit<ChipMetrics, 'swatchWidth'> = {
  padLeft: 6,
  gap: 10,
  padRight: 14,
  border: 2,
  charWidth: 8.5,
};

/**
 * Narrowest pill that still holds the longest of `labels` on one line
 * — the chip row never lays chips out below this width, so a label can
 * never pop out of its pill (the round-1 "Cream" overflow at phone
 * widths, where a fixed 20 % basis left ~35 px for a 43 px word).
 */
export function chipMinWidth(labels: readonly string[], m: ChipMetrics): number {
  const longest = labels.reduce((n, l) => Math.max(n, l.length), 0);
  return m.swatchWidth + m.padLeft + m.gap + m.padRight + 2 * m.border + longest * m.charWidth;
}

/**
 * Column count + chip width for a wrapped chip row of `count` chips,
 * each at least `minChip` wide, in a row `rowWidth` wide with `gap`
 * between chips. Prefers a column count that divides `count` so the
 * rows stay even (4 chips → 4 / 2 / 1, never 3 + 1); a ragged grid is
 * only used when nothing even fits and more than one column does.
 * Returns `columns: 0` before the row has been measured so the caller
 * can fall back to content sizing.
 */
export function chipGrid(
  rowWidth: number,
  count: number,
  minChip: number,
  gap: number,
): { columns: number; chipWidth: number } {
  if (rowWidth <= 0 || count <= 0) return { columns: 0, chipWidth: 0 };
  const fit = Math.max(1, Math.floor((rowWidth + gap) / (minChip + gap)));
  const cap = Math.min(fit, count);
  let columns = 1;
  for (let c = cap; c >= 1; c--) {
    if (count % c === 0) {
      columns = c;
      break;
    }
  }
  if (columns === 1 && cap > 1) columns = cap;
  const chipWidth = Math.floor((rowWidth - gap * (columns - 1)) / columns);
  return { columns, chipWidth };
}
