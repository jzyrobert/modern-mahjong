import { useEffect, useRef, useState } from 'react';
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, Scene, WebGLRenderer } from 'three';
import { useGame } from '../../state/game';
import { type CameraPreset, CameraRig } from './camera';
import { Loop } from './loop';
import { PerfMonitor } from './perf';
import {
  DOWNGRADE_P95_MS,
  DOWNGRADE_WINDOW_MS,
  QUALITY_PROFILES,
  type QualityProfile,
  downgrade,
  readDeviceHints,
  resolveQuality,
} from './quality';

/**
 * The one React ↔ three bridge. Owns the `<canvas>`, the renderer, the
 * loop, the camera rig, quality resolution and context-loss recovery.
 * Subsystems pass a `build` callback that receives a `SceneContext`
 * and returns a `SceneHandle`; everything inside is imperative three.
 *
 * Web-only (DOM canvas). `src/three/entry.tsx` guards the import so
 * native never reaches this file.
 */
export interface SceneContext {
  renderer: WebGLRenderer;
  scene: Scene;
  rig: CameraRig;
  loop: Loop;
  quality: QualityProfile;
  reducedMotion: boolean;
  canvas: HTMLCanvasElement;
  /** CSS-pixel size. */
  size: { width: number; height: number };
}

export interface SceneHandle {
  /** Return true while animating (keeps the loop rendering). */
  update?: (dt: number, now: number) => boolean;
  resize?: (width: number, height: number) => void;
  /** Called on quality downgrade / restore; rebuild shadow maps etc. */
  setQuality?: (q: QualityProfile) => void;
  dispose: () => void;
}

export interface SceneHostProps {
  build: (ctx: SceneContext) => SceneHandle;
  initialCamera: CameraPreset;
  /** Fill colour behind the scene (also painted as CSS background). */
  clearColor?: number;
  /** `alpha: true` renders over the page background. */
  transparent?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Fires once the first frame has rendered. */
  onReady?: () => void;
  /** Fires when WebGL gives up twice — caller falls back to classic. */
  onFatal?: (reason: string) => void;
  /** Stable key — bumping it rebuilds the scene (e.g. skin change). */
  rebuildKey?: string;
  testID?: string;
  /**
   * Explicitly lose the WebGL context on unmount (after `dispose()`).
   * Browsers cap live contexts at ~16 and only reclaim them on GC, so
   * a canvas that mounts/unmounts often (the settings preview inside
   * a modal) should release eagerly. Off by default — a full-screen
   * scene that remounts rarely doesn't need it.
   */
  releaseContextOnUnmount?: boolean;
  /**
   * Override the quality tier's device-pixel-ratio clamp. The tier cap
   * protects a full-screen table; a small canvas (the settings preview
   * is ~400 CSS px wide and a few thousand triangles) can afford full
   * sharpness on every tier so face glyphs stay crisp.
   */
  maxDpr?: number;
  /**
   * Floor for the device-pixel-ratio — supersampling for a small canvas
   * on a dpr-1 display (the settings preview at 1440×900 showed stair-
   * step tile edges; `antialias: true` is not honoured everywhere).
   * Applied after `maxDpr`, so `minDpr: 2, maxDpr: 2` pins 2×.
   */
  minDpr?: number;
}

const MAX_CONTEXT_LOSSES = 2;

export function SceneHost({
  build,
  initialCamera,
  clearColor = 0x0d1411,
  transparent = false,
  style,
  onReady,
  onFatal,
  rebuildKey,
  testID,
  releaseContextOnUnmount = false,
  maxDpr,
  minDpr,
}: SceneHostProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onFatalRef = useRef(onFatal);
  onFatalRef.current = onFatal;
  const [veil, setVeil] = useState<'loading' | 'restoring' | null>('loading');
  const qualitySetting = useGame((s) => s.settings.quality);
  const animations = useGame((s) => s.settings.animations);

  // `build` / `onReady` / `onFatal` are read through refs so parents can
  // pass inline lambdas; `rebuildKey` is the explicit "tear down and
  // rebuild" signal (skin change etc.).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement;
    if (!host) return;
    let disposed = false;
    let losses = 0;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: transparent,
        powerPreference: 'high-performance',
        stencil: false,
      });
    } catch (e) {
      onFatalRef.current?.(`WebGLRenderer failed: ${String(e)}`);
      return;
    }
    const gl = renderer.getContext();
    const hints = readDeviceHints(gl);
    let quality = resolveQuality(qualitySetting, hints);
    const reducedMotion =
      !animations ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = quality.shadowMapSize > 0;
    // r185 deprecates PCFSoftShadowMap (and falls back to this anyway).
    renderer.shadowMap.type = PCFShadowMap;
    if (!transparent) renderer.setClearColor(clearColor, 1);
    else renderer.setClearColor(0x000000, 0);

    const scene = new Scene();
    const size = { width: host.clientWidth || 1, height: host.clientHeight || 1 };
    const rig = new CameraRig(initialCamera, size.width / size.height);
    rig.parallaxEnabled = quality.parallax && !reducedMotion;
    const perf = new PerfMonitor(renderer);
    perf.quality = quality.tier;

    let sizedOnce = false;
    const applySize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      const dpr = Math.max(
        minDpr ?? 0,
        Math.min(window.devicePixelRatio || 1, maxDpr ?? quality.maxDpr),
      );
      // The ResizeObserver's initial callback and a `resize` event that
      // didn't touch this host would otherwise re-render an identical
      // frame — skip them (the quality downgrade changes `dpr`, so it
      // still gets through).
      if (sizedOnce && w === size.width && h === size.height && dpr === renderer.getPixelRatio())
        return;
      sizedOnce = true;
      size.width = w;
      size.height = h;
      renderer.setPixelRatio(dpr);
      renderer.setSize(size.width, size.height, false);
      rig.setAspect(size.width / size.height);
      handle?.resize?.(size.width, size.height);
      loop.requestRender();
    };

    let handle: SceneHandle | null = null;
    let firstFrame = true;
    const loop = new Loop({
      renderer,
      perf,
      render: () => {
        renderer.render(scene, rig.camera);
        if (firstFrame) {
          firstFrame = false;
          // Drivers compile pipelines asynchronously on the first draw;
          // without this the stall lands on the *next* frame's first GL
          // call and shows up in the perf ring as a multi-second frame.
          // Block here instead, inside the veiled warm-up frame that the
          // perf monitor already keeps out of p50 / p95.
          renderer.getContext().finish();
          setVeil(null);
          onReadyRef.current?.();
          perf.maybePublish(performance.now(), true);
        }
      },
      overBudgetMs: DOWNGRADE_P95_MS,
      overBudgetWindowMs: DOWNGRADE_WINDOW_MS,
      onOverBudget: () => {
        if (quality.tier === 'low') return;
        quality = QUALITY_PROFILES[downgrade(quality.tier)];
        perf.quality = quality.tier;
        renderer.shadowMap.enabled = quality.shadowMapSize > 0;
        rig.parallaxEnabled = quality.parallax && !reducedMotion;
        handle?.setQuality?.(quality);
        applySize();
      },
    });

    const ctx: SceneContext = {
      renderer,
      scene,
      rig,
      loop,
      quality,
      reducedMotion,
      canvas,
      size,
    };

    const mount = () => {
      handle = buildRef.current(ctx);
      applySize();
      loop.requestRender();
    };
    const unmount = () => {
      handle?.dispose();
      handle = null;
      scene.clear();
    };

    loop.add((dt) => rig.update(dt));
    loop.add((dt, now) => handle?.update?.(dt, now) ?? false);
    mount();
    loop.start();

    const ro = new ResizeObserver(applySize);
    ro.observe(host);
    window.addEventListener('resize', applySize);

    const onLost = (e: Event) => {
      e.preventDefault();
      losses++;
      if (losses > MAX_CONTEXT_LOSSES) {
        onFatalRef.current?.('WebGL context lost repeatedly');
        return;
      }
      setVeil('restoring');
    };
    const onRestored = () => {
      if (disposed) return;
      unmount();
      mount();
      setVeil(null);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    return () => {
      disposed = true;
      ro.disconnect();
      window.removeEventListener('resize', applySize);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      loop.stop();
      unmount();
      perf.dispose();
      renderer.dispose();
      if (releaseContextOnUnmount) renderer.forceContextLoss();
    };
  }, [
    rebuildKey,
    qualitySetting,
    animations,
    transparent,
    clearColor,
    releaseContextOnUnmount,
    maxDpr,
    minDpr,
  ]);

  return (
    <div
      data-testid={testID}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: transparent ? 'transparent' : `#${clearColor.toString(16).padStart(6, '0')}`,
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
      />
      {veil ? (
        <div
          data-testid="scene-veil"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.7)',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 13,
            letterSpacing: 2,
            textTransform: 'uppercase',
            pointerEvents: 'none',
          }}
        >
          {veil === 'restoring' ? 'Restoring table…' : ''}
        </div>
      ) : null}
    </div>
  );
}
