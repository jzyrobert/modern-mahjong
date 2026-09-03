import { useEffect, useId, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { ClipPath, Defs, G, Path } from 'react-native-svg';
import { COLORS } from '../colors';
import { FEATHER_OUT, type FeatherSides, type HaloRect } from './placement';

/**
 * Dim + spotlight for the tutorial coach-marks.
 *
 * One SVG paints the scrim as an even-odd path (outer rectangle minus
 * a rounded hole just outside the halo), then a handful of thin stroked
 * rounded-rect rings fill a 24 px feather band with rising opacity —
 * `FEATHER_IN` px of it inside the halo edge (over the halo's own
 * padding, never over the target itself) and up to `FEATHER_OUT` px
 * outside. Strokes only touch the perimeter, so the whole layer costs
 * about one full-screen fill plus a few outlines per repaint — cheap
 * enough to follow a moving rect at 60 fps while the 3D camera eases.
 *
 * `feather` shrinks the outward band per side (see `featherFor`): the
 * rings are clipped to the shrunken hole so a side that butts against
 * an opaque neighbour gets a firm edge instead of un-dimming a strip of
 * it.
 *
 * The pulse is a separate `Animated.View` ring: transform + opacity
 * only (compositor-friendly), 1.6 s breathing loop, held static under
 * reduced motion.
 */
export const SCRIM_RGB = '7,12,10';
export const SCRIM_ALPHA = 0.7;
export const FEATHER_IN = 10;
export const FEATHER = FEATHER_IN + FEATHER_OUT;
const RINGS = 16;

const FULL_FEATHER: FeatherSides = {
  top: FEATHER_OUT,
  right: FEATHER_OUT,
  bottom: FEATHER_OUT,
  left: FEATHER_OUT,
};

interface SpotlightScrimProps {
  width: number;
  height: number;
  halo: HaloRect | null;
  radius: number;
  feather?: FeatherSides | undefined;
}

export function SpotlightScrim({
  width,
  height,
  halo,
  radius,
  feather = FULL_FEATHER,
}: SpotlightScrimProps) {
  const clipId = `tutorial-spot-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
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
  const outer = expandSides(halo, feather);
  const holePath = roundedRectPath(
    outer.left,
    outer.top,
    outer.width,
    outer.height,
    radius + Math.min(feather.top, feather.right, feather.bottom, feather.left),
  );
  const step = FEATHER / RINGS;
  const rings: { key: string; d: string; alpha: number }[] = [];
  for (let k = 0; k < RINGS; k++) {
    const dist = FEATHER_OUT - (k + 0.5) * step;
    const r = expand(halo, dist);
    rings.push({
      key: dist.toFixed(2),
      d: roundedRectPath(r.left, r.top, r.width, r.height, radius + dist),
      alpha: SCRIM_ALPHA * smoothstep((dist + FEATHER_IN) / FEATHER),
    });
  }
  return (
    <Svg
      width={width}
      height={height}
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      <Defs>
        <ClipPath id={clipId}>
          <Path d={holePath} />
        </ClipPath>
      </Defs>
      <Path
        d={`${rectPath(0, 0, width, height)} ${holePath}`}
        fill={`rgba(${SCRIM_RGB},${SCRIM_ALPHA})`}
        fillRule="evenodd"
      />
      <G clipPath={`url(#${clipId})`}>
        {rings.map((ring) => (
          <Path
            key={ring.key}
            d={ring.d}
            fill="none"
            stroke={`rgba(${SCRIM_RGB},${ring.alpha.toFixed(3)})`}
            strokeWidth={step + 0.35}
          />
        ))}
      </G>
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

function expandSides(h: HaloRect, by: FeatherSides): HaloRect {
  return {
    left: h.left - by.left,
    top: h.top - by.top,
    width: h.width + by.left + by.right,
    height: h.height + by.top + by.bottom,
  };
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
