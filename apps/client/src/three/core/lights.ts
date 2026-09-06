import {
  AmbientLight,
  CanvasTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  HemisphereLight,
  PMREMGenerator,
  SRGBColorSpace,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { QualityProfile } from './quality';

/**
 * Standard light set: one warm key (shadow-casting on mid/high), one
 * sky/ground hemisphere, a low ambient floor, and a procedural
 * gradient environment run through PMREM for tile-ivory reflections.
 * No external HDRI (asset policy §5) — the "studio" is painted onto a
 * 256×128 canvas.
 */
export interface LightRig {
  key: DirectionalLight;
  hemi: HemisphereLight;
  ambient: AmbientLight;
  env: Texture | null;
  dispose(): void;
}

export function buildLights(
  scene: Scene,
  renderer: WebGLRenderer,
  quality: QualityProfile,
  opts: { keyColor?: number; skyColor?: number; groundColor?: number; shadowExtent?: number } = {},
): LightRig {
  const key = new DirectionalLight(opts.keyColor ?? 0xfff2dc, 2.6);
  key.position.set(4, 9, 5);
  key.castShadow = quality.shadowMapSize > 0;
  if (key.castShadow) {
    key.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const e = opts.shadowExtent ?? 9;
    key.shadow.camera.left = -e;
    key.shadow.camera.right = e;
    key.shadow.camera.top = e;
    key.shadow.camera.bottom = -e;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
  }
  scene.add(key);
  scene.add(key.target);

  const hemi = new HemisphereLight(opts.skyColor ?? 0xdbe7ff, opts.groundColor ?? 0x3a4a3a, 0.9);
  scene.add(hemi);
  const ambient = new AmbientLight(0xffffff, 0.15);
  scene.add(ambient);

  let env: Texture | null = null;
  if (quality.envReflections) {
    env = buildStudioEnv(renderer);
    scene.environment = env;
    scene.environmentIntensity = 0.6;
  }

  return {
    key,
    hemi,
    ambient,
    env,
    dispose() {
      scene.remove(key, key.target, hemi, ambient);
      key.dispose();
      hemi.dispose();
      ambient.dispose();
      if (env) {
        scene.environment = null;
        env.dispose();
      }
    },
  };
}

/** Procedural "soft box studio" equirect → PMREM. */
export function buildStudioEnv(renderer: WebGLRenderer): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#f4f7ff');
  g.addColorStop(0.45, '#9aa8b8');
  g.addColorStop(0.5, '#4c5a52');
  g.addColorStop(1, '#1b221d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  // Two soft "light panels" above the table for crisp tile speculars.
  ctx.fillStyle = 'rgba(255,250,235,0.85)';
  roundRect(ctx, 40, 10, 60, 26, 10);
  roundRect(ctx, 150, 14, 70, 22, 10);
  const tex = new CanvasTexture(canvas);
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = SRGBColorSpace;
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return target.texture;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
