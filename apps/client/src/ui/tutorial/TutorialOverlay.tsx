import { useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTransport } from '../../net/transport-context';
import { useGame } from '../../state/game';
import {
  LESSONS,
  LESSON_ORDER,
  nextLesson,
  useActiveTutorialStep,
  useTutorial,
} from '../../state/tutorial';
import { COLORS } from '../colors';
import { HaloRing, PulseRing, SCRIM_ALPHA, SCRIM_RGB, SpotlightScrim } from './SpotlightScrim';
import {
  type TargetRect,
  type TargetRegistryApi,
  useTargetRegistry,
  useTutorialTargetRect,
} from './TargetRegistry';
import { OVERLAY_ATTR, isChromeCandidate } from './chromeRects';
import {
  type CaptionPlacement,
  HALO_RADIUS,
  type HaloRect,
  featherFor,
  haloFor,
  placeCaption,
  safeInset,
} from './placement';
import type { Lesson, LessonStep } from './types';
import { useChromeRects } from './useChromeRects';
import { useReducedMotion } from './useReducedMotion';
import { useFollowedRect, useSettledRect } from './useTargetTracking';
import { useTutorialController } from './useTutorialController';

/** Ease-out curve for the card entrance. */
const CARD_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Web card entrance: fade + 8 px slide as a compiled CSS keyframe class
 * (`animationKeyframes` is a react-native-web extension that only works
 * through StyleSheet.create). Compositor-driven, starts on the element's
 * first frame, and needs no painted "from" state or JS ticks — a
 * JS-driven `Animated.timing` depends on requestAnimationFrame, which a
 * software-rendered or CPU-starved page can stall for hundreds of ms
 * (the verifier caught the card frozen at opacity 0).
 */
const webEntrance =
  Platform.OS === 'web'
    ? (() => {
        const frames = [
          {
            from: { opacity: 0, transform: 'translateY(8px)' },
            to: { opacity: 1, transform: 'translateY(0px)' },
          },
        ];
        return StyleSheet.create({
          normal: {
            animationKeyframes: frames,
            animationDuration: '220ms',
            animationTimingFunction: CARD_EASE,
            animationFillMode: 'both',
          },
          reduced: {
            animationKeyframes: frames,
            animationDuration: '100ms',
            animationTimingFunction: CARD_EASE,
            animationFillMode: 'both',
          },
        } as unknown as Record<'normal' | 'reduced', ViewStyle>);
      })()
    : null;

/**
 * Full-screen tutorial coach-mark overlay. Mounted once at the app
 * root (`app/_layout.tsx`) above every shell — classic and 3D — and
 * gated on `useActiveTutorialStep()`; renders nothing between lessons.
 *
 * Layers, bottom to top:
 *   - `<SpotlightScrim>` — dim with a soft-edged (24 px feathered)
 *     rounded cutout around the target rect.
 *   - Tap panels — four transparent rectangles around the halo (or
 *     one full-screen panel with no target) that absorb taps outside
 *     the highlighted region so the user can only interact with the
 *     spotlit element.
 *   - `<PulseRing>` + `<HaloRing>` — breathing gold ring and the static
 *     `tutorial-halo` ring the specs centre against.
 *   - Caption card — glass panel with the `LESSON N/M` label,
 *     step-progress dots, title, body, `Skip lesson` link and the CTA
 *     (`tutorial-next`). Docked adjacent to the halo with a pointer
 *     notch, clamped to the safe area (`placement.ts`), and cross-faded
 *     (fade + 8 px slide, 220 ms) between steps.
 *
 * Rect flow: the registry's live rect → `useFollowedRect` (halo eases
 * toward it each frame) and `useSettledRect` (card repositions only
 * once the rect stops moving). The 3D table re-registers its projected
 * hit targets every frame while the camera eases, so both layers are
 * what keep the overlay from jittering there.
 *
 * After a lesson's last step the overlay flips to `<CompletionPrompt>`
 * (drained by `useTutorial.justCompleted`).
 */
export function TutorialOverlay() {
  // Drive the controller while the overlay is mounted. Its effect is
  // gated on `active`, so this is a no-op between lessons.
  useTutorialController();
  const active = useActiveTutorialStep();
  const justCompleted = useTutorial((s) => s.justCompleted);

  if (!active && justCompleted) return <CompletionPrompt lessonId={justCompleted} />;
  if (!active) return null;
  return <ActiveStep lesson={active.lesson} step={active.step} stepIndex={active.stepIndex} />;
}

interface ActiveStepProps {
  lesson: Lesson;
  step: LessonStep;
  stepIndex: number;
}

const GLASS_BG = 'rgba(14,20,17,0.74)';
/** Deeper tint for a card that has to sit over dimmed chrome: with the
 *  scrim already flattening what is behind, the blur has little to
 *  bite on and the tint alone has to stop labels reading through. */
const GLASS_BG_DENSE = 'rgba(14,20,17,0.94)';
const GLASS_BORDER = 'rgba(255,255,255,0.12)';
const TEXT_PRIMARY = 'rgba(255,255,255,0.92)';
const TEXT_SECONDARY = 'rgba(255,255,255,0.64)';
const INK_ON_GOLD = '#2a2418';

const webOnly = (style: Record<string, unknown>): ViewStyle =>
  Platform.OS === 'web' ? (style as ViewStyle) : {};

const TITLE_FONT = Platform.select({
  web: "Nunito, 'Noto Serif TC', system-ui, -apple-system, sans-serif",
  default: undefined,
});
const BODY_FONT = Platform.select({
  web: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Serif TC', sans-serif",
  default: undefined,
});

function ActiveStep({ lesson, step, stepIndex }: ActiveStepProps) {
  const dismiss = useTutorial((s) => s.dismiss);
  const advance = useTutorial((s) => s.advance);
  const transport = useTransport();
  const window = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const registry = useTargetRegistry();
  const stepKey = `${lesson.id}:${step.id}:${stepIndex}`;
  const targetId = step.targetId ?? null;

  const liveRect = useTutorialTargetRect(targetId);
  const haloRect = useFollowedRect(liveRect, reducedMotion);
  const cardRect = useSettledRect(liveRect, stepKey);
  const rootRef = useRef<View | null>(null);

  // Chrome the card must not bisect and the feather must not un-dim:
  // DOM controls / labels on web, plus every other registered target.
  const domChrome = useChromeRects({
    active: true,
    targetId,
    stepKey,
    viewport: window,
    settledRect: cardRect,
    originNode: () => rootRef.current as unknown as { getBoundingClientRect(): DOMRect } | null,
  });
  const registryChrome = otherTargetRects(registry, targetId, window);
  const avoid = registryChrome.length > 0 ? [...domChrome, ...registryChrome] : domChrome;

  // Overlay wrapper size drives the scrim SVG so it spans the actual
  // rendered area on Android edge-to-edge (where `useWindowDimensions`
  // excludes the nav-bar inset). Seeded from the window so the scrim
  // paints on the first commit.
  const [overlaySize, setOverlaySize] = useState({ w: window.width, h: window.height });

  // Card height, measured per step. Keyed so a stale height from the
  // previous step (or a previous viewport) is never used for this one —
  // the card stays invisible until its own measurement lands, then
  // fades in at the right spot. No effect-based reset needed.
  const measureKey = `${stepKey}|${window.width}x${window.height}`;
  const [measured, setMeasured] = useState<{ key: string; height: number } | null>(null);
  const cardHeight = measured?.key === measureKey ? measured.height : null;
  const cardRef = useRef<View | null>(null);

  // Web: measure synchronously before paint. RNW's `onLayout` goes
  // through ResizeObserver + setTimeout, i.e. it waits for a frame — on a
  // starved renderer that is hundreds of ms of invisible card. Reading
  // the rect here positions the card correctly on its very first paint;
  // `onLayout` stays attached for later size changes (font load).
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || cardHeight !== null) return;
    const node = cardRef.current as unknown as {
      getBoundingClientRect?: () => { height: number };
    } | null;
    const h = node?.getBoundingClientRect?.().height ?? 0;
    if (h > 0) setMeasured({ key: measureKey, height: h });
  }, [cardHeight, measureKey]);

  const halo = haloFor(haloRect, window);
  const feather = halo ? featherFor(halo, avoid) : undefined;
  const placement = placeCaption({
    viewport: { width: window.width, height: window.height },
    halo: haloFor(cardRect, window),
    cardHeight,
    avoid,
  });
  const glassBg = placement.overlapsChrome ? GLASS_BG_DENSE : GLASS_BG;

  // Step transition: fade + 8 px slide once the new card is measured.
  // `ready` drops to false on every step change (the measurement is
  // keyed per step), so the effect re-fires per step without an extra
  // key dependency.
  //
  // On web the motion is the `webEntrance` keyframe class on a wrapper
  // that remounts per step (`key={stepKey}`); native keeps the Animated
  // path below.
  const opacity = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(8)).current;
  const ready = cardHeight !== null;
  useEffect(() => {
    if (!ready || Platform.OS === 'web') return;
    opacity.setValue(0);
    slide.setValue(8);
    const duration = reducedMotion ? 100 : 220;
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [ready, opacity, slide, reducedMotion]);

  const lessonIndex = LESSON_ORDER.indexOf(lesson.id);
  const lessonLabel =
    lessonIndex >= 0 ? `Lesson ${lessonIndex + 1}/${LESSON_ORDER.length}` : 'Tutorial';
  const compact = placement.width < 260;
  // Hard CTA-visibility guarantee: cap the body copy so the whole card
  // fits between the safe insets even for a narrow side dock (landscape
  // phone beside the result panel). `CHROME` approximates everything in
  // the card that is not body text; overflow scrolls inside the card.
  const chrome = compact ? 196 : 236;
  const bodyMaxHeight = Math.max(64, window.height - safeInset(window.width) * 2 - chrome);
  const ctaLabel = step.ctaLabel ?? 'Got it';
  const canRestart = stepIndex > 0 && lesson.id !== '_stub';

  const tapPanels: ReadonlyArray<Panel & { key: string }> = halo
    ? scrimAround(halo)
    : [{ key: 'full', left: 0, top: 0, right: 0, bottom: 0 }];

  return (
    // Plain absolute overlay rather than `RNModal`: react-native-web's
    // Modal focus-trap backdrop would swallow the taps we want to let
    // through to the spotlit element.
    <View
      ref={(node) => {
        rootRef.current = node;
        markOverlay(node);
      }}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setOverlaySize((prev) =>
          prev.w === width && prev.h === height ? prev : { w: width, h: height },
        );
      }}
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 1000 }}
      pointerEvents="box-none"
    >
      <SpotlightScrim
        width={overlaySize.w}
        height={overlaySize.h}
        halo={halo}
        radius={HALO_RADIUS}
        feather={feather}
      />
      {tapPanels.map((panel) => (
        <View
          key={panel.key}
          style={{
            position: 'absolute',
            left: panel.left,
            top: panel.top,
            right: panel.right,
            bottom: panel.bottom,
            width: panel.width,
            height: panel.height,
          }}
        />
      ))}
      {halo ? (
        <>
          <PulseRing halo={halo} radius={HALO_RADIUS} reducedMotion={reducedMotion} />
          <HaloRing halo={halo} radius={HALO_RADIUS} />
        </>
      ) : null}

      <Animated.View
        // Remount per step so web `onLayout` (ResizeObserver, size
        // changes only) re-fires even when two consecutive cards happen
        // to be the same height, and so the CSS transition has a painted
        // "from" state to ease out of.
        key={stepKey}
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            left: placement.left,
            top: placement.top,
            width: placement.width,
          },
          webEntrance
            ? ready
              ? reducedMotion
                ? webEntrance.reduced
                : webEntrance.normal
              : { opacity: 0 }
            : { opacity: ready ? opacity : 0, transform: [{ translateY: slide }] },
        ]}
      >
        <View
          // Tap-eater so taps on the card never fall through to the
          // scrim. Also the CTA's grandparent — the scoring specs
          // measure the card via `xpath=ancestor::*[2]` of "Got it".
          ref={cardRef}
          pointerEvents="auto"
          onLayout={(e) => {
            const { height } = e.nativeEvent.layout;
            setMeasured((prev) =>
              prev?.key === measureKey && prev.height === height
                ? prev
                : { key: measureKey, height },
            );
          }}
          style={[
            {
              width: '100%',
              backgroundColor: glassBg,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: GLASS_BORDER,
              padding: compact ? 12 : 18,
              gap: compact ? 6 : 10,
              boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
            },
            webOnly({ backdropFilter: 'blur(16px) saturate(140%)' }),
          ]}
        >
          <View
            style={{
              flexDirection: compact ? 'column' : 'row',
              alignItems: compact ? 'flex-start' : 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 2,
                textTransform: 'uppercase',
                color: COLORS.gold,
                fontFamily: BODY_FONT,
              }}
            >
              {lessonLabel}
            </Text>
            <StepDots ids={lesson.steps.map((st) => st.id)} index={stepIndex} />
          </View>
          <Text
            accessibilityRole="header"
            accessibilityLabel={`Tutorial step: ${step.caption.title}`}
            style={{
              fontSize: compact ? 15 : 20,
              lineHeight: compact ? 19 : 26,
              fontWeight: '800',
              letterSpacing: -0.3,
              color: TEXT_PRIMARY,
              fontFamily: TITLE_FONT,
            }}
          >
            {step.caption.title}
          </Text>
          <ScrollView
            style={{ maxHeight: bodyMaxHeight, flexGrow: 0 }}
            showsVerticalScrollIndicator
            nestedScrollEnabled
          >
            <Text
              style={{
                fontSize: compact ? 12.5 : 14,
                lineHeight: compact ? 17 : 21,
                color: 'rgba(255,255,255,0.78)',
                fontFamily: BODY_FONT,
              }}
            >
              {step.caption.body}
            </Text>
          </ScrollView>
          <View
            style={{
              flexDirection: compact ? 'column-reverse' : 'row',
              justifyContent: 'space-between',
              alignItems: compact ? 'stretch' : 'center',
              gap: compact ? 0 : 10,
              marginTop: compact ? 0 : 2,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: compact ? 'center' : 'flex-start',
                gap: 4,
                flexShrink: 1,
              }}
            >
              <QuietButton label="Skip lesson" onPress={dismiss} compact={compact} />
              {canRestart ? (
                <QuietButton
                  label="Restart"
                  accessibilityLabel="Restart lesson"
                  onPress={() => transport.joinSoloTutorial(lesson.id)}
                />
              ) : null}
            </View>
            {step.completedWhen ? null : (
              <PrimaryButton
                label={ctaLabel}
                onPress={advance}
                testID="tutorial-next"
                stretch={compact}
              />
            )}
          </View>
        </View>
        {placement.notch !== null ? <Notch placement={placement} fill={glassBg} /> : null}
      </Animated.View>
    </View>
  );
}

/** Tag the overlay root on web so the chrome scan skips its own DOM. */
function markOverlay(node: unknown): void {
  if (Platform.OS !== 'web') return;
  const el = node as { setAttribute?: (name: string, value: string) => void } | null;
  el?.setAttribute?.(OVERLAY_ATTR, '1');
}

/** Rects of every registered target other than the active one, sized
 *  like chrome (a tall region such as the discard pool is skipped). */
function otherTargetRects(
  registry: TargetRegistryApi,
  activeId: string | null,
  viewport: { width: number; height: number },
): HaloRect[] {
  const out: HaloRect[] = [];
  for (const [id, r] of registry.readAll()) {
    if (id === activeId) continue;
    const rect = { left: r.x, top: r.y, width: r.w, height: r.h };
    if (isChromeCandidate({ rect, control: true, text: null }, viewport)) out.push(rect);
  }
  return out;
}

function StepDots({ ids, index }: { ids: string[]; index: number }) {
  const count = ids.length;
  if (count <= 1) return null;
  return (
    <View
      accessibilityLabel={`Step ${index + 1} of ${count}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}
    >
      {ids.map((id, i) => {
        const state = i === index ? 'active' : i < index ? 'done' : 'todo';
        return (
          <View
            key={id}
            style={{
              width: state === 'active' ? 18 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor:
                state === 'active'
                  ? COLORS.gold
                  : state === 'done'
                    ? 'rgba(216,168,90,0.55)'
                    : 'rgba(255,255,255,0.22)',
            }}
          />
        );
      })}
    </View>
  );
}

type HoverState = PressableStateCallbackType & { hovered?: boolean };

interface ButtonProps {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
  stretch?: boolean;
  /** Narrow side-dock cards: tighter padding (quiet links drop to 36 px;
   *  the primary CTA keeps the 44 px floor). */
  compact?: boolean;
}

function PrimaryButton({
  label,
  onPress,
  accessibilityLabel,
  testID,
  stretch,
  compact,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      onPress={onPress}
      style={(s: HoverState) => [
        {
          minHeight: 44,
          paddingHorizontal: compact ? 14 : 20,
          borderRadius: 12,
          backgroundColor: COLORS.gold,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: stretch ? 'stretch' : 'auto',
          transform: [
            { translateY: s.hovered && !s.pressed ? -1 : 0 },
            { scale: s.pressed ? 0.97 : 1 },
          ],
          boxShadow: '0 6px 18px rgba(216,168,90,0.28)',
        },
        webOnly({
          filter: s.hovered && !s.pressed ? 'brightness(1.05)' : 'none',
          transitionProperty: 'transform, filter',
          transitionDuration: '160ms',
        }),
      ]}
    >
      <Text style={{ fontSize: 14, fontWeight: '800', color: INK_ON_GOLD, fontFamily: BODY_FONT }}>
        {label}
      </Text>
    </Pressable>
  );
}

function QuietButton({ label, onPress, accessibilityLabel, compact }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={(s: HoverState) => ({
        minHeight: compact ? 36 : 44,
        paddingHorizontal: 10,
        borderRadius: 10,
        justifyContent: 'center',
        backgroundColor: s.pressed
          ? 'rgba(255,255,255,0.10)'
          : s.hovered
            ? 'rgba(255,255,255,0.06)'
            : 'transparent',
      })}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: '700',
          color: TEXT_SECONDARY,
          fontFamily: BODY_FONT,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const NOTCH_W = 22;
const NOTCH_H = 11;

/** Pointer notch on the card edge that faces the halo. Drawn as an
 *  SVG so the two outer edges carry the glass border while the base
 *  overlaps the card by 1 px and hides the border segment beneath. */
function Notch({ placement, fill }: { placement: CaptionPlacement; fill: string }) {
  const n = placement.notch ?? 0;
  let style: ViewStyle;
  let body: string;
  let edge: string;
  let w = NOTCH_W;
  let h = NOTCH_H;
  switch (placement.kind) {
    case 'above':
      style = { bottom: -NOTCH_H + 1, left: n - NOTCH_W / 2 };
      body = `M0 0 L${NOTCH_W / 2} ${NOTCH_H} L${NOTCH_W} 0 Z`;
      edge = `M0 0 L${NOTCH_W / 2} ${NOTCH_H} L${NOTCH_W} 0`;
      break;
    case 'below':
      style = { top: -NOTCH_H + 1, left: n - NOTCH_W / 2 };
      body = `M0 ${NOTCH_H} L${NOTCH_W / 2} 0 L${NOTCH_W} ${NOTCH_H} Z`;
      edge = `M0 ${NOTCH_H} L${NOTCH_W / 2} 0 L${NOTCH_W} ${NOTCH_H}`;
      break;
    case 'right':
      w = NOTCH_H;
      h = NOTCH_W;
      style = { left: -NOTCH_H + 1, top: n - NOTCH_W / 2 };
      body = `M${NOTCH_H} 0 L0 ${NOTCH_W / 2} L${NOTCH_H} ${NOTCH_W} Z`;
      edge = `M${NOTCH_H} 0 L0 ${NOTCH_W / 2} L${NOTCH_H} ${NOTCH_W}`;
      break;
    case 'left':
      w = NOTCH_H;
      h = NOTCH_W;
      style = { right: -NOTCH_H + 1, top: n - NOTCH_W / 2 };
      body = `M0 0 L${NOTCH_H} ${NOTCH_W / 2} L0 ${NOTCH_W} Z`;
      edge = `M0 0 L${NOTCH_H} ${NOTCH_W / 2} L0 ${NOTCH_W}`;
      break;
    default:
      return null;
  }
  return (
    <Svg width={w} height={h} pointerEvents="none" style={[{ position: 'absolute' }, style]}>
      <Path d={body} fill={fill} />
      <Path d={edge} fill="none" stroke={GLASS_BORDER} strokeWidth={1} />
    </Svg>
  );
}

interface Panel {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
}

/** Four tap-absorbing rectangles around the halo. Each is anchored to
 *  the overlay edge it shares with the halo so the panels fill the
 *  overlay's real bounds (the Android nav-bar inset included). */
function scrimAround(halo: HaloRect): Array<Panel & { key: string }> {
  return [
    { key: 'top', left: 0, top: 0, right: 0, height: halo.top },
    { key: 'bottom', left: 0, top: halo.top + halo.height, right: 0, bottom: 0 },
    { key: 'left', left: 0, top: halo.top, width: halo.left, height: halo.height },
    { key: 'right', left: halo.left + halo.width, top: halo.top, right: 0, height: halo.height },
  ];
}

/**
 * Centred modal card shown after the last step of a user-facing
 * lesson. Offers "Next lesson: <title>" (while the curriculum has an
 * unfinished entry), "Continue playing" (stay in the finished hand)
 * and "Back to lobby" (leave + route home). Lives outside the active-
 * step gate because `advance()` already cleared the step when the
 * lesson finished.
 */
function CompletionPrompt({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const transport = useTransport();
  const dismissCompletion = useTutorial((s) => s.dismissCompletion);
  const tutorialsCompleted = useGame((s) => s.settings.tutorialsCompleted);
  const window = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const lesson = LESSONS[lessonId];
  const next = nextLesson(tutorialsCompleted);
  const done = LESSON_ORDER.filter((id) => tutorialsCompleted.includes(id)).length;

  const opacity = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(8)).current;
  useEffect(() => {
    const duration = reducedMotion ? 100 : 260;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: false }),
      Animated.timing(slide, {
        toValue: 0,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [opacity, slide, reducedMotion]);

  const onNextLesson = () => {
    if (!next) return;
    // `joinSoloTutorial` → `begin(nextId)` resets `justCompleted`.
    transport.joinSoloTutorial(next.id);
  };
  const onLeaveToLobby = () => {
    dismissCompletion();
    transport.leave();
    router.replace('/');
  };

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        backgroundColor: `rgba(${SCRIM_RGB},${SCRIM_ALPHA})`,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <Animated.View
        style={[
          {
            width: Math.min(440, window.width - 40),
            backgroundColor: GLASS_BG,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: GLASS_BORDER,
            padding: 22,
            gap: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
            opacity,
            transform: [{ translateY: slide }],
          },
          webOnly({ backdropFilter: 'blur(16px) saturate(140%)' }),
        ]}
      >
        <Text
          style={{
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: COLORS.gold,
            fontFamily: BODY_FONT,
          }}
        >
          {`Curriculum · ${done}/${LESSON_ORDER.length} done`}
        </Text>
        <Text
          accessibilityRole="header"
          style={{
            fontSize: 24,
            lineHeight: 30,
            fontWeight: '800',
            letterSpacing: -0.4,
            color: TEXT_PRIMARY,
            fontFamily: TITLE_FONT,
          }}
        >
          Nice work!
        </Text>
        <Text
          style={{
            fontSize: 14,
            lineHeight: 21,
            color: 'rgba(255,255,255,0.78)',
            fontFamily: BODY_FONT,
          }}
        >
          {next
            ? `You finished "${lesson?.title ?? 'the lesson'}". Want to keep going with the next lesson, or keep playing this hand?`
            : `That's every lesson done. Keep playing this hand, or head back to the lobby for a real match.`}
        </Text>
        <View style={{ gap: 8, marginTop: 4 }}>
          {next ? (
            <PrimaryButton
              label={`Next lesson: ${next.title}`}
              accessibilityLabel={`Start next lesson: ${next.title}`}
              onPress={onNextLesson}
              stretch
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue playing"
            onPress={dismissCompletion}
            style={(s: HoverState) => ({
              minHeight: 44,
              paddingHorizontal: 18,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(216,168,90,0.45)',
              backgroundColor: s.pressed
                ? 'rgba(255,255,255,0.12)'
                : s.hovered
                  ? 'rgba(255,255,255,0.08)'
                  : 'rgba(255,255,255,0.05)',
            })}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: '800',
                color: TEXT_PRIMARY,
                fontFamily: BODY_FONT,
              }}
            >
              Continue playing
            </Text>
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <QuietButton label="Back to lobby" onPress={onLeaveToLobby} />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

// Re-export the rect type for components that want to type their
// `<TutorialTarget>` measurements without reaching into TargetRegistry.
export type { TargetRect };
