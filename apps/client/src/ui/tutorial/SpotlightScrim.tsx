import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { COLORS } from '../colors';
import type { HaloRect } from './placement';

/**
 * Dim + spotlight for the tutorial coach-marks.
 *
 * One SVG paints the scrim as an even-odd path (outer rectangle minus
 * a rounded hole `FEATHER` px larger than the halo), then a handful of
 * thin stroked rounded-rect rings fill the feather band with rising
 * opacity. Strokes only touch the perimeter, so the whole layer costs
 * about one full-screen fill plus a few outlines per repaint — cheap
 * enough to follow a moving rect at 60 fps while the 3D camera eases.
 *
 * The pulse is a separate `Animated.View` ring: transform + opacity
 * only (compositor-friendly), 1.6 s breathing loop, held static under
 * reduced motion.
 */
export const SCRIM_RGB = '7,12,10';
export const SCRIM_ALPHA = 0.7;
export const FEATHER = 24;
const RINGS = 16;

interface SpotlightScrimProps {
  width: number;
  height: number;
  halo: HaloRect | null;
  radius: number;
}

export function SpotlightScrim({ width, height, halo, radius }: SpotlightScrimProps) {
  if (!halo) {
    return (
      <Svg
        width={width}
        height={height}
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <Path d={rectPath(0, 0, width, height)} fill={`rgba(${SCRIM_RGB},${SCRIM_ALPHA})`} />
      </Svg>
    );
  }
  const outer = expand(halo, FEATHER);
  const step = FEATHER / RINGS;
  const rings: { key: string; d: string; alpha: number }[] = [];
  for (let k = 0; k < RINGS; k++) {
    const dist = FEATHER - (k + 0.5) * step;
    const r = expand(halo, dist);
    rings.push({
      key: dist.toFixed(2),
      d: roundedRectPath(r.left, r.top, r.width, r.height, radius + dist),
      alpha: SCRIM_ALPHA * smoothstep(dist / FEATHER),
    });
  }
  return (
    <Svg
      width={width}
      height={height}
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      <Path
        d={`${rectPath(0, 0, width, height)} ${roundedRectPath(
          outer.left,
          outer.top,
          outer.width,
          outer.height,
          radius + FEATHER,
        )}`}
        fill={`rgba(${SCRIM_RGB},${SCRIM_ALPHA})`}
        fillRule="evenodd"
      />
      {rings.map((ring) => (
        <Path
          key={ring.key}
          d={ring.d}
          fill="none"
          stroke={`rgba(${SCRIM_RGB},${ring.alpha.toFixed(3)})`}
          strokeWidth={step + 0.35}
        />
      ))}
    </Svg>
  );
}

interface PulseRingProps {
  halo: HaloRect;
  radius: number;
  reducedMotion: boolean;
}

/** Slow breathing ring hugging the halo. Static under reduced motion. */
export function PulseRing({ halo, radius, reducedMotion }: PulseRingProps) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) {
      t.setValue(0.35);
      return;
    }
    t.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 1600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, reducedMotion]);

  const scaleX = t.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1 + 22 / Math.max(40, halo.width)],
  });
  const scaleY = t.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1 + 22 / Math.max(40, halo.height)],
  });
  const opacity = reducedMotion
    ? 0.4
    : t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.8, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: halo.left,
        top: halo.top,
        width: halo.width,
        height: halo.height,
        borderRadius: radius,
        borderWidth: 2,
        borderColor: COLORS.gold,
        opacity,
        transform: [{ scaleX }, { scaleY }],
      }}
    />
  );
}

/** Static gold ring + inner sheen at the exact halo rect. Carries the
 *  `tutorial-halo` testID the promoted-gang spec centres against. */
export function HaloRing({ halo, radius }: { halo: HaloRect; radius: number }) {
  return (
    <View
      testID="tutorial-halo"
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: halo.left,
        top: halo.top,
        width: halo.width,
        height: halo.height,
        borderRadius: radius,
        borderWidth: 2,
        borderColor: 'rgba(216,168,90,0.95)',
        boxShadow: '0 0 0 1px rgba(216,168,90,0.25), 0 0 18px rgba(216,168,90,0.35)',
      }}
    />
  );
}

function expand(h: HaloRect, by: number): HaloRect {
  return { left: h.left - by, top: h.top - by, width: h.width + by * 2, height: h.height + by * 2 };
}

function smoothstep(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

export function rectPath(x: number, y: number, w: number, h: number): string {
  return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
}

export function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  // Clamp so undersized rects still produce a valid path (a pill).
  const cr = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + cr} ${y} H${x + w - cr} A${cr} ${cr} 0 0 1 ${x + w} ${y + cr} V${y + h - cr} A${cr} ${cr} 0 0 1 ${x + w - cr} ${y + h} H${x + cr} A${cr} ${cr} 0 0 1 ${x} ${y + h - cr} V${y + cr} A${cr} ${cr} 0 0 1 ${x + cr} ${y} Z`;
}
