import { type ComponentType, useEffect, useState } from 'react';

/** Upper bound on how long the scene import waits for an idle slot. */
const IDLE_TIMEOUT_MS = 1200;
/** Upper bound on how long the import waits for first contentful paint
 *  to be reported (a hidden tab never paints; Safari has no FCP entry). */
const FCP_TIMEOUT_MS = 3000;

const FCP = 'first-contentful-paint';

/**
 * Run `cb` once the browser has reported first contentful paint, or
 * after `FCP_TIMEOUT_MS`. Two animation frames after the lobby commits
 * are *usually* past FCP, but on a slow main thread the frames can
 * fire while the first paint is still pending — and the scene chunk's
 * fetch then competes with it. The paint entry is the ground truth.
 */
function afterFirstContentfulPaint(cb: () => void): () => void {
  const perf = globalThis.performance as Performance | undefined;
  if (perf?.getEntriesByType?.('paint').some((e) => e.name === FCP)) {
    cb();
    return () => {};
  }
  let done = false;
  let observer: PerformanceObserver | undefined;
  const timer = setTimeout(() => fire(), FCP_TIMEOUT_MS);
  const fire = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    observer?.disconnect();
    cb();
  };
  try {
    observer = new PerformanceObserver((list) => {
      if (list.getEntries().some((e) => e.name === FCP)) fire();
    });
    observer.observe({ type: 'paint', buffered: true });
  } catch {
    // No paint timing here — the timeout is the gate.
  }
  return () => {
    done = true;
    clearTimeout(timer);
    observer?.disconnect();
  };
}

/**
 * Run `cb` after the next paint, after first contentful paint has been
 * reported (`afterFirstContentfulPaint`) *and* once the main thread is
 * idle (`requestIdleCallback`, capped at `IDLE_TIMEOUT_MS`; a plain
 * timeout where rIC is missing — Safari). Returns a canceller.
 */
function afterPaintWhenIdle(cb: () => void): () => void {
  let raf = 0;
  let idle = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelFcp: (() => void) | undefined;
  const w = window as Window & {
    requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  // Two frames: the first fires before the pending commit paints.
  raf = requestAnimationFrame(() => {
    raf = requestAnimationFrame(() => {
      cancelFcp = afterFirstContentfulPaint(() => {
        if (w.requestIdleCallback) idle = w.requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS });
        else timer = setTimeout(cb, IDLE_TIMEOUT_MS);
      });
    });
  });
  return () => {
    cancelAnimationFrame(raf);
    cancelFcp?.();
    if (idle) w.cancelIdleCallback?.(idle);
    if (timer) clearTimeout(timer);
  };
}

type SceneModule = typeof import('./MenuSceneView');

/**
 * Pull the scene module (three + TilePool + atlas) in with a dynamic
 * import once the lobby has painted and the main thread has gone idle,
 * so the first paint, LCP and TBT are measured on the DOM menu alone.
 * Both menu canvases share the chunk — the second import resolves from
 * the module cache.
 */
function useLazyScene(pick: (m: SceneModule) => ComponentType): ComponentType | null {
  const [Scene, setScene] = useState<ComponentType | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pick` is a module-level selector
  useEffect(() => {
    let alive = true;
    const cancel = afterPaintWhenIdle(() => {
      import('./MenuSceneView')
        .then((m) => {
          if (alive) setScene(() => pick(m));
        })
        .catch((err) => {
          console.warn('Menu3D: scene failed to load', err);
        });
    });
    return () => {
      alive = false;
      cancel();
    };
  }, []);
  return Scene;
}

const pickDrift = (m: SceneModule) => m.MenuSceneView;
const pickHero = (m: SceneModule) => m.HeroSceneView;

/**
 * Zero-prop menu backdrop that fills its positioned parent: the drift
 * field in the fixed canvas behind the page (`MenuSceneView`).
 *
 * Web-only — `src/three/entry.tsx` exports `null` on native. Whether
 * to mount at all is `resolveMenuBackdrop()`'s call (`LobbyBackdrop`).
 */
export function Menu3DBackdrop() {
  const Scene = useLazyScene(pickDrift);
  return Scene ? <Scene /> : null;
}

/**
 * Zero-prop hero canvas that fills its positioned parent — the lobby's
 * hero band (`HeroBandSlot`), which is ScrollView content, so the rack
 * + dice scroll with the title on the compositor (`HeroSceneView`).
 */
export function Menu3DHero() {
  const Scene = useLazyScene(pickHero);
  return Scene ? <Scene /> : null;
}
