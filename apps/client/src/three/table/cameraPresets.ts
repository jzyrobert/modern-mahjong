import type { CameraPreset } from '../core/camera';

/**
 * Camera presets per viewport class. Numbers were tuned against the
 * table metrics in `layout.ts` (hand row at z ≈ 10.5, walls at 8.8,
 * rail out to 13): phone portrait fits the 14-tile hand across the
 * width with the whole table stacked above it, phone landscape sits
 * lower and wider, desktop is the cinematic 3/4 view.
 */
export type ViewportClass = 'phone-portrait' | 'phone-landscape' | 'desktop';

export function classifyViewport(width: number, height: number): ViewportClass {
  if (width >= 768 && height >= 600) return 'desktop';
  return width > height ? 'phone-landscape' : 'phone-portrait';
}

export const TABLE_CAMERA: Record<ViewportClass, CameraPreset> = {
  // Steep (~75°) so the 14-tile hand fills the width and the whole
  // square table still fits above it; the hand leans back to meet it.
  'phone-portrait': { position: [0, 34, 19.5], target: [0, 0, -1.3], fov: 58 },
  // Lower and wider — the near hand is large, the far side compresses.
  'phone-landscape': { position: [0, 10.5, 20], target: [0, 0, 3.5], fov: 44 },
  // Cinematic 3/4 view with the full table in frame.
  desktop: { position: [0, 22, 25], target: [0, 0, 1.5], fov: 40 },
};

/** Straight-on view of the debug tile sheet. */
export const SHEET_CAMERA: CameraPreset = {
  position: [0, 7.5, 12.5],
  target: [0, 0.5, 0],
  fov: 42,
};

/**
 * Sheet camera that fits the 9-column sheet (≈ 11.3 world units wide)
 * at any aspect: distance scales with 1 / aspect, elevation stays ~55°
 * so the leaning faces read square-on.
 */
export function sheetCameraFor(width: number, height: number): CameraPreset {
  const aspect = Math.max(0.3, width / Math.max(1, height));
  const fov = 42;
  const halfTanH = Math.tan((fov * Math.PI) / 360) * aspect;
  // Never closer than 14: the four rows span ±3.8 in z and the near
  // (honours) row would otherwise clip at wide aspects.
  const dist = Math.max(14, 6.1 / halfTanH + 1.5);
  const elev = (55 * Math.PI) / 180;
  return {
    position: [0, dist * Math.sin(elev) + 0.4, dist * Math.cos(elev) + 0.4],
    target: [0, 0.4, 0.4],
    fov,
  };
}

export function cameraFor(width: number, height: number): CameraPreset {
  return TABLE_CAMERA[classifyViewport(width, height)];
}
