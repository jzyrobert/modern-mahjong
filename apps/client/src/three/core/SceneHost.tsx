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
  /**
   * True when this runtime lives in the `poolKey` pool: it outlives the
   * host that mounted it, so a subsystem may *park* its scene objects
   * on `dispose()` (leaving them in `scene`) for the next host with the
   * same key to pick up already compiled and uploaded. Anything parked
   * must register its final disposer in `onDestroy`, which runs when
   * the pooled runtime is eventually torn down.
   */
  pooled: boolean;
  onDestroy: Set<() => void>;
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
  /**
   * Share one renderer (canvas, WebGL context, compiled programs, loop,
   * camera rig) between successive hosts that pass the same key. On
   * unmount the runtime is *parked* instead of destroyed — the canvas
   * leaves the DOM, the loop stops — and the next host with the key
   * re-attaches it, so the scene it builds (see `SceneContext.pooled`)
   * starts with every shader compiled and every texture uploaded. A
   * parked runtime that nobody claims within `POOL_PARK_MS` is torn
   * down. Used by the pre-game lobby → match hand-off: the match's
   * first frame is a camera move onto the lobby's table, not a
   * multi-second compile stall under the opening rolls.
   */
  poolKey?: string;
}

const MAX_CONTEXT_LOSSES = 2;
/** How long a parked pooled runtime waits for its next host. */
export const POOL_PARK_MS = 20_000;

/**
 * Everything one WebGL context owns. Per-mount state (`host`, `handle`,
 * `maxDpr`, callbacks) is (re)assigned on attach so the loop's
 * closures read the *current* mount through this object.
 */
interface Runtime {
  renderer: WebGLRenderer;
  scene: Scene;
  rig: CameraRig;
  loop: Loop;
  perf: PerfMonitor;
  quality: QualityProfile;
  reducedMotion: boolean;
  canvas: HTMLCanvasElement;
  size: { width: number; height: number };
  ctx: SceneContext;
  /** Renderer-level props the runtime was created with. */
  signature: string;
  losses: number;
  // ── per-mount ──
  host: HTMLElement | null;
  handle: SceneHandle | null;
  build: ((ctx: SceneContext) => SceneHandle) | null;
  maxDpr: number | undefined;
  minDpr: number | undefined;
  awaitingFirstFrame: boolean;
  onReady: (() => void) | null;
  onFatal: ((reason: string) => void) | null;
  setVeil: ((v: 'loading' | 'restoring' | null) => void) | null;
  sizedOnce: boolean;
  parkTimer: ReturnType<typeof setTimeout> | null;
}

const POOL = new Map<string, Runtime>();

function createRuntime(
  signature: string,
  o: {
    transparent: boolean;
    clearColor: number;
    qualitySetting: Parameters<typeof resolveQuality>[0];
    animations: boolean;
    initialCamera: CameraPreset;
    pooled: boolean;
  },
): Runtime {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: o.transparent,
    powerPreference: 'high-performance',
    stencil: false,
  });
  const gl = renderer.getContext();
  const hints = readDeviceHints(gl);
  const quality = resolveQuality(o.qualitySetting, hints);
  const reducedMotion =
    !o.animations ||
    (typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);

  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = quality.shadowMapSize > 0;
  // r185 deprecates PCFSoftShadowMap (and falls back to this anyway).
  renderer.shadowMap.type = PCFShadowMap;
  if (!o.transparent) renderer.setClearColor(o.clearColor, 1);
  else renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const size = { width: 1, height: 1 };
  const rig = new CameraRig(o.initialCamera, 1);
  rig.parallaxEnabled = quality.parallax && !reducedMotion;
  // Reduced motion: preset changes settle in ≈ 120 ms like every
  // other tween (scenes may tighten this further, never loosen it).
  if (reducedMotion) rig.halfLife = 0.04;
  const perf = new PerfMonitor(renderer);
  perf.quality = quality.tier;

  const rt: Runtime = {
    renderer,
    scene,
    rig,
    loop: null as unknown as Loop,
    perf,
    quality,
    reducedMotion,
    canvas,
    size,
    ctx: null as unknown as SceneContext,
    signature,
    losses: 0,
    host: null,
    handle: null,
    build: null,
    maxDpr: undefined,
    minDpr: undefined,
    awaitingFirstFrame: true,
    onReady: null,
    onFatal: null,
    setVeil: null,
    sizedOnce: false,
    parkTimer: null,
  };

  const loop = new Loop({
    renderer,
    perf,
    render: () => {
      renderer.render(scene, rig.camera);
      if (rt.awaitingFirstFrame) {
        rt.awaitingFirstFrame = false;
        // Drivers compile pipelines asynchronously on the first draw;
        // without this the stall lands on the *next* frame's first GL
        // call and shows up in the perf ring as a multi-second frame.
        // Block here instead, inside the veiled warm-up frame that the
        // perf monitor already keeps out of p50 / p95.
        renderer.getContext().finish();
        rt.setVeil?.(null);
        rt.onReady?.();
        perf.maybePublish(performance.now(), true);
      }
    },
    overBudgetMs: DOWNGRADE_P95_MS,
    overBudgetWindowMs: DOWNGRADE_WINDOW_MS,
    onOverBudget: () => {
      if (rt.quality.tier === 'low') return;
      rt.quality = QUALITY_PROFILES[downgrade(rt.quality.tier)];
      perf.quality = rt.quality.tier;
      renderer.shadowMap.enabled = rt.quality.shadowMapSize > 0;
      rig.parallaxEnabled = rt.quality.parallax && !reducedMotion;
      rt.handle?.setQuality?.(rt.quality);
      applySize(rt);
    },
  });
  rt.loop = loop;
  rt.ctx = {
    renderer,
    scene,
    rig,
    loop,
    quality,
    reducedMotion,
    canvas,
    size,
    pooled: o.pooled,
    onDestroy: new Set(),
  };
  loop.add((dt, now) => rig.update(dt, now));
  loop.add((dt, now) => rt.handle?.update?.(dt, now) ?? false);

  canvas.addEventListener('webglcontextlost', (e: Event) => {
    e.preventDefault();
    rt.losses++;
    if (rt.losses > MAX_CONTEXT_LOSSES) {
      rt.onFatal?.('WebGL context lost repeatedly');
      return;
    }
    rt.setVeil?.('restoring');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    // Rebuild only while a host is attached; a parked runtime's next
    // attach builds afresh anyway.
    if (!rt.host || !rt.build) return;
    rt.handle?.dispose();
    rt.handle = null;
    scene.clear();
    rt.handle = rt.build(rt.ctx);
    rt.setVeil?.(null);
  });
  return rt;
}

/** Size the renderer to the attached host (no-op when nothing changed). */
function applySize(rt: Runtime): void {
  const host = rt.host;
  if (!host) return;
  const w = host.clientWidth || 1;
  const h = host.clientHeight || 1;
  const dpr = Math.max(
    rt.minDpr ?? 0,
    Math.min(window.devicePixelRatio || 1, rt.maxDpr ?? rt.quality.maxDpr),
  );
  // The ResizeObserver's initial callback and a `resize` event that
  // didn't touch this host would otherwise re-render an identical
  // frame — skip them (the quality downgrade changes `dpr`, so it
  // still gets through).
  if (
    rt.sizedOnce &&
    w === rt.size.width &&
    h === rt.size.height &&
    dpr === rt.renderer.getPixelRatio()
  )
    return;
  rt.sizedOnce = true;
  rt.size.width = w;
  rt.size.height = h;
  rt.renderer.setPixelRatio(dpr);
  rt.renderer.setSize(rt.size.width, rt.size.height, false);
  rt.rig.setAspect(rt.size.width / rt.size.height);
  rt.handle?.resize?.(rt.size.width, rt.size.height);
  rt.loop.requestRender();
}

function destroyRuntime(rt: Runtime, releaseContext: boolean): void {
  if (rt.parkTimer !== null) clearTimeout(rt.parkTimer);
  rt.parkTimer = null;
  rt.loop.stop();
  rt.handle?.dispose();
  rt.handle = null;
  for (const fn of rt.ctx.onDestroy) fn();
  rt.ctx.onDestroy.clear();
  rt.scene.clear();
  rt.perf.dispose();
  rt.renderer.dispose();
  if (releaseContext) rt.renderer.forceContextLoss();
  rt.canvas.remove();
}

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
  poolKey,
}: SceneHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
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
    const host = hostRef.current;
    if (!host) return;
    const signature = `${qualitySetting}|${animations}|${transparent}|${clearColor}`;

    // Claim a parked runtime with this key (same renderer-level props,
    // not attached elsewhere); otherwise create one.
    let rt: Runtime | undefined;
    let key = poolKey;
    if (key) {
      const parked = POOL.get(key);
      if (parked) {
        if (parked.host !== null) {
          // Another host holds it — this mount runs unpooled.
          key = undefined;
        } else if (parked.signature !== signature) {
          POOL.delete(key);
          destroyRuntime(parked, false);
        } else {
          rt = parked;
          if (rt.parkTimer !== null) clearTimeout(rt.parkTimer);
          rt.parkTimer = null;
          rt.perf.reset();
          rt.awaitingFirstFrame = true;
          rt.sizedOnce = false;
        }
      }
    }
    if (!rt) {
      try {
        rt = createRuntime(signature, {
          transparent,
          clearColor,
          qualitySetting,
          animations,
          initialCamera,
          pooled: key !== undefined,
        });
      } catch (e) {
        onFatalRef.current?.(`WebGLRenderer failed: ${String(e)}`);
        return;
      }
      if (key) POOL.set(key, rt);
    }
    const runtime = rt;
    let disposed = false;

    runtime.host = host;
    runtime.maxDpr = maxDpr;
    runtime.minDpr = minDpr;
    runtime.build = (ctx) => buildRef.current(ctx);
    runtime.onReady = () => {
      if (!disposed) onReadyRef.current?.();
    };
    runtime.onFatal = (reason) => {
      if (!disposed) onFatalRef.current?.(reason);
    };
    runtime.setVeil = (v) => {
      if (!disposed) setVeil(v);
    };
    // The canvas sits under the veil (React's only child of the host).
    host.prepend(runtime.canvas);

    runtime.handle = runtime.build(runtime.ctx);
    applySize(runtime);
    runtime.loop.requestRender();
    runtime.loop.start();

    const onResize = () => applySize(runtime);
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      runtime.loop.stop();
      runtime.handle?.dispose();
      runtime.handle = null;
      runtime.host = null;
      runtime.build = null;
      runtime.onReady = null;
      runtime.onFatal = null;
      runtime.setVeil = null;
      if (key && POOL.get(key) === runtime) {
        // Park: keep the context, programs and whatever the subsystem
        // left in the scene; drop the stale perf snapshot so nothing
        // reads the previous host's numbers while nothing renders.
        runtime.canvas.remove();
        runtime.perf.dispose();
        runtime.parkTimer = setTimeout(() => {
          if (POOL.get(key) === runtime && runtime.host === null) {
            POOL.delete(key);
            destroyRuntime(runtime, releaseContextOnUnmount);
          }
        }, POOL_PARK_MS);
      } else {
        destroyRuntime(runtime, releaseContextOnUnmount);
      }
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
    poolKey,
  ]);

  return (
    <div
      ref={hostRef}
      data-testid={testID}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: transparent ? 'transparent' : `#${clearColor.toString(16).padStart(6, '0')}`,
        ...style,
      }}
    >
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
