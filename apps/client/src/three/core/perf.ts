import { Vector2, type WebGLRenderer } from 'three';
import type { QualityTier } from './quality';

/**
 * Frame-time ring buffer + `renderer.info` sampler. Publishes
 * `window.__MAHJONG_PERF__` once a second so the screenshot verifier
 * (`scripts/shot.mjs`) and the `three-*` Playwright specs can read a
 * device-independent budget (draw calls, triangles, programs, JS frame
 * time) — see ARCHITECTURE.md §4 / §6.
 */
export interface PerfSnapshot {
  renderer: '3d';
  quality: QualityTier;
  /** Rendered frames over the last sampling second. 0 when idle. */
  fps: number;
  /** p50 / p95 of `update + render` JS time per rendered frame, ms. */
  frameMsP50: number;
  frameMsP95: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  programs: number;
  /** True when the loop has been render-on-demand idle for ≥ 500 ms. */
  idle: boolean;
  /** Total renders since mount — lets tests assert "nothing re-rendered". */
  renders: number;
  /**
   * JS time of the very first render (shader compile + first upload),
   * kept out of the p50 / p95 ring so a scene that idles after a frame
   * or two reports its steady-state cost, not its warm-up.
   */
  warmupMs: number;
  dpr: number;
  width: number;
  height: number;
  /** Monotonic sample counter — tests wait for it to advance. */
  sample: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_PERF__: PerfSnapshot | undefined;
}

const RING = 120;
/**
 * Rendered frames skipped before the ring starts sampling. The first
 * frames pay for shader compilation + texture upload (hundreds of ms
 * on SwiftShader); a scene that then idles would otherwise report
 * that warm-up as its steady-state p95 forever.
 */
export const WARMUP_FRAMES = 4;

export class PerfMonitor {
  private times = new Float32Array(RING);
  private head = 0;
  private count = 0;
  private framesThisSecond = 0;
  private lastPublish = 0;
  private lastRenderAt = 0;
  private renders = 0;
  private sample = 0;
  private warmupMs = 0;
  quality: QualityTier = 'mid';

  constructor(private readonly renderer: WebGLRenderer) {}

  /** Call once per rendered frame with the JS time the frame took. */
  recordFrame(frameMs: number, now: number): void {
    // The very first render is reported separately (`warmupMs`); the
    // next few are still paying for uploads on a software rasteriser,
    // so the ring only starts after `WARMUP_FRAMES`.
    if (this.renders === 0) this.warmupMs = frameMs;
    this.framesThisSecond++;
    this.renders++;
    this.lastRenderAt = now;
    if (this.renders <= WARMUP_FRAMES) return;
    this.times[this.head] = frameMs;
    this.head = (this.head + 1) % RING;
    if (this.count < RING) this.count++;
  }

  /** p95 over the ring — used by the auto-downgrade in the loop. */
  p95(): number {
    return this.percentile(0.95);
  }

  private percentile(p: number): number {
    if (this.count === 0) return 0;
    const arr = Array.from(this.times.subarray(0, this.count)).sort((a, b) => a - b);
    const idx = Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)));
    return arr[idx] ?? 0;
  }

  /** Publish at most once per second. Cheap when it early-returns. */
  maybePublish(now: number, force = false): void {
    if (!force && now - this.lastPublish < 1000) return;
    this.lastPublish = now;
    const info = this.renderer.info;
    const size = this.renderer.getSize(tmpSize);
    const snap: PerfSnapshot = {
      renderer: '3d',
      quality: this.quality,
      fps: this.framesThisSecond,
      frameMsP50: round(this.percentile(0.5)),
      frameMsP95: round(this.percentile(0.95)),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      programs: info.programs?.length ?? 0,
      idle: now - this.lastRenderAt > 500,
      renders: this.renders,
      warmupMs: round(this.warmupMs),
      dpr: this.renderer.getPixelRatio(),
      width: size.x,
      height: size.y,
      sample: ++this.sample,
    };
    this.framesThisSecond = 0;
    globalThis.__MAHJONG_PERF__ = snap;
  }

  dispose(): void {
    globalThis.__MAHJONG_PERF__ = undefined;
  }
}

const tmpSize = new Vector2();

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
