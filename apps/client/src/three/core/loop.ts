import type { WebGLRenderer } from 'three';
import type { PerfMonitor } from './perf';

/**
 * The single requestAnimationFrame loop. Render-on-demand: each
 * registered updater returns `true` while it still has motion; when
 * every updater is quiet and nobody called `requestRender()`, the loop
 * keeps ticking (cheap — no GPU work) but skips `renderer.render`. Tab
 * hidden → the loop pauses entirely.
 */
export type Updater = (dt: number, now: number) => boolean;

export interface LoopOptions {
  renderer: WebGLRenderer;
  render: () => void;
  perf: PerfMonitor;
  /** Called when p95 frame time stays over budget — see quality.ts. */
  onOverBudget?: (() => void) | undefined;
  overBudgetMs?: number | undefined;
  overBudgetWindowMs?: number | undefined;
}

export class Loop {
  private updaters = new Set<Updater>();
  private raf = 0;
  private running = false;
  private last = 0;
  private dirty = true;
  private overSince = 0;
  private visibilityHandler = () => {
    if (document.visibilityState === 'hidden') this.pause();
    else if (this.running) this.resume();
  };

  constructor(private readonly opts: LoopOptions) {}

  add(u: Updater): () => void {
    this.updaters.add(u);
    this.dirty = true;
    return () => {
      this.updaters.delete(u);
    };
  }

  requestRender(): void {
    this.dirty = true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    document.addEventListener('visibilitychange', this.visibilityHandler);
    if (document.visibilityState !== 'hidden') this.resume();
  }

  stop(): void {
    this.running = false;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.pause();
  }

  private pause(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resume(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    // Clamp dt so a background tab returning doesn't teleport tweens.
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const t0 = performance.now();
    let live = false;
    for (const u of this.updaters) {
      if (u(dt, now)) live = true;
    }
    if (live || this.dirty) {
      this.dirty = false;
      this.opts.render();
      const cost = performance.now() - t0;
      this.opts.perf.recordFrame(cost, now);
      const budget = this.opts.overBudgetMs ?? 12;
      const win = this.opts.overBudgetWindowMs ?? 2000;
      if (this.opts.onOverBudget && this.opts.perf.p95() > budget) {
        if (this.overSince === 0) this.overSince = now;
        else if (now - this.overSince > win) {
          this.overSince = 0;
          this.opts.onOverBudget();
        }
      } else {
        this.overSince = 0;
      }
    }
    this.opts.perf.maybePublish(now);
  };
}
