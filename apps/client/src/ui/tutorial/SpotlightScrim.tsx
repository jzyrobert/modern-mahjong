import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Mask,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { COLORS } from '../colors';
import {
  FEATHER_OUT,
  FEATHER_TIGHT,
  type FeatherSides,
  HALO_OVERHANG,
  type HaloRect,
  NO_OPEN_SIDES,
  type SideMask,
} from './placement';

/**
 * Dim + spotlight for the tutorial coach-marks.
 *
 * One SVG paints the scrim as a full-screen fill through a luminance
 * mask: white everywhere, a black hole just outside the halo, and the
 * feather band between the hole and the halo filled with grey-ramp
 * gradients — four linear side bands and four radial corner quadrants —
 * rising on a smoothstep from `FEATHER_IN` px inside the halo edge
 * (over the halo's own padding, never over the target itself) to the
 * per-side outward feather. The corner gradients are elliptical
 * (`rx = radius + feather.left`, `ry = radius + feather.top`, …) so a
 * tight side and a free side meet at a corner without banding, and
 * because every mask shape is opaque the pieces meet without the
 * anti-aliasing seam two translucent fills would leave. Nine shapes and
 * eight gradient defs per repaint — cheap enough to follow a moving
 * rect at 60 fps while the 3D camera eases.
 *
 * `feather` shrinks the outward band per side (see `featherFor`): a side
 * that butts against an opaque neighbour gets a firm edge instead of
 * un-dimming a strip of it.
 *
 * `open` marks sides the halo was *trimmed* to (see `trimStraddlers`):
 * the hole ends in a straight, square-cornered edge there — no corner
 * arcs curling back over the neighbour — and the rings drop their
 * stroke on that side, so a dice modal cut off above the hand row reads
 * as "spotlight up to here", not as a box drawn across the tiles.
 *
 * The pulse is a separate `Animated.View` ring: transform + opacity
 * only (compositor-friendly), 1.6 s breathing loop, held static under
 * reduced motion.
 */
export const SCRIM_RGB = '7,12,10';
export const SCRIM_ALPHA = 0.7;
export const FEATHER_IN = 10;
export const FEATHER = FEATHER_IN + FEATHER_OUT;
/** Gradient stops across the feather band (smoothstep sampled). */
const STOPS = 8;

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
  open?: SideMask | undefined;
}

/** Smoothstep luminance ramp from `t0` (black = clear) to 1 (white =
 *  full scrim), as the `<Stop>` children a mask gradient takes. */
function featherStops(t0: number) {
  const stops = [];
  for (let i = 0; i <= STOPS; i++) {
    const u = i / STOPS;
    const v = Math.round(255 * smoothstep(u));
    stops.push(
      <Stop key={String(i)} offset={t0 + (1 - t0) * u} stopColor={`rgb(${v},${v},${v})`} />,
    );
  }
  return stops;
}

export function SpotlightScrim({
  width,
  height,
  halo,
  radius,
  feather = FULL_FEATHER,
  open = NO_OPEN_SIDES,
}: SpotlightScrimProps) {
  const uid = `ts${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!halo) {
    return (
      <Svg
        testID="tutorial-scrim"
        width={width}
        height={height}
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <Path d={rectPath(0, 0, width, height)} fill={`rgba(${SCRIM_RGB},${SCRIM_ALPHA})`} />
      </Svg>
    );
  }
  const f = feather;
  // Corner radius the hole actually gets (undersized halos become pills).
  const R = Math.max(0, Math.min(radius, halo.width / 2, halo.height / 2));
  const inR = Math.max(0, R - FEATHER_IN);
  const hLeft = halo.left;
  const hTop = halo.top;
  const hRight = halo.left + halo.width;
  const hBottom = halo.top + halo.height;
  const outer = {
    left: hLeft - f.left,
    top: hTop - f.top,
    right: hRight + f.right,
    bottom: hBottom + f.bottom,
  };
  // Corner ellipse radii, clamped so opposite corners never cross.
  const rxL = Math.min(R + f.left, (outer.right - outer.left) / 2);
  const rxR = Math.min(R + f.right, (outer.right - outer.left) / 2);
  const ryT = Math.min(R + f.top, (outer.bottom - outer.top) / 2);
  const ryB = Math.min(R + f.bottom, (outer.bottom - outer.top) / 2);
  // A corner next to an open (trimmed) side is square: no inner radius,
  // no outer ellipse, no ramp sector — the side bands meet at the edge.
  const sq = {
    tl: open.top || open.left,
    tr: open.top || open.right,
    br: open.bottom || open.right,
    bl: open.bottom || open.left,
  };
  const rTL = sq.tl ? 0 : R;
  const rTR = sq.tr ? 0 : R;
  const rBR = sq.br ? 0 : R;
  const rBL = sq.bl ? 0 : R;
  // Every ramp ends in white, so its pieces overlap the white surround
  // by a hair: white on white is invisible, whereas a shared edge would
  // leave an anti-aliasing seam.
  const seam = 0.7;
  // Per-corner outer arc radii (0 → the arc degenerates to a straight
  // corner per the SVG spec).
  const oTL: [number, number] = sq.tl ? [0, 0] : [rxL, ryT];
  const oTR: [number, number] = sq.tr ? [0, 0] : [rxR, ryT];
  const oBR: [number, number] = sq.br ? [0, 0] : [rxR, ryB];
  const oBL: [number, number] = sq.bl ? [0, 0] : [rxL, ryB];
  const hole =
    `M${outer.left + oTL[0]} ${outer.top} H${outer.right - oTR[0]} ` +
    `A${oTR[0]} ${oTR[1]} 0 0 1 ${outer.right} ${outer.top + oTR[1]} V${outer.bottom - oBR[1]} ` +
    `A${oBR[0]} ${oBR[1]} 0 0 1 ${outer.right - oBR[0]} ${outer.bottom} H${outer.left + oBL[0]} ` +
    `A${oBL[0]} ${oBL[1]} 0 0 1 ${outer.left} ${outer.bottom - oBL[1]} V${outer.top + oTL[1]} ` +
    `A${oTL[0]} ${oTL[1]} 0 0 1 ${outer.left + oTL[0]} ${outer.top} Z`;

  // Side bands span between the corner centres; next to a square corner
  // they run to the halo edge (and the side bands past the outer edge,
  // so the corner square outside the hole is ramped, not left clear).
  // An *open* (trimmed) side starts its ramp at the trim line itself
  // rather than `FEATHER_IN` inside it: the content just above the cut
  // (the dice modal's dismiss hint) stays fully lit and the neighbour
  // below it fully dimmed, with no grey band across either.
  const topX = hLeft + rTL;
  const topW = Math.max(0, halo.width - rTL - rTR);
  const botX = hLeft + rBL;
  const botW = Math.max(0, halo.width - rBL - rBR);
  const leftY = hTop + rTL - (sq.tl ? f.top : 0);
  const leftH = Math.max(0, hBottom - rBL + (sq.bl ? f.bottom : 0) - leftY);
  const rightY = hTop + rTR - (sq.tr ? f.top : 0);
  const rightH = Math.max(0, hBottom - rBR + (sq.br ? f.bottom : 0) - rightY);

  // Corner quadrants: each is filled by a radial gradient in bounding-
  // box units centred on the quadrant's inner corner (the halo's corner
  // centre), `r = 100%` — which the non-square bbox stretches into the
  // `rx × ry` ellipse. Alpha 0 out to the inner circle `inR`, full at
  // the ellipse edge; the larger radius sets the stop so the ramp never
  // starts outside the halo padding.
  const cornerT0 = (rx: number, ry: number) => Math.min(1, inR / Math.max(1, rx, ry));
  const corners: Array<{ key: string; cx: string; cy: string; t0: number }> = [
    { key: 'tl', cx: '100%', cy: '100%', t0: cornerT0(rxL, ryT) },
    { key: 'tr', cx: '0%', cy: '100%', t0: cornerT0(rxR, ryT) },
    { key: 'br', cx: '0%', cy: '0%', t0: cornerT0(rxR, ryB) },
    { key: 'bl', cx: '100%', cy: '0%', t0: cornerT0(rxL, ryB) },
  ];

  return (
    <Svg
      testID="tutorial-scrim"
      width={width}
      height={height}
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      <Defs>
        {/* Side bands: alpha 0 at the halo-side edge, full at the outer edge. */}
        <LinearGradient id={`${uid}-t`} x1="0" y1="1" x2="0" y2="0">
          {featherStops(0)}
        </LinearGradient>
        <LinearGradient id={`${uid}-b`} x1="0" y1="0" x2="0" y2="1">
          {featherStops(0)}
        </LinearGradient>
        <LinearGradient id={`${uid}-l`} x1="1" y1="0" x2="0" y2="0">
          {featherStops(0)}
        </LinearGradient>
        <LinearGradient id={`${uid}-r`} x1="0" y1="0" x2="1" y2="0">
          {featherStops(0)}
        </LinearGradient>
        {/* Corner quadrants: elliptical radial ramps centred on the
            corner centre, which sits at the quadrant's inner corner. */}
        {corners.map((c) => (
          <RadialGradient key={c.key} id={`${uid}-${c.key}`} cx={c.cx} cy={c.cy} r="100%">
            {featherStops(c.t0)}
          </RadialGradient>
        ))}
        <Mask id={`${uid}-m`} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
          <Rect x={0} y={0} width={width} height={height} fill="#fff" />
          <Path d={hole} fill="#000" />
          {leftH > 0 ? (
            <Rect
              x={outer.left - seam}
              y={leftY}
              width={open.left ? f.left + seam : rxL - inR + seam}
              height={leftH}
              fill={`url(#${uid}-l)`}
            />
          ) : null}
          {rightH > 0 ? (
            <Rect
              x={open.right ? hRight : hRight - R + inR}
              y={rightY}
              width={open.right ? f.right + seam : rxR - inR + seam}
              height={rightH}
              fill={`url(#${uid}-r)`}
            />
          ) : null}
          {topW > 0 ? (
            <Rect
              x={topX}
              y={outer.top - seam}
              width={topW}
              height={open.top ? f.top + seam : ryT - inR + seam}
              fill={`url(#${uid}-t)`}
            />
          ) : null}
          {botW > 0 ? (
            <Rect
              x={botX}
              y={open.bottom ? hBottom : hBottom - R + inR}
              width={botW}
              height={open.bottom ? f.bottom + seam : ryB - inR + seam}
              fill={`url(#${uid}-b)`}
            />
          ) : null}
          {/* Elliptical quadrant sectors, not rects: a gradient pads past its
                  last stop, so a rect would paint the region outside the ellipse. */}
          {sq.tl ? null : (
            <Path
              d={sector(hLeft + R, hTop + R, rxL + seam, ryT + seam, -1, -1)}
              fill={`url(#${uid}-tl)`}
            />
          )}
          {sq.tr ? null : (
            <Path
              d={sector(hRight - R, hTop + R, rxR + seam, ryT + seam, 1, -1)}
              fill={`url(#${uid}-tr)`}
            />
          )}
          {sq.br ? null : (
            <Path
              d={sector(hRight - R, hBottom - R, rxR + seam, ryB + seam, 1, 1)}
              fill={`url(#${uid}-br)`}
            />
          )}
          {sq.bl ? null : (
            <Path
              d={sector(hLeft + R, hBottom - R, rxL + seam, ryB + seam, -1, 1)}
              fill={`url(#${uid}-bl)`}
            />
          )}
        </Mask>
      </Defs>
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill={`rgba(${SCRIM_RGB},${SCRIM_ALPHA})`}
        mask={`url(#${uid}-m)`}
      />
    </Svg>
  );
}

interface PulseRingProps {
  halo: HaloRect;
  radius: number;
  reducedMotion: boolean;
  /** Per-side feather; a `FEATHER_TIGHT` side has an opaque neighbour
   *  right outside the halo, so the pulse barely grows toward it and
   *  the glow leans away from it. */
  feather?: FeatherSides | undefined;
  /** Sides the halo was trimmed to: the stroke is clipped away there. */
  open?: SideMask | undefined;
}

/** Overhang past the halo on an open side, so the ring's corner arcs
 *  and stroke on that side land outside the clip. */
const OPEN_EXT = HALO_OVERHANG;

function extFor(open: SideMask | undefined): FeatherSides {
  return {
    top: open?.top ? OPEN_EXT : 0,
    right: open?.right ? OPEN_EXT : 0,
    bottom: open?.bottom ? OPEN_EXT : 0,
    left: open?.left ? OPEN_EXT : 0,
  };
}

function anyOpen(open: SideMask | undefined): boolean {
  return !!open && (open.top || open.right || open.bottom || open.left);
}

function tightSides(feather: FeatherSides | undefined): SideMask {
  return {
    top: feather?.top === FEATHER_TIGHT,
    right: feather?.right === FEATHER_TIGHT,
    bottom: feather?.bottom === FEATHER_TIGHT,
    left: feather?.left === FEATHER_TIGHT,
  };
}

/** How far the pulse ring grows past the halo on each side. */
const PULSE_GROW_PX = 11;
const PULSE_GROW_TIGHT_PX = 2;
/** Peak opacity of the breathing ring. Low enough that a mid-cycle
 *  frame never reads as a second hard outline beside the static ring;
 *  the soft shadow around the stroke does the glowing. */
const PULSE_PEAK = 0.35;
const PULSE_STATIC = 0.3;
const PULSE_STROKE = 1.5;
const PULSE_SHADOW = '0 0 10px 1px rgba(216,168,90,0.55)';

/** Scale + translate that grows a `w × h` ring by `PULSE_GROW_PX` on
 *  the free sides and `PULSE_GROW_TIGHT_PX` on the tight ones — the
 *  ring swells away from a neighbouring control instead of over it. */
function pulseTransform(
  w: number,
  h: number,
  tight: SideMask,
): { sx: number; sy: number; tx: number; ty: number } {
  const g = (t: boolean) => (t ? PULSE_GROW_TIGHT_PX : PULSE_GROW_PX);
  const gl = g(tight.left);
  const gr = g(tight.right);
  const gt = g(tight.top);
  const gb = g(tight.bottom);
  return {
    sx: 1 + (gl + gr) / Math.max(40, w),
    sy: 1 + (gt + gb) / Math.max(40, h),
    tx: (gr - gl) / 2,
    ty: (gb - gt) / 2,
  };
}

/**
 * Slow breathing ring hugging the halo. Static under reduced motion.
 *
 * On web the loop is a CSS keyframe animation (transform + opacity,
 * compositor-driven, no per-frame JS); native runs the same curve
 * through `Animated`. The web keyframes scale the ring out by ~11 px on
 * every side, so the class is keyed by halo-size bucket and cached.
 */
export function PulseRing(props: PulseRingProps) {
  return Platform.OS === 'web' ? <WebPulseRing {...props} /> : <NativePulseRing {...props} />;
}

const PULSE_BUCKET_PX = 40;
const pulseStyles = new Map<string, ViewStyle>();

function webPulseStyle(width: number, height: number, tight: SideMask): ViewStyle {
  const bw = Math.max(PULSE_BUCKET_PX, Math.round(width / PULSE_BUCKET_PX) * PULSE_BUCKET_PX);
  const bh = Math.max(PULSE_BUCKET_PX, Math.round(height / PULSE_BUCKET_PX) * PULSE_BUCKET_PX);
  const mask = `${+tight.top}${+tight.right}${+tight.bottom}${+tight.left}`;
  const key = `${bw}x${bh}:${mask}`;
  let style = pulseStyles.get(key);
  if (!style) {
    const { sx, sy, tx, ty } = pulseTransform(bw, bh, tight);
    // `animationKeyframes` is a react-native-web extension, only honoured
    // through StyleSheet.create (compiled class), hence the cache + cast.
    const sheet = StyleSheet.create({
      ring: {
        animationKeyframes: [
          {
            '0%': { opacity: 0, transform: 'translate(0px, 0px) scale(1, 1)' },
            '15%': { opacity: PULSE_PEAK },
            '100%': {
              opacity: 0,
              transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`,
            },
          },
        ],
        animationDuration: '1600ms',
        animationTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        animationIterationCount: 'infinite',
        animationFillMode: 'both',
      },
    } as unknown as Record<string, ViewStyle>);
    style = sheet.ring as ViewStyle;
    pulseStyles.set(key, style);
  }
  return style;
}

/**
 * Clip box for a ring with open sides: the halo grown by `grow` on the
 * closed sides (room for the pulse / aura) and flush on the open ones,
 * so anything drawn past an open edge is cut off there.
 */
function ClipBox({
  halo,
  grow,
  open,
  children,
}: {
  halo: HaloRect;
  grow: number;
  open: SideMask | undefined;
  children: (inner: HaloRect) => ReactNode;
}) {
  const g = (o: boolean | undefined) => (o ? 0 : grow);
  const l = g(open?.left);
  const t = g(open?.top);
  const box = {
    left: halo.left - l,
    top: halo.top - t,
    width: halo.width + l + g(open?.right),
    height: halo.height + t + g(open?.bottom),
  };
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        overflow: 'hidden',
      }}
    >
      {children({ left: l, top: t, width: halo.width, height: halo.height })}
    </View>
  );
}

function WebPulseRing({ halo, radius, reducedMotion, feather, open }: PulseRingProps) {
  const ext = extFor(open);
  const ring = (at: HaloRect) => (
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: at.left - ext.left,
          top: at.top - ext.top,
          width: at.width + ext.left + ext.right,
          height: at.height + ext.top + ext.bottom,
          borderRadius: radius,
          borderWidth: PULSE_STROKE,
          borderColor: COLORS.gold,
          boxShadow: PULSE_SHADOW,
        },
        reducedMotion
          ? { opacity: PULSE_STATIC }
          : webPulseStyle(halo.width, halo.height, tightSides(feather)),
      ]}
    />
  );
  if (!anyOpen(open)) return ring(halo);
  return (
    <ClipBox halo={halo} grow={PULSE_GROW_PX + 12} open={open}>
      {ring}
    </ClipBox>
  );
}

function NativePulseRing({ halo, radius, reducedMotion, feather, open }: PulseRingProps) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) {
      t.setValue(PULSE_STATIC);
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

  const { sx, sy, tx, ty } = pulseTransform(halo.width, halo.height, tightSides(feather));
  const scaleX = t.interpolate({ inputRange: [0, 1], outputRange: [1, sx] });
  const scaleY = t.interpolate({ inputRange: [0, 1], outputRange: [1, sy] });
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [0, tx] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, ty] });
  const opacity = reducedMotion
    ? PULSE_STATIC
    : t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, PULSE_PEAK, 0] });

  const ext = extFor(open);
  const ring = (at: HaloRect) => (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: at.left - ext.left,
        top: at.top - ext.top,
        width: at.width + ext.left + ext.right,
        height: at.height + ext.top + ext.bottom,
        borderRadius: radius,
        borderWidth: PULSE_STROKE,
        borderColor: COLORS.gold,
        boxShadow: PULSE_SHADOW,
        opacity,
        transform: [{ translateX }, { translateY }, { scaleX }, { scaleY }],
      }}
    />
  );
  if (!anyOpen(open)) return ring(halo);
  return (
    <ClipBox halo={halo} grow={PULSE_GROW_PX + 12} open={open}>
      {ring}
    </ClipBox>
  );
}

/** How far the halo's glow reaches past the ring on a free side. */
export const AURA_PX = 22;
const AURA_SHADOW = '0 0 20px 3px rgba(216,168,90,0.32)';

/** Per-side reach of the glow: full on free sides, none on a side that
 *  butts against other chrome (the round panel above the landscape
 *  hand) — the aura is clipped there rather than shrunk, so no
 *  half-strength band lands on the neighbour. */
export function auraReach(feather: FeatherSides | undefined): FeatherSides {
  const tight = tightSides(feather);
  return {
    top: tight.top ? 0 : AURA_PX,
    right: tight.right ? 0 : AURA_PX,
    bottom: tight.bottom ? 0 : AURA_PX,
    left: tight.left ? 0 : AURA_PX,
  };
}

/**
 * Static gold ring at the exact halo rect plus one soft glow behind it.
 * The glow is a single blurred shadow (no spread ring, no offset) whose
 * alpha falls off smoothly, wrapped in a clipping box that stops at the
 * halo edge on tight sides. Carries the `tutorial-halo` testID the
 * promoted-gang spec centres against.
 */
export function HaloRing({
  halo,
  radius,
  feather,
  open,
}: {
  halo: HaloRect;
  radius: number;
  feather?: FeatherSides | undefined;
  /** Sides the halo was trimmed to: no stroke, no aura, square corners. */
  open?: SideMask | undefined;
}) {
  const reach = auraReach(feather);
  const ext = extFor(open);
  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: halo.left - reach.left,
          top: halo.top - reach.top,
          width: halo.width + reach.left + reach.right,
          height: halo.height + reach.top + reach.bottom,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: reach.left - ext.left,
            top: reach.top - ext.top,
            width: halo.width + ext.left + ext.right,
            height: halo.height + ext.top + ext.bottom,
            borderRadius: radius,
            boxShadow: AURA_SHADOW,
          }}
        />
      </View>
      {/* The testID box is the exact halo rect (what the specs measure);
          the stroke is a child extended past any open side and clipped
          by this box, so the ring simply runs off that edge. */}
      <View
        testID="tutorial-halo"
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: halo.left,
          top: halo.top,
          width: halo.width,
          height: halo.height,
          overflow: anyOpen(open) ? 'hidden' : 'visible',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: -ext.left,
            top: -ext.top,
            width: halo.width + ext.left + ext.right,
            height: halo.height + ext.top + ext.bottom,
            borderRadius: radius,
            borderWidth: 2,
            borderColor: 'rgba(216,168,90,0.95)',
          }}
        />
      </View>
    </>
  );
}

/** Quarter-ellipse pie slice centred on `(cx, cy)` with radii `rx × ry`
 *  toward the `sx`/`sy` signed directions. Its bounding box is exactly
 *  the quadrant, which is what the objectBoundingBox gradient needs. */
function sector(cx: number, cy: number, rx: number, ry: number, sx: number, sy: number): string {
  const px = cx + sx * rx;
  const py = cy + sy * ry;
  // Sweep direction depends on the quadrant so the arc bows outward.
  const sweep = sx * sy > 0 ? 1 : 0;
  return `M${cx} ${cy} L${px} ${cy} A${rx} ${ry} 0 0 ${sweep} ${cx} ${py} Z`;
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
