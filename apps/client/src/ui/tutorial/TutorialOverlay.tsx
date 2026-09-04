import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
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
import { Tutorial3D } from '../../three/entry';
import { COLORS } from '../colors';
import { HaloRing, PulseRing, SCRIM_ALPHA, SCRIM_RGB, SpotlightScrim } from './SpotlightScrim';
import {
  type TargetRect,
  type TargetRegistryApi,
  useTargetRegistry,
  useTutorialTargetRect,
} from './TargetRegistry';
import { OVERLAY_ATTR, isChromeCandidate } from './chromeRects';
import { focusFor } from './focus';
import {
  CENTRE_CHROME_GAP,
  type CaptionPlacement,
  HALO_RADIUS,
  type HaloRect,
  type SideMask,
  centredRoom,
  encloseStraddlers,
  featherFor,
  haloFor,
  placeCaption,
  safeInset,
  trimStraddlers,
} from './placement';
import type { Lesson, LessonStep } from './types';
import { useChromeRects } from './useChromeRects';
import { useReducedMotion } from './useReducedMotion';
import { useSceneClippedRect } from './useSceneClip';
import { useFocusedRect, useFollowedRect, useSettledRect } from './useTargetTracking';
import { useTutorialController } from './useTutorialController';

/** Ease-out curve for the card entrance. */
const CARD_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Web card entrance: a short fade as a compiled CSS keyframe class
 * (`animationKeyframes` is a react-native-web extension that only works
 * through StyleSheet.create). Compositor-driven, starts on the element's
 * first frame, and needs no painted "from" state or JS ticks — a
 * JS-driven `Animated.timing` depends on requestAnimationFrame, which a
 * software-rendered or CPU-starved page can stall for hundreds of ms
 * (the verifier caught the card frozen at opacity 0).
 *
 * Opacity only, from `ENTRANCE_FROM` rather than 0: the card's box never
 * moves, so the CTA is clickable the moment the step changes (a
 * translate would keep Playwright — and a user's first tap — waiting for
 * the box to settle across two frames, which a starved renderer can
 * stretch to seconds), and a frame caught at the start of the fade still
 * shows a readable card instead of a blank spot on the scrim.
 */
const ENTRANCE_FROM = 0.55;
const webEntrance =
  Platform.OS === 'web'
    ? (() => {
        const frames = [{ from: { opacity: ENTRANCE_FROM }, to: { opacity: 1 } }];
        return StyleSheet.create({
          normal: {
            animationKeyframes: frames,
            animationDuration: '200ms',
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
/** Opaque card for the docks that land over chrome or the spotlit
 *  target itself (the portrait result-panel fallback, a card flush to
 *  the top HUD). Glass has nothing worth showing through there, and a
 *  backdrop blur over bright chrome smears its labels into the card
 *  instead of hiding them — so no tint-only compromise: solid ink, no
 *  backdrop-filter. */
const GLASS_BG_SOLID = 'rgb(16,22,19)';
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

  const rootRef = useRef<View | null>(null);
  const originNode = () =>
    rootRef.current as unknown as { getBoundingClientRect(): DOMRect } | null;
  // The 3D table clips the discard pool to the river interior it
  // publishes, so the ring stays off the walls; other targets and the
  // classic renderer pass straight through.
  const registeredRect = useSceneClippedRect(useTutorialTargetRect(targetId), targetId, originNode);
  // Optional focus band (the result panel's score header + hand): the
  // ring, the card and the tap panels all work from the clipped rect.
  const liveRect = useFocusedRect(
    registeredRect,
    targetId,
    focusFor(targetId, step.targetFocus),
    originNode,
  );
  const focused = liveRect !== null && liveRect !== registeredRect;
  const haloRect = useFollowedRect(liveRect, reducedMotion);
  const cardRect = useSettledRect(liveRect, stepKey);

  // Chrome the card must not bisect and the feather must not un-dim:
  // DOM controls / labels on web, plus every other registered target.
  const domChrome = useChromeRects({
    active: true,
    targetId,
    stepKey,
    viewport: window,
    settledRect: cardRect,
    focusBand: focused ? toHalo(liveRect) : null,
    originNode,
  });
  // The whole target when only a band of it is spotlit: the card stays
  // off it (side dock) or paints solid over its dimmed remainder.
  const keepClear = focused ? toHalo(registeredRect) : null;
  const registryChrome = otherTargetRects(registry, targetId, window);
  const avoid = registryChrome.length > 0 ? [...domChrome, ...registryChrome] : domChrome;

  // Overlay wrapper size drives the scrim SVG so it spans the actual
  // rendered area on Android edge-to-edge (where `useWindowDimensions`
  // excludes the nav-bar inset). Seeded from the window so the scrim
  // paints on the first commit.
  const [overlaySize, setOverlaySize] = useState({ w: window.width, h: window.height });

  // Card height, measured per step. Keyed so a stale height from the
  // previous step (or a previous viewport) is never used for this one.
  // On web the measurement lands synchronously before the first paint
  // (layout effect below); native shows the card once it has landed.
  // `mode` records which layout was measured — the regular card or the
  // landscape bottom strip — so a strip's ~90 px never stands in for the
  // card height in the fits checks (and flips the dock back and forth).
  const measureKey = `${stepKey}|${window.width}x${window.height}`;
  const [measured, setMeasured] = useState<{
    key: string;
    height: number;
    mode: 'card' | 'strip';
  } | null>(null);
  const cardHeight =
    measured?.key === measureKey && measured.mode === 'card' ? measured.height : null;
  const stripHeight =
    measured?.key === measureKey && measured.mode === 'strip' ? measured.height : null;
  const cardRef = useRef<View | null>(null);
  /** Layout the card is currently rendered in (read by the measurers). */
  const modeRef = useRef<'card' | 'strip'>('card');
  // Body (ScrollView) height, same keying — `cardHeight - bodyHeight` is
  // the card's real chrome, which sizes the body cap below.
  const [bodyMeasured, setBodyMeasured] = useState<{ key: string; height: number } | null>(null);
  const bodyHeight = bodyMeasured?.key === measureKey ? bodyMeasured.height : null;
  /** The card's measured chrome (everything but the body) per step +
   *  viewport (see below). */
  const chromeRef = useRef<{ key: string; chrome: number }>({ key: '', chrome: 0 });

  // A centred (no-target) card keeps clear of the user's hand row: the
  // registered `own-hand` rect is a keep-out for its placement, and when
  // the card is too tall to fit above it the body scrolls instead of
  // the card sitting on the tiles (landscape phone, 3D table).
  const handRect = useTutorialTargetRect(targetId === 'own-hand' ? null : 'own-hand');

  // Web: measure synchronously before paint. RNW's `onLayout` goes
  // through ResizeObserver + setTimeout, i.e. it waits for a frame — on a
  // starved renderer that is hundreds of ms of invisible card. Reading
  // the rect here positions the card correctly on its very first paint;
  // `onLayout` stays attached for later size changes (font load).
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if ((modeRef.current === 'strip' ? stripHeight : cardHeight) !== null) return;
    const node = cardRef.current as unknown as {
      getBoundingClientRect?: () => { height: number };
    } | null;
    const h = node?.getBoundingClientRect?.().height ?? 0;
    if (h > 0) setMeasured({ key: measureKey, height: h, mode: modeRef.current });
  }, [cardHeight, stripHeight, measureKey]);

  // The ring grows to enclose any small control it would otherwise
  // bisect (the wall counter under the dice modal) and is cut back from
  // any large one it would otherwise cross (the hand row under the
  // landscape dice modal — that side then opens: straight scrim edge,
  // no stroke); the card is placed against the same adjusted halo so
  // the two never disagree.
  const shapeHalo = (rect: TargetRect | null) =>
    trimStraddlers(encloseStraddlers(haloFor(rect, window), avoid, window), avoid);
  const { halo, open } = shapeHalo(haloRect);
  const feather = halo ? featherFor(halo, avoid) : undefined;
  const cardHalo = shapeHalo(cardRect).halo;
  const keepOut = cardHalo === null ? toHalo(handRect) : null;
  const avoidForCard = keepOut ? [...avoid, keepOut] : avoid;
  const placement = placeCaption({
    viewport: { width: window.width, height: window.height },
    halo: cardHalo,
    cardHeight,
    stripHeight,
    avoid: avoidForCard,
    keepClear,
  });
  const strip = placement.kind === 'strip';
  modeRef.current = strip ? 'strip' : 'card';
  const solid = placement.overlapsChrome;
  const glassBg = solid ? GLASS_BG_SOLID : GLASS_BG;
  publishLayout({
    stepKey,
    placement,
    halo,
    feather,
    open,
    avoid,
    cardHeight,
    solid,
    viewport: { width: window.width, height: window.height },
  });

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
  // Web paints the card at once (its measurement lands before the first
  // paint, and the estimate-placed card is already in the right spot);
  // native waits for the async measurement so the card never jumps.
  const ready = Platform.OS === 'web' || (strip ? stripHeight : cardHeight) !== null;
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
  // Below this width the header stacks (lesson + step labels on one
  // row, dots beneath) — a single row would wrap the labels.
  const stackedHeader = placement.width < 380;
  // Hard CTA-visibility guarantee: cap the body copy so the whole card
  // fits between the safe insets even for a narrow side dock (landscape
  // phone beside the result panel). `CHROME` approximates everything in
  // the card that is not body text; overflow scrolls inside the card.
  const chromeEstimate = compact ? 220 : 236;
  let bodyMaxHeight = Math.max(64, window.height - safeInset(window.width) * 2 - chromeEstimate);
  // Real chrome (everything but the body), taken once per step from the
  // first pair of measurements — before any cap has moved the body, so
  // the two agree. Later pairs can be a render apart (the body reports
  // its new height before the card does) and would inflate the chrome
  // by exactly the amount the body just shrank.
  if (cardHeight !== null && bodyHeight !== null && chromeRef.current.key !== measureKey)
    chromeRef.current = { key: measureKey, chrome: cardHeight - bodyHeight };
  // Centred card: room between the chrome above it and the hand row.
  // The cap depends only on those rects — never on the card's own
  // height or dock — so it follows the 3D camera easing in without
  // ping-ponging. It applies from the very first render (with the
  // chrome estimate until the real chrome is known) so the line count
  // the user sees does not depend on when the measurements landed.
  // (Docked cards are deliberately not capped this way: their dock
  // kind depends on the card height, and a cap keyed to the dock
  // oscillated between an above dock and a side dock every frame.)
  if (keepOut) {
    const chromeNow =
      chromeRef.current.key === measureKey ? chromeRef.current.chrome : chromeEstimate;
    const room = centredRoom(keepOut, avoidForCard, window, placement.width);
    bodyMaxHeight = Math.min(bodyMaxHeight, room - chromeNow);
  }
  // Snap a capped body to whole lines so the scroll edge falls between
  // lines instead of slicing one in half; never below three lines.
  const lineHeight = strip ? STRIP_LINE_HEIGHT : compact ? 17 : 21;
  if (strip) bodyMaxHeight = STRIP_LINE_HEIGHT * STRIP_BODY_LINES;
  bodyMaxHeight = Math.max(lineHeight * 3, Math.floor(bodyMaxHeight / lineHeight) * lineHeight);
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
      // `overflow: hidden` clips a halo side that overhangs the viewport
      // (see `haloFor`): the ring simply runs off the edge there instead
      // of drawing its stroke across the target.
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        overflow: 'hidden',
      }}
      pointerEvents="box-none"
    >
      {/* World-space accent on the 3D table: the targeted tiles take the
          gold highlight while this step is active (no-op under classic). */}
      {Tutorial3D ? <Tutorial3D /> : null}
      <SpotlightScrim
        width={overlaySize.w}
        height={overlaySize.h}
        halo={halo}
        radius={HALO_RADIUS}
        feather={feather}
        open={open}
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
          <PulseRing
            halo={halo}
            radius={HALO_RADIUS}
            reducedMotion={reducedMotion}
            feather={feather}
            open={open}
          />
          <HaloRing halo={halo} radius={HALO_RADIUS} feather={feather} open={open} />
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
            const mode = modeRef.current;
            setMeasured((prev) =>
              prev?.key === measureKey && prev.height === height && prev.mode === mode
                ? prev
                : { key: measureKey, height, mode },
            );
          }}
          style={[
            {
              width: '100%',
              backgroundColor: glassBg,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: GLASS_BORDER,
              padding: strip ? 10 : compact ? 12 : 18,
              paddingHorizontal: strip ? 14 : undefined,
              gap: strip ? 6 : compact ? 6 : 10,
              boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
            },
            solid ? null : webOnly({ backdropFilter: 'blur(16px) saturate(140%)' }),
          ]}
        >
          {strip ? (
            <StripBody
              lessonLabel={lessonLabel}
              ids={lesson.steps.map((st) => st.id)}
              index={stepIndex}
              title={step.caption.title}
              body={step.caption.body}
              bodyMaxHeight={bodyMaxHeight}
              fill={glassBg}
              onBodyLayout={(height) =>
                setBodyMeasured((prev) =>
                  prev?.key === measureKey && prev.height === height
                    ? prev
                    : { key: measureKey, height },
                )
              }
              cta={
                step.completedWhen ? null : (
                  <PrimaryButton label={ctaLabel} onPress={advance} testID="tutorial-next" />
                )
              }
              skip={<QuietButton label="Skip lesson" onPress={dismiss} compact />}
              restart={
                canRestart ? (
                  <QuietButton
                    label="Restart"
                    accessibilityLabel="Restart lesson"
                    onPress={() => transport.joinSoloTutorial(lesson.id)}
                    compact
                  />
                ) : null
              }
            />
          ) : (
            <>
              <CardHeader
                lessonLabel={lessonLabel}
                ids={lesson.steps.map((st) => st.id)}
                index={stepIndex}
                compact={compact}
                stacked={stackedHeader}
              />
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
              <ScrollBody
                text={step.caption.body}
                maxHeight={bodyMaxHeight}
                fontSize={compact ? 12.5 : 14}
                lineHeight={compact ? 17 : 21}
                fill={glassBg}
                onLayout={(height) =>
                  setBodyMeasured((prev) =>
                    prev?.key === measureKey && prev.height === height
                      ? prev
                      : { key: measureKey, height },
                  )
                }
              />
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
            </>
          )}
        </View>
        {placement.notch !== null ? <Notch placement={placement} fill={glassBg} /> : null}
      </Animated.View>
    </View>
  );
}

/**
 * Test hook: the last computed coach-mark layout, readable from the
 * page as `globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__`. Lets the e2e
 * specs assert placement invariants (no bisected chrome, notch dropped
 * when the card is pushed away, solid card over chrome) in overlay
 * coordinates instead of re-deriving them from bounding boxes. Plain
 * assignment, no React state — cheap enough to run every render.
 */
export interface TutorialLayoutSnapshot {
  stepKey: string;
  placement: CaptionPlacement;
  halo: HaloRect | null;
  feather: ReturnType<typeof featherFor> | undefined;
  /** Sides the ring was trimmed to (open edge, no stroke). */
  open: SideMask;
  avoid: readonly HaloRect[];
  cardHeight: number | null;
  solid: boolean;
  viewport: { width: number; height: number };
}

function publishLayout(snapshot: TutorialLayoutSnapshot): void {
  (
    globalThis as unknown as { __MAHJONG_TEST_TUTORIAL_LAYOUT__?: TutorialLayoutSnapshot }
  ).__MAHJONG_TEST_TUTORIAL_LAYOUT__ = snapshot;
}

function toHalo(r: TargetRect | null): HaloRect | null {
  return r ? { left: r.x, top: r.y, width: r.w, height: r.h } : null;
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

/** Body copy in the landscape bottom strip: one size, up to three lines. */
const STRIP_LINE_HEIGHT = 18;
const STRIP_BODY_LINES = 3;
/** Height of the bottom fade that marks a capped, scrollable body. */
const BODY_FADE_H = 24;

/**
 * Scrolling body copy with an overflow cue. When the text is taller than
 * the cap, a bottom gradient in the card colour plus a small chevron say
 * "more below" — web shows no scrollbar for an overlay ScrollView, so a
 * capped paragraph otherwise reads as truncated mid-sentence. The cue
 * hides once the user has scrolled to the end.
 */
function ScrollBody({
  text,
  maxHeight,
  fontSize,
  lineHeight,
  fill,
  onLayout,
}: {
  text: string;
  maxHeight: number;
  fontSize: number;
  lineHeight: number;
  fill: string;
  onLayout?: (height: number) => void;
}) {
  const [contentH, setContentH] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const overflow = contentH > maxHeight + 1;
  return (
    <View style={{ flexGrow: 0, flexShrink: 1, minHeight: 0 }}>
      <ScrollView
        style={{ maxHeight, flexGrow: 0 }}
        showsVerticalScrollIndicator
        nestedScrollEnabled
        scrollEventThrottle={32}
        onContentSizeChange={(_w, h) => setContentH(h)}
        onScroll={(e) => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          setAtEnd(contentOffset.y + layoutMeasurement.height >= contentSize.height - 2);
        }}
        onLayout={(e) => onLayout?.(e.nativeEvent.layout.height)}
      >
        <Text
          style={{
            fontSize,
            lineHeight,
            color: 'rgba(255,255,255,0.78)',
            fontFamily: BODY_FONT,
          }}
        >
          {text}
        </Text>
      </ScrollView>
      {overflow && !atEnd ? (
        <View
          testID="tutorial-body-more"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: BODY_FADE_H,
              alignItems: 'center',
              justifyContent: 'flex-end',
            },
            webOnly({
              backgroundImage: `linear-gradient(to bottom, rgba(14,20,17,0) 0%, ${fill} 100%)`,
            }),
          ]}
        >
          <Svg width={14} height={8} viewBox="0 0 14 8">
            <Path
              d="M1 1 L7 7 L13 1"
              fill="none"
              stroke={TEXT_SECONDARY}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Landscape bottom-strip layout (`placement.kind === 'strip'`): one row
 * of title + lesson / step labels, then the body beside the buttons —
 * ~90 px tall, so it sits over the dimmed hand row under a wide modal
 * target instead of covering the modal.
 */
function StripBody({
  lessonLabel,
  ids,
  index,
  title,
  body,
  bodyMaxHeight,
  fill,
  onBodyLayout,
  cta,
  skip,
  restart,
}: {
  lessonLabel: string;
  ids: string[];
  index: number;
  title: string;
  body: string;
  bodyMaxHeight: number;
  fill: string;
  onBodyLayout: (height: number) => void;
  cta: ReactNode;
  skip: ReactNode;
  restart: ReactNode;
}) {
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Text
          accessibilityRole="header"
          accessibilityLabel={`Tutorial step: ${title}`}
          numberOfLines={1}
          style={{
            fontSize: 15,
            lineHeight: 19,
            fontWeight: '800',
            letterSpacing: -0.2,
            color: TEXT_PRIMARY,
            fontFamily: TITLE_FONT,
            flexShrink: 1,
          }}
        >
          {title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <Text numberOfLines={1} style={[MICRO_LABEL, { color: COLORS.gold }]}>
            {lessonLabel}
          </Text>
          {ids.length > 1 ? (
            <>
              <StepDots ids={ids} index={index} />
              <Text
                testID="tutorial-step-label"
                numberOfLines={1}
                accessibilityLabel={`Step ${index + 1} of ${ids.length}`}
                style={[MICRO_LABEL, { color: TEXT_SECONDARY }]}
              >
                {`Step ${index + 1} of ${ids.length}`}
              </Text>
            </>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ScrollBody
            text={body}
            maxHeight={bodyMaxHeight}
            fontSize={13}
            lineHeight={STRIP_LINE_HEIGHT}
            fill={fill}
            onLayout={onBodyLayout}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {skip}
          {restart}
          {cta}
        </View>
      </View>
    </>
  );
}

const MICRO_LABEL: TextStyle = {
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 2,
  textTransform: 'uppercase',
  fontFamily: BODY_FONT,
};

/**
 * Card header: the `LESSON N/14` label, the step dots and a `STEP n OF m`
 * micro-label. The lesson label counts lessons in the curriculum while
 * the dots count steps inside this lesson — without the step label a
 * first-time user reads the dots as lesson progress.
 *
 * Wide cards keep everything on one row (label left, dots + step label
 * right); narrower ones stack: both labels on the first row, dots
 * beneath, so nothing wraps mid-label. `compact` shortens the step label
 * to `STEP n/m`.
 */
function CardHeader({
  lessonLabel,
  ids,
  index,
  compact,
  stacked,
}: {
  lessonLabel: string;
  ids: string[];
  index: number;
  compact: boolean;
  stacked: boolean;
}) {
  const count = ids.length;
  const lesson = (
    <Text numberOfLines={1} style={[MICRO_LABEL, { color: COLORS.gold }]}>
      {lessonLabel}
    </Text>
  );
  if (count <= 1) return lesson;
  const stepLabel = (
    <Text
      testID="tutorial-step-label"
      numberOfLines={1}
      accessibilityLabel={`Step ${index + 1} of ${count}`}
      style={[MICRO_LABEL, { color: TEXT_SECONDARY }]}
    >
      {compact ? `Step ${index + 1}/${count}` : `Step ${index + 1} of ${count}`}
    </Text>
  );
  if (!stacked) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        {lesson}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
          <StepDots ids={ids} index={index} />
          {stepLabel}
        </View>
      </View>
    );
  }
  if (compact) {
    // Side dock on a landscape phone (~200 px): one item per row — two
    // labels side by side would both truncate.
    return (
      <View style={{ gap: 5, alignItems: 'flex-start' }}>
        {lesson}
        <StepDots ids={ids} index={index} />
        {stepLabel}
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        {lesson}
        {stepLabel}
      </View>
      <StepDots ids={ids} index={index} />
    </View>
  );
}

function StepDots({ ids, index }: { ids: string[]; index: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
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
  /** Narrow side-dock cards: tighter horizontal padding. Every button
   *  keeps the 44 px hit-target floor regardless. */
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
        minHeight: 44,
        paddingHorizontal: compact ? 8 : 10,
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
  // A halo side that overhangs the viewport (open ring) has no strip
  // on that side; clamp so no panel gets a negative size.
  const top = Math.max(0, halo.top);
  const bottom = Math.max(top, halo.top + halo.height);
  const left = Math.max(0, halo.left);
  return [
    { key: 'top', left: 0, top: 0, right: 0, height: top },
    { key: 'bottom', left: 0, top: bottom, right: 0, bottom: 0 },
    { key: 'left', left: 0, top, width: left, height: bottom - top },
    {
      key: 'right',
      left: Math.max(left, halo.left + halo.width),
      top,
      right: 0,
      height: bottom - top,
    },
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
