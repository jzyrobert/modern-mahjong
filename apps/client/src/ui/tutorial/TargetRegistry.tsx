import {
  type ReactNode,
  type RefObject,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useSyncExternalStore } from 'react';
import { Platform, type StyleProp, View, type ViewStyle } from 'react-native';
import { LESSONS, useTutorial } from '../../state/tutorial';
import type { TutorialTargetId } from './types';

export interface TargetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TargetRegistryApi {
  /** Components register themselves on layout. Repeated calls overwrite
   *  the previous rect; passing `null` clears the entry (used on
   *  unmount). */
  set(id: TutorialTargetId, rect: TargetRect | null): void;
  /** Read current rect for an id, or null if unregistered. */
  read(id: TutorialTargetId): TargetRect | null;
  /** Subscribe to changes; called whenever any rect is written. */
  subscribe(cb: () => void): () => void;
  /** Subscribe to writes for ONE id (additive, PR 3D-tutorial). The
   *  3D table re-registers its projected hit-target rects on every
   *  frame while the camera eases; per-id listeners let the overlay
   *  follow just its active target without waking on every other
   *  write. */
  subscribeTo(id: TutorialTargetId, cb: (rect: TargetRect | null) => void): () => void;
  /** Monotonic counter bumped on every accepted write — lets a
   *  `requestAnimationFrame` poller detect "something moved" with
   *  one integer compare instead of diffing rects. */
  version(): number;
  /** Sentinel root the registry uses as the origin for all rects.
   *  Targets store `(target.window.x - root.window.x, target.window.y
   *  - root.window.y)` in the registry; `<TutorialOverlay>` is mounted
   *  inside this same root and paints halos in matching local
   *  coordinates, so the offset subtraction cancels Android Fabric's
   *  negative activity-content-frame y in edge-to-edge mode and the
   *  overlay needs no further safe-area correction. */
  rootRef: RefObject<View | null>;
}

const noopApi: TargetRegistryApi = {
  set: () => {},
  read: () => null,
  subscribe: () => () => {},
  subscribeTo: () => () => {},
  version: () => 0,
  rootRef: { current: null },
};

const TargetRegistryContext = createContext<TargetRegistryApi>(noopApi);

interface TargetRegistryProviderProps {
  children: ReactNode;
}

/**
 * Cross-shell registry of `<TutorialTarget>` rects, in screen
 * coordinates. Mounted once at app root (`apps/client/app/_layout.tsx`)
 * so a target's id survives route + shell swaps (e.g. desktop ↔
 * mobile on rotation). Modeled on `FlipBag.tsx`'s rect cache pattern.
 *
 * The registry is reactive: `<TutorialOverlay>` reads the active
 * target's rect via `useTutorialTargetRect(id)` (which is a small
 * `useSyncExternalStore` wrapper) so it re-renders precisely when
 * that one rect changes — not every other re-layout.
 */
export function TargetRegistryProvider({ children }: TargetRegistryProviderProps) {
  // The store is a plain Map plus a tiny pub/sub. We deliberately
  // avoid zustand here — the registry's writers are inside `onLayout`
  // callbacks that fire on *every* render of the underlying View,
  // so we need write/no-op semantics that don't trigger a top-level
  // store re-render every time. A Map ref + a manual notify gives
  // us that without the zustand selector machinery.
  const map = useRef(new Map<TutorialTargetId, TargetRect>()).current;
  const listeners = useRef(new Set<() => void>()).current;
  const idListeners = useRef(
    new Map<TutorialTargetId, Set<(rect: TargetRect | null) => void>>(),
  ).current;
  const versionRef = useRef(0);
  const rootRef = useRef<View | null>(null);

  const api = useMemo<TargetRegistryApi>(
    () => ({
      set(id, rect) {
        if (rect === null) {
          if (!map.has(id)) return;
          map.delete(id);
        } else {
          const prev = map.get(id);
          // Skip notifying when the rect hasn't meaningfully changed.
          // `onLayout` fires on every render of the View; for static
          // targets this would otherwise be O(renders) notifications.
          if (
            prev &&
            Math.abs(prev.x - rect.x) < 0.5 &&
            Math.abs(prev.y - rect.y) < 0.5 &&
            Math.abs(prev.w - rect.w) < 0.5 &&
            Math.abs(prev.h - rect.h) < 0.5
          ) {
            return;
          }
          map.set(id, rect);
        }
        versionRef.current++;
        for (const l of listeners) l();
        const perId = idListeners.get(id);
        if (perId) {
          const value = map.get(id) ?? null;
          for (const l of perId) l(value);
        }
      },
      read(id) {
        return map.get(id) ?? null;
      },
      subscribe(cb) {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
      subscribeTo(id, cb) {
        let set = idListeners.get(id);
        if (!set) {
          set = new Set();
          idListeners.set(id, set);
        }
        set.add(cb);
        return () => {
          set?.delete(cb);
        };
      },
      version() {
        return versionRef.current;
      },
      rootRef,
    }),
    [listeners, idListeners, map],
  );

  return (
    <TargetRegistryContext.Provider value={api}>
      <View ref={rootRef} style={{ flex: 1 }} collapsable={false}>
        {children}
      </View>
    </TargetRegistryContext.Provider>
  );
}

export type { TargetRegistryApi };

export function useTargetRegistry(): TargetRegistryApi {
  return useContext(TargetRegistryContext);
}

/**
 * Subscribe to a single target's rect. Returns null when the id has
 * no live registration. The overlay drives its halo/caption position
 * off this — when the targeted element re-layouts (e.g. rotation),
 * the rect changes and the overlay re-positions automatically.
 */
export function useTutorialTargetRect(id: TutorialTargetId | null): TargetRect | null {
  const api = useTargetRegistry();
  // `useSyncExternalStore` re-runs `getSnapshot` on every notify and
  // bails on `Object.is` equality; we return the same object instance
  // when nothing changed (the registry's same-rect-skip above already
  // gives us reference stability), so this fires precisely once per
  // real change.
  return useSyncExternalStore(
    (cb) => api.subscribe(cb),
    () => (id ? api.read(id) : null),
    () => null,
  );
}

interface TutorialTargetProps {
  id: TutorialTargetId;
  children: ReactNode;
  /** When false, the wrapper still renders but doesn't register —
   *  used to suppress targets that exist in the tree but aren't the
   *  "primary" one for that lesson concept (e.g. the mobile shell
   *  may render the menu pill in two places; only one should
   *  register). */
  enabled?: boolean;
  /** Forwarded to the wrapping `<View>`. Needed when the target sits
   *  in a flex-constrained slot (e.g. the discard pool's `flex: 1`
   *  parent on mobile) — without `flex: 1, minHeight: 0` on the
   *  wrapper the inner ScrollView can't compute its scroll area and
   *  silently overflows instead. Defaults to undefined so existing
   *  content-fit usages keep their previous layout. */
  style?: StyleProp<ViewStyle>;
}

interface MeasurableNode {
  measureInWindow: (
    onSuccess: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

/**
 * Wrap any visual that a lesson step might want to anchor a coach-mark
 * to. The wrapper measures itself on layout (`measureInWindow`,
 * absolute screen coordinates — same primitive `FlipBag` uses for
 * tile FLIP) and registers the rect with the surrounding registry.
 * Unmount clears the entry so a stale rect doesn't outlive its source.
 */
export function TutorialTarget({ id, children, enabled = true, style }: TutorialTargetProps) {
  const api = useTargetRegistry();
  const ref = useRef<MeasurableNode | null>(null);
  // Flips to true in the unmount effect so any rAF or async
  // `measureInWindow` callback still in flight from a previous
  // render no-ops instead of writing a stale rect back into the
  // registry after the unmount has already cleared the entry —
  // which would re-paint the halo at a dead location.
  const cancelledRef = useRef(false);

  // True iff this target is the currently-active tutorial step's
  // target. When this flips true we kick off a settling re-measure
  // loop (below) so the registered rect tracks layout shifts that
  // animations cause *after* the wrapper's own `onLayout` / commit
  // has already fired — e.g. `DrawTileOverlay` opens the hand-row
  // gap ~860 ms into the draw animation, which shifts the
  // absolutely-positioned promote-gang button on screen without
  // moving its frame inside its flex parent (and so without firing
  // onLayout on the wrapper). See PR #421 for the originating
  // `promote-gang` target.
  const isActiveTarget = useTutorial((s) => {
    if (!enabled || !s.active) return false;
    const lesson = LESSONS[s.active.lessonId];
    const step = lesson?.steps[s.active.stepIndex];
    return step?.targetId === id;
  });

  const measureAndRegister = useCallback(() => {
    if (!enabled || !ref.current) return;
    if (cancelledRef.current) return;
    const rootNode = api.rootRef.current as unknown as MeasurableNode | null;
    if (!rootNode) return;
    // Defer to the next frame so any pending layout commits (a sibling
    // conditionally rendering, a parent ScrollView reflowing, the
    // dice-ceremony overlay dismissing) have settled before we ask
    // for coordinates. Otherwise the measure can return the position
    // the wrapper had *before* the current commit finished.
    //
    // Measure both the target and the registry root in window coords
    // and store the offset between them. On Android Fabric with
    // edge-to-edge the root's own window origin is negative (the
    // activity content frame sits above where the status bar
    // overlays) — subtracting the root y cancels that, leaving a
    // value in the same coord space `<TutorialOverlay>` paints in
    // (the overlay is mounted inside this same root).
    requestAnimationFrame(() => {
      if (cancelledRef.current) return;
      rootNode.measureInWindow((rootX, rootY) => {
        if (cancelledRef.current) return;
        ref.current?.measureInWindow((targetX, targetY, width, height) => {
          if (cancelledRef.current) return;
          api.set(id, {
            x: targetX - rootX,
            y: targetY - rootY,
            w: width,
            h: height,
          });
        });
      });
    });
  }, [api, id, enabled]);

  // Re-measure after every render commit. `onLayout` only fires when
  // the wrapper's own frame changes, but the *screen* position can
  // shift when a sibling above us conditionally renders (DISCARDS /
  // MELDS rows appearing mid-hand) or the parent ScrollView reflows
  // — neither of which re-fires onLayout on this wrapper. A
  // useEffect with no deps fires after each render, the registry
  // dedupes identical rects, so this is cheap and self-healing.
  // useLayoutEffect would run before paint, but `measureInWindow` is
  // async on native, so a regular useEffect is sufficient.
  useEffect(() => {
    measureAndRegister();
  });

  // Settling-period re-measure loop. The wrapper's own re-render
  // catches synchronous layout shifts, but engine-driven animations
  // — `DrawTileOverlay` (~1240 ms), inter-hand FlipBag flights, the
  // dice-ceremony dismiss — change the *screen* position of an
  // absolutely-positioned ancestor over time without triggering a
  // re-render on the target's wrapper. Concretely: the promote-gang
  // button sits inside the discard-pool area's `bottom: 12` slot;
  // when `DrawTileOverlay` opens the hand-row gap at HOLD_END the
  // pool's flex height shrinks and the slot moves up on screen,
  // leaving the registered halo behind.
  //
  // Polling on `requestAnimationFrame` for ~1500 ms after the
  // target becomes the active step's target catches the full window
  // of post-activation animation. The registry dedupes identical
  // rects so frames where nothing actually moved are a no-op.
  //
  // On web the poll runs for as long as the target stays active:
  // `measureInWindow` is a synchronous `getBoundingClientRect` there
  // (two calls per frame — negligible), and the 3D table's projected
  // hit targets move on every frame while the camera eases, so a
  // fixed settling window would leave the halo behind. Native keeps
  // the 1500 ms cap because its measure crosses the bridge.
  useEffect(() => {
    if (!isActiveTarget) return;
    let rafId: number | null = null;
    const startedAt = Date.now();
    const DURATION_MS = Platform.OS === 'web' ? Number.POSITIVE_INFINITY : 1500;
    const tick = () => {
      if (cancelledRef.current) return;
      measureAndRegister();
      if (Date.now() - startedAt < DURATION_MS) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isActiveTarget, measureAndRegister]);

  // Clear on unmount so a target that's torn down (e.g. mobile→desktop
  // shell swap) doesn't leave a phantom rect in the registry. Targets
  // re-register from the destination shell's tree on the next layout.
  // Setting `cancelledRef.current` first ensures any in-flight rAF or
  // async measureInWindow callback no-ops instead of clobbering the
  // null clear we're about to write.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (enabled) api.set(id, null);
    };
  }, [api, id, enabled]);

  return (
    <View
      ref={(node) => {
        ref.current = node as unknown as MeasurableNode | null;
      }}
      onLayout={measureAndRegister}
      collapsable={false}
      style={style}
    >
      {children}
    </View>
  );
}
