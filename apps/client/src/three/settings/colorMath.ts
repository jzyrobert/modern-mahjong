/**
 * Small sRGB → CIE Lab helpers for comparing a rendered pixel against a
 * skin hex stop. Pure and dependency-free so the Playwright spec can
 * import it directly (it decodes 1×1 clip screenshots) and vitest can
 * pin the maths.
 */
export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const v = Number.parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/** CIE Lab (D65) from 8-bit sRGB. */
export function rgbToLab(rgb: Rgb): [number, number, number] {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference. ~2.3 is a just-noticeable difference. */
export function deltaE(a: Rgb, b: Rgb): number {
  const la = rgbToLab(a);
  const lb = rgbToLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** Smallest ΔE between `rgb` and any of `targets` (e.g. a skin's two stops). */
export function nearestDeltaE(rgb: Rgb, targets: readonly Rgb[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const t of targets) best = Math.min(best, deltaE(rgb, t));
  return best;
}

/**
 * Smallest ΔE between `rgb` and any colour along the straight sRGB
 * gradient from `a` to `b` — a rendered gradient face is on-target when
 * every pixel sits near *some* point of the swatch's gradient, not only
 * near its two stops.
 */
export function gradientDeltaE(rgb: Rgb, a: Rgb, b: Rgb, steps = 40): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const c: Rgb = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    best = Math.min(best, deltaE(rgb, c));
  }
  return best;
}

/** Relative luminance (WCAG) from 8-bit sRGB. */
export function luminance(rgb: Rgb): number {
  return (
    0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2])
  );
}

/** WCAG contrast ratio between two opaque colours. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a) + 0.05;
  const lb = luminance(b) + 0.05;
  return la > lb ? la / lb : lb / la;
}

/** Composite `fg` with alpha `alpha` over opaque `bg`. */
export function blendOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
  ];
}
