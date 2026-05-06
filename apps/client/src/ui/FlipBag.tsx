import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { Animated, Easing } from 'react-native';
import { useGame } from '../state/game';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FlipBagApi {
  /** Read the cached rect for a flipId, or null if no entry. */
  read: (flipId: string) => Rect | null;
  /** Write the latest rect for a flipId. */
  write: (flipId: string, rect: Rect) => void;
  /** Drop everything — used between hands so old positions don't animate
   *  the next hand's tiles. */
  clear: () => void;
  /** Whether animations are enabled (false honours the
   *  `settings.animations: false` toggle). */
  enabled: boolean;
}

const noopApi: FlipBagApi = {
  read: () => null,
  write: () => {},
  clear: () => {},
  enabled: false,
};

export const FlipBagContext = createContext<FlipBagApi>(noopApi);

interface FlipBagProviderProps {
  children: ReactNode;
}

/**
 * Native equivalent of `framer-motion`'s `layoutId` FLIP — without the
 * actual layoutId machinery, since `react-native-reanimated` was stripped
 * from the runtime in 532f87f. The cache is just a `Map<flipId, rect>`;
 * each `<FlipView>` reports its current screen rect on layout, looks up
 * the cached rect for its id, and (if the position changed) snaps its
 * `translateX/Y` to the old position then animates to `(0,0)`.
 *
 * Caveats:
 *   - Identity is the engine `tileId`, which is unique per tile-on-board.
 *     A tile only ever exists in one place at a time, so cache writes
 *     never collide.
 *   - Cache is cleared on `useGame.shuffling` rising edge so wall layout
 *     in the previous hand doesn't pull the new hand's tiles into stale
 *     positions during the between-hand dispense (the dispense itself is
 *     a separate animation that runs against a reset cache).
 *   - When `settings.animations === false`, `enabled` is false and
 *     `<FlipView>` skips the snap-back so the visual is unchanged from
 *     the no-animation state.
 */
export function FlipBagProvider({ children }: FlipBagProviderProps) {
  const cacheRef = useRef<Map<string, Rect>>(new Map());
  const animationsEnabled = useGame((s) => s.settings.animations);
  const shuffling = useGame((s) => s.shuffling);

  // Drop the cache on the rising edge of `shuffling`. Without this, the
  // new hand's wall tiles would think they're "moving" from wherever the
  // previous hand's same-tileId tile last sat, producing nonsense.
  const lastShuffling = useRef<boolean>(false);
  useEffect(() => {
    if (shuffling && !lastShuffling.current) cacheRef.current.clear();
    lastShuffling.current = shuffling;
  }, [shuffling]);

  const api = useMemo<FlipBagApi>(
    () => ({
      read: (flipId) => cacheRef.current.get(flipId) ?? null,
      write: (flipId, rect) => {
        cacheRef.current.set(flipId, rect);
      },
      clear: () => cacheRef.current.clear(),
      enabled: animationsEnabled,
    }),
    [animationsEnabled],
  );

  return <FlipBagContext.Provider value={api}>{children}</FlipBagContext.Provider>;
}

interface FlipViewProps {
  flipId: string;
  children: ReactNode;
  /** Animation duration. Default 280ms — matches the legacy
   *  framer-motion spring's natural timing. */
  duration?: number;
}

/**
 * Wrap any visual that should track its `flipId` across mounts. On
 * layout, `<FlipView>` measures its absolute screen rect, reads the
 * cached rect for `flipId` from `FlipBagProvider`, and if the position
 * has shifted, snaps the wrapper's transform to the old position then
 * animates back to identity.
 *
 * Use it sparingly — wrapping every tile in the wall is fine because
 * the cache writes are O(1), but wrapping non-tile visuals (badges,
 * text) provides no value and adds re-render overhead.
 */
/** Type-narrow shape for `measureInWindow` — works on both the
 *  underlying RN `View` instance and any AnimatedComponent's
 *  `getNode()`-style result. */
interface Measurable {
  measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void;
}

export function FlipView({ flipId, children, duration = 280 }: FlipViewProps) {
  const bag = useContext(FlipBagContext);
  const ref = useRef<Measurable | null>(null);
  const animX = useRef(new Animated.Value(0)).current;
  const animY = useRef(new Animated.Value(0)).current;

  const onLayout = useCallback(() => {
    if (!ref.current) return;
    // measureInWindow gives absolute screen coordinates, which is what
    // we want — the source and target are in the same coordinate space
    // so a (oldX − newX, oldY − newY) translate is the correct delta.
    ref.current.measureInWindow((x, y, w, h) => {
      const cached = bag.read(flipId);
      bag.write(flipId, { x, y, w, h });
      if (!cached || !bag.enabled) return;
      const dx = cached.x - x;
      const dy = cached.y - y;
      // Skip jitter under 1px — these are typically grid-snap rounding
      // differences, not real motion. Without this guard every tile
      // would animate by a sub-pixel on every render.
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      animX.stopAnimation();
      animY.stopAnimation();
      animX.setValue(dx);
      animY.setValue(dy);
      Animated.parallel([
        Animated.timing(animX, {
          toValue: 0,
          duration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(animY, {
          toValue: 0,
          duration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [animX, animY, bag, duration, flipId]);

  return (
    <Animated.View
      // Animated.View's ref forwards to the underlying RN `View`,
      // which has `measureInWindow`. The `Measurable` interface above
      // narrows just that one method so we don't have to import the
      // full `View` type.
      ref={(node) => {
        ref.current = node as unknown as Measurable | null;
      }}
      onLayout={onLayout}
      style={{ transform: [{ translateX: animX }, { translateY: animY }] }}
    >
      {children}
    </Animated.View>
  );
}
