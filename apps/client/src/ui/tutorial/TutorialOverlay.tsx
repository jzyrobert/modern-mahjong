import { useRouter } from 'expo-router';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { Tutorial3D, tutorialSceneRects } from '../../three/entry';
import { resolveRenderer } from '../../three/renderer';
import { COLORS } from '../colors';
import { HaloRing, PulseRing, SCRIM_ALPHA, SCRIM_RGB, SpotlightScrim } from './SpotlightScrim';
import {
  type TargetRect,
  type TargetRegistryApi,
  useTargetRegistry,
  useTutorialTargetRect,
} from './TargetRegistry';
import {
  BODY_CUE_H,
  type CardFrame,
  MIN_SCROLL_LINES,
  MIN_STRIP_LINES,
  STACKED_HEADER_MAX_WIDTH,
  STRIP_BREATHING,
  bodyCap,
  chooseFrame,
  fitBody,
} from './bodyCap';
import { OVERLAY_ATTR, isChromeCandidate } from './chromeRects';
import { focusFor } from './focus';
import {
  CARD_MAX_WIDTH,
  CENTRE_CHROME_GAP,
  type CaptionPlacement,
  HALO_RADIUS,
  type HaloRect,
  NARROW_STRIP_MAX_WIDTH,
  SHORT_VIEWPORT_MAX_HEIGHT,
  type SideMask,
  centredRoom,
  clearGrazers,
  encloseStraddlers,
  featherFor,
  haloFor,
  noSideSlot,
  placeCaption,
  safeInset,
  slotRoom,
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
        } as unknown as Record<'normal', ViewStyle>);
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

  // The 3D table eases its camera in as the lesson opens; hold the
  // lesson's first card (and the scrim) until the rig has come to rest so
  // the opening coach-mark never sits over a table caught mid-dolly.
  const is3d = resolveRenderer(useGame((s) => s.settings.renderer)) === '3d';
  const sceneSettled = useCameraSettled(
    active ? active.lesson.id : null,
    is3d && (active?.stepIndex ?? 0) === 0,
  );

  if (!active && justCompleted) return <CompletionPrompt lessonId={justCompleted} />;
  if (!active) return null;
  if (!sceneSettled) return null;
  return (
    <ActiveStep
      lesson={active.lesson}
      step={active.step}
      stepIndex={active.stepIndex}
      classic={!is3d}
    />
  );
}

/** How far the classic shells' `HandTile` lifts the freshly drawn tile
 *  above the hand row (translateY −10 px, scale 1.06) beyond the 4 px
 *  pad the registered `own-hand` wrapper gives it. The keep-out grows by
 *  this much under the classic renderer so a card measured to the rect
 *  still clears the lifted tile by the placement's air. The 3D shell
 *  registers the tiles' settled poses, so nothing pokes out there. */
const CLASSIC_HAND_LIFT = 8;

/** Quiet the rig must hold before its motion counts as over. */
const CAMERA_QUIET_MS = 160;
/** Longest the first card waits for the rig — a stuck camera never hides a lesson. */
const CAMERA_WAIT_MAX_MS = 3500;
/** Grace for a rig that has not stepped yet: the shell can retarget the
 *  camera a beat after mount (inset / size settle), so an idle rig at
 *  mount is not yet proof it will stay put. */
const CAMERA_FIRST_TICK_GRACE_MS = 240;

/**
 * True once the 3D camera rig has been at rest for `CAMERA_QUIET_MS`
 * (or `CAMERA_WAIT_MAX_MS` has elapsed) since `lessonId` changed. Opens
 * once per lesson and stays open; always true when `enabled` is false
 * (classic renderer, later steps) or no scene publishes camera motion.
 */
function useCameraSettled(lessonId: string | null, enabled: boolean): boolean {
  const rects = tutorialSceneRects;
  const [openFor, setOpenFor] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !rects || lessonId === null || openFor === lessonId) return;
    const startedAt = performance.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const open = () => {
      if (done) return;
      done = true;
      setOpenFor(lessonId);
    };
    const check = () => {
      if (done) return;
      const now = performance.now();
      const m = rects.getCameraMotion();
      if (now - startedAt >= CAMERA_WAIT_MAX_MS) return open();
      if (timer !== null) clearTimeout(timer);
      if (m.live) {
        timer = setTimeout(check, CAMERA_QUIET_MS);
        return;
      }
      const quietSince = m.ticks === 0 ? startedAt : Math.max(m.lastLiveAt, startedAt);
      const need = m.ticks === 0 ? CAMERA_FIRST_TICK_GRACE_MS : CAMERA_QUIET_MS;
      const wait = need - (now - quietSince);
      if (wait <= 0) return open();
      timer = setTimeout(check, wait);
    };
    const unsub = rects.subscribeCamera(check);
    check();
    return () => {
      done = true;
      unsub();
      if (timer !== null) clearTimeout(timer);
    };
  }, [enabled, rects, lessonId, openFor]);
  if (!enabled || !rects || lessonId === null) return true;
  return openFor === lessonId;
}

interface ActiveStepProps {
  lesson: Lesson;
  step: LessonStep;
  stepIndex: number;
  /** Classic renderer (see `CLASSIC_HAND_LIFT`). */
  classic: boolean;
}

/** Coach-card glass. Deep enough that the felt, walls and tiles behind
 *  the header and action rows read as a tint, not as geometry through
 *  the card: at 0.86 the dice, the plate glyph and the near-wall stacks
 *  were still identifiable through the header and action rows, so the
 *  fill sits just under opaque and the blur only softens the tint. */
const GLASS_BG = 'rgba(12,16,14,0.94)';
/** Backdrop blur behind a glass card (px). */
const GLASS_BLUR_PX = 18;
/** Opaque card for the docks that land over chrome or the spotlit
 *  target itself (the portrait result-panel fallback, a card flush to
 *  the top HUD). Glass has nothing worth showing through there, and a
 *  backdrop blur over bright chrome smears its labels into the card
 *  instead of hiding them — so no tint-only compromise: solid ink, no
 *  backdrop-filter. */
const GLASS_BG_SOLID = 'rgb(16,22,19)';
const GLASS_BORDER = 'rgba(255,255,255,0.12)';
/** Card frame on a short (landscape-phone) viewport — see `dense`. */
const DENSE_CARD_PAD = 12;
const DENSE_CARD_GAP = 6;
/** …and the tight frame (see `bodyCap.CardFrame`). */
const TIGHT_CARD_PAD = 10;
const TIGHT_CARD_GAP = 4;
/** How long the web card waits for the hand to rest and the frame to
 *  settle before it shows with just its measurements agreed (see the
 *  reveal gate in `ActiveStep`) — under the readiness budget the specs
 *  hold the CTA to (1.5 s after the scrim). */
const REVEAL_MAX_MS = 900;
/** …and the longest it waits for anything at all (see the fallbacks in
 *  `ActiveStep`): both this much time and this many rendered frames —
 *  measurements and chrome scans arrive within the first two or three
 *  frames, so a card still unsettled after both has something else
 *  wrong and shows regardless. */
const REVEAL_HARD_MAX_MS = 2500;
const REVEAL_HARD_MAX_FRAMES = 12;
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

function ActiveStep({ lesson, step, stepIndex, classic }: ActiveStepProps) {
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
  const haloRect = useFollowedRect(liveRect, reducedMotion, stepKey);
  const cardRect = useSettledRect(liveRect, stepKey);

  // Chrome the card must not bisect and the feather must not un-dim:
  // DOM controls / labels on web, plus every other registered target.
  const {
    chrome: domChrome,
    keepOuts: domKeepOuts,
    scans: chromeScans,
    handInPlace,
  } = useChromeRects({
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
  // Both layouts are measured separately — the regular card and the
  // landscape bottom strip — and *both* heights are kept for the step:
  // the strip's ~90 px never stands in for the card height in the fits
  // checks, and the card's height survives a strip render. Keeping only
  // the last measured mode ping-ponged on a landscape phone whose
  // own-hand card fits above the hand at the estimate but not at its
  // real height: card measured → strip chosen → strip measured → card
  // height forgotten → estimate fits → card chosen → … a synchronous
  // layout-effect loop React aborts with "maximum update depth".
  // The card frame (regular / dense, see `bodyCap.chooseFrame`) is part
  // of the key too: its chrome differs by ~30 px, so a regular
  // measurement must never size a dense body.
  const frameKey = `${stepKey}|${window.width}x${window.height}`;
  const [frameState, setFrameState] = useState<{
    key: string;
    frame: CardFrame;
    /** Dense → regular returns so far for this key (at most one). */
    returns: number;
  }>({ key: '', frame: 'regular', returns: 0 });
  const chosenBefore = frameState.key === frameKey ? frameState.frame : null;
  // Web reveal gate: the step whose card has passed it (see `layoutSettled`).
  const [revealedFor, setRevealedFor] = useState('');
  const revealed = revealedFor === stepKey;
  // The frame the lesson's first card settled on at this viewport: later
  // steps start from it and keep it unless their room forces a tighter
  // one, so a lesson never mixes a dense intro with a regular step.
  const lessonKey = `${lesson.id}|${window.width}x${window.height}`;
  const lessonFrameRef = useRef<{ key: string; frame: CardFrame | null }>({
    key: '',
    frame: null,
  });
  const lessonFrame =
    lessonFrameRef.current.key === lessonKey ? lessonFrameRef.current.frame : null;
  // Short viewport (landscape phone): the card lives in the ~215 px
  // band between the top HUD and the hand row, where the regular
  // frame (18 px pad, 10 px gaps, 26 px title) left two body lines and
  // a scroll for a three-sentence intro. Always dense there; portrait
  // phones go dense when the room turns out scarce (decided below).
  const shortViewport = window.width > window.height && window.height <= SHORT_VIEWPORT_MAX_HEIGHT;
  const frame: CardFrame = shortViewport ? 'dense' : (chosenBefore ?? lessonFrame ?? 'regular');
  const measureKey = `${frameKey}|${frame}`;
  const [measured, setMeasured] = useState<{
    key: string;
    card: number | null;
    strip: number | null;
  } | null>(null);
  const cardHeight = measured?.key === measureKey ? measured.card : null;
  const stripHeight = measured?.key === measureKey ? measured.strip : null;
  const recordMeasure = useCallback(
    (mode: 'card' | 'strip', height: number) => {
      setMeasured((prev) => {
        const base = prev?.key === measureKey ? prev : { key: measureKey, card: null, strip: null };
        if (base[mode] === height) return base;
        return { ...base, [mode]: height };
      });
    },
    [measureKey],
  );
  const cardRef = useRef<View | null>(null);
  /** The strip's content block: a stretched strip (`placement.height`)
   *  is measured here so its natural height, not the stretched one,
   *  feeds the placement. */
  const stripRef = useRef<View | null>(null);
  /** Layout the card is currently rendered in (read by the measurers). */
  const modeRef = useRef<'card' | 'strip'>('card');
  // Body (ScrollView) height, same keying — `cardHeight - bodyHeight` is
  // the card's real chrome, which sizes the body cap below.
  const [bodyMeasured, setBodyMeasured] = useState<{ key: string; height: number } | null>(null);
  const bodyHeight = bodyMeasured?.key === measureKey ? bodyMeasured.height : null;
  // Natural height of the body text (the ScrollView's content), keyed by
  // step + viewport + card width — the frame does not change it, so a
  // regular card's measurement still decides whether to go dense.
  const [contentMeasured, setContentMeasured] = useState<{
    key: string;
    height: number;
  } | null>(null);
  /** The card's measured chrome (everything but the body) per step +
   *  viewport + frame (see below). */
  const chromeRef = useRef<{ key: string; chrome: number }>({ key: '', chrome: 0 });
  /** Same for the strip layout, whose chrome is its own (title row,
   *  step label, frame) — a card's chrome must never size a strip body. */
  const stripChromeRef = useRef<{ key: string; chrome: number }>({ key: '', chrome: 0 });

  // Every card keeps clear of the user's hand row: the registered
  // `own-hand` rect is a keep-out for its placement (the two-row portrait
  // hand is taller than the chrome scan admits, and a card that landed
  // on it hid a whole row of tiles), and when a centred card is too tall
  // to fit above it the body scrolls instead of the card sitting on the
  // tiles (landscape phone, 3D table). The result panel is the same kind
  // of region for a card that is not about it (a lesson-complete card).
  // While a result-panel step is up the whole table sits under the
  // result veil and the hand is not interactive, so it is not a keep-out
  // there: on a 360x640 phone the scoring card docks under the pinned
  // result card, over the dimmed hand, instead of falling through to the
  // bottom strip.
  const handRect = useTutorialTargetRect(
    targetId === 'own-hand' || targetId === 'result-panel' ? null : 'own-hand',
  );
  // Whether the hand has stopped moving — the frame decision below only
  // runs while it has. During the deal the live rect spans the tiles
  // still in flight from the wall, which made the intro card's room look
  // scarce for a moment and flipped its frame.
  const handAtRest = useSettledRect(handRect, stepKey) === handRect;
  const panelRect = useTutorialTargetRect(targetId === 'result-panel' ? null : 'result-panel');
  // The hand as a region to keep off: under the classic renderer it
  // reaches `CLASSIC_HAND_LIFT` above the registered wrapper.
  const handKeepOut = useMemo(() => {
    const hand = toHalo(handRect);
    if (!hand || !classic) return hand;
    return { ...hand, top: hand.top - CLASSIC_HAND_LIFT, height: hand.height + CLASSIC_HAND_LIFT };
  }, [handRect, classic]);
  const hardKeepOut = useMemo(() => {
    const out: HaloRect[] = [];
    const panel = toHalo(panelRect);
    if (handKeepOut) out.push(handKeepOut);
    if (panel) out.push(panel);
    return out;
  }, [handKeepOut, panelRect]);

  // Web: measure synchronously before paint. RNW's `onLayout` goes
  // through ResizeObserver + setTimeout, i.e. it waits for a frame — on a
  // starved renderer that is hundreds of ms of invisible card. Reading
  // the rect here positions the card correctly on its very first paint;
  // `onLayout` stays attached for later size changes (font load).
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if ((modeRef.current === 'strip' ? stripHeight : cardHeight) !== null) return;
    const node = (modeRef.current === 'strip' ? stripRef.current : cardRef.current) as unknown as {
      getBoundingClientRect?: () => { height: number };
    } | null;
    const h = node?.getBoundingClientRect?.().height ?? 0;
    if (h > 0) recordMeasure(modeRef.current, h + (modeRef.current === 'strip' ? STRIP_FRAME : 0));
  }, [cardHeight, stripHeight, recordMeasure]);

  // The ring grows to enclose any small control it would otherwise
  // bisect (the wall counter under the dice modal) and is cut back from
  // any large one it would otherwise cross (the hand row under the
  // landscape dice modal — that side then opens: straight scrim edge,
  // no stroke); the card is placed against the same adjusted halo so
  // the two never disagree.
  // Chrome that only grazes the padding band (the landscape footer under
  // the hand row) nudges the edge off it last, so the stroke never lands
  // on a control's edge.
  const shapeHalo = (rect: TargetRect | null) => {
    const trimmed = trimStraddlers(encloseStraddlers(haloFor(rect, window), avoid, window), avoid);
    return { halo: clearGrazers(trimmed.halo, avoid), open: trimmed.open };
  };
  const { halo, open } = shapeHalo(haloRect);
  const feather = halo ? featherFor(halo, avoid) : undefined;
  const cardHalo = shapeHalo(cardRect).halo;
  const keepOut = cardHalo === null ? handKeepOut : null;
  const avoidForCard = keepOut ? [...avoid, keepOut] : avoid;
  // Real chrome (everything but the body), taken once per step from the
  // first pair of measurements — before any cap has moved the body, so
  // the two agree. Later pairs can be a render apart (the body reports
  // its new height before the card does) and would inflate the chrome
  // by exactly the amount the body just shrank. `modeRef` still holds
  // the layout those measurements came from; a strip's chrome must never
  // size a card's body.
  if (
    cardHeight !== null &&
    bodyHeight !== null &&
    modeRef.current === 'card' &&
    chromeRef.current.key !== measureKey
  )
    chromeRef.current = { key: measureKey, chrome: cardHeight - bodyHeight };
  const chromeKnown = chromeRef.current.key === measureKey;
  if (
    stripHeight !== null &&
    bodyHeight !== null &&
    modeRef.current === 'strip' &&
    stripChromeRef.current.key !== measureKey
  )
    stripChromeRef.current = { key: measureKey, chrome: stripHeight - bodyHeight };
  const stripChromeKnown = stripChromeRef.current.key === measureKey;
  // Docked card with no side slot to fall back on (a landscape phone's
  // own-hand step: the hand spans the width, the side gutters are ~100
  // px): cap the body to the larger vertical slot so the card docks
  // there with a scrolling body instead of falling through to the
  // bottom strip — which lies over the spotlit hand itself. The cap
  // depends only on the halo and the measured chrome, never on the
  // card's height or dock, so it cannot oscillate; it applies only when
  // the capped card still shows three lines, so the tall-target
  // fallbacks (result panel) are kept. Placement sees the *capped*
  // height, otherwise the uncapped card would already have chosen the
  // strip and the body would never re-render shorter.
  const safe = safeInset(window.width);
  const dockLine = Math.min(CARD_MAX_WIDTH, window.width - safe * 2) < 260 ? 17 : 21;
  let slotBodyCap = Number.POSITIVE_INFINITY;
  /** Room the docked card has in its vertical slot (see `slotRoom`). */
  let dockRoom = Number.POSITIVE_INFINITY;
  if (cardHalo && chromeKnown && noSideSlot(cardHalo, window)) {
    const room = slotRoom(cardHalo, window);
    const lines = Math.floor((room - chromeRef.current.chrome - BODY_CUE_H) / dockLine);
    if (lines >= MIN_SCROLL_LINES) {
      dockRoom = room;
      slotBodyCap = room - chromeRef.current.chrome;
    }
  }
  const placedCardHeight =
    cardHeight !== null && chromeKnown
      ? Math.min(cardHeight, chromeRef.current.chrome + slotBodyCap)
      : cardHeight;
  const placement = placeCaption({
    viewport: { width: window.width, height: window.height },
    halo: cardHalo,
    cardHeight: placedCardHeight,
    stripHeight,
    avoid: avoidForCard,
    keepClear,
    // A centred card also keeps off the page's keep-out elements (the
    // portrait seat strip): it has the whole free band to size itself
    // into. A docked card or a strip may still cover them whole — the
    // top strip under a river ring has nowhere else to go.
    keepOut: cardHalo === null ? [...hardKeepOut, ...domKeepOuts] : hardKeepOut,
  });
  const strip = placement.kind === 'strip';
  modeRef.current = strip ? 'strip' : 'card';
  const solid = placement.overlapsChrome;
  const glassBg = solid ? GLASS_BG_SOLID : GLASS_BG;

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
  // Web shows the card once its layout is final (the reveal gate below);
  // native waits for the async measurement so the card never jumps.
  const ready = Platform.OS === 'web' ? revealed : (strip ? stripHeight : cardHeight) !== null;
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
  // Room the card really has, from geometry alone (never from the card's
  // own height or dock, so it follows the 3D camera easing in without
  // ping-ponging): a centred card's band between the chrome above it and
  // the hand row; a docked card's vertical slot when it has no side slot
  // to fall back on; the strip's band. Anything else (a side dock, a
  // desktop card) is bounded only by the safe insets. It applies from
  // the very first render (with a chrome estimate until the real chrome
  // is known) so the line count the user sees does not depend on when
  // the measurements landed. (Docked cards with a side slot are
  // deliberately not capped to their dock: the dock kind depends on the
  // card height, and a cap keyed to the dock oscillated between an
  // above dock and a side dock every frame.)
  let room = window.height - safe * 2;
  if (strip) room = placement.room ?? room;
  else if (keepOut)
    room = Math.min(
      room,
      centredRoom(keepOut, avoidForCard, window, placement.width, placement.left),
    );
  else room = Math.min(room, dockRoom);
  // Frame: dense trades padding, gaps and title size for body lines when
  // the room is scarce or the regular frame would scroll the step text
  // (see `chooseFrame`). Decided only while the hand is at rest, so the
  // deal animation cannot flip it; the cap above keeps following the
  // live rect so the card never lands on a tile in flight. A dense card
  // may return to regular once per step — a hard stop on any flip-flop
  // the estimate in `chooseFrame` could otherwise allow.
  const contentKey = `${frameKey}|${strip ? 'strip' : 'card'}|${placement.width}`;
  const contentHeight = contentMeasured?.key === contentKey ? contentMeasured.height : null;
  const returns = frameState.key === frameKey ? frameState.returns : 0;
  let chosenFrame: CardFrame = frame;
  if (!compact && !strip && !shortViewport && handAtRest) {
    chosenFrame = chooseFrame({
      room,
      chrome: chromeKnown ? chromeRef.current.chrome : null,
      current: frame,
      width: placement.width,
      contentHeight,
      lessonFrame,
    });
    if (chosenFrame === 'regular' && frame === 'dense' && returns >= 1) chosenFrame = 'dense';
  }
  // Flip before paint: the frame decides the card's measurements, and
  // a layout effect re-renders synchronously so the regular card is
  // never painted on a viewport that needs the dense one.
  useLayoutEffect(() => {
    if (chosenFrame !== frame)
      setFrameState((prev) => ({
        key: frameKey,
        frame: chosenFrame,
        returns: (prev.key === frameKey ? prev.returns : 0) + (chosenFrame === 'regular' ? 1 : 0),
      }));
  }, [chosenFrame, frame, frameKey]);
  const dense = !compact && frame !== 'regular';
  const tight = !compact && frame === 'tight';
  // Below this width the regular header stacks (lesson + step labels on
  // one row, dots beneath) — a single row would wrap the labels. The
  // dense header is always one row (labels only, no dots) so the body
  // gets that row back; the tight frame drops the row altogether.
  const stackedHeader = placement.width < STACKED_HEADER_MAX_WIDTH && !dense;
  // Everything in the card that is not body text, before it is measured:
  // conservative, so the first paint never overshoots the room.
  const chromeEstimate = strip ? 70 : compact ? 220 : tight ? 160 : dense ? 200 : 236;
  const chromeNow = strip
    ? stripChromeKnown
      ? stripChromeRef.current.chrome
      : chromeEstimate
    : chromeKnown
      ? chromeRef.current.chrome
      : chromeEstimate;
  const lineHeight = strip ? STRIP_LINE_HEIGHT : compact ? 17 : 21;
  // The body gets the room less the chrome (floored at three lines plus
  // the cue gutter); `ScrollBody` snaps it to whole lines once it knows
  // the text height, so a text that fits shows whole with no cue. A
  // strip keeps `STRIP_BREATHING` off its band's far edge so it never
  // outgrows the band that placed it.
  const bodyMaxHeight = bodyCap(
    strip ? room - STRIP_BREATHING : room,
    chromeNow,
    lineHeight,
    strip ? MIN_STRIP_LINES : MIN_SCROLL_LINES,
  );
  // Reveal gate (web): the card stays at opacity 0 until its layout is
  // final — chrome and text measured for this frame, the body at the
  // height those measurements give it, the frame decision settled and
  // the hand at rest — then fades in once in its final geometry. A card
  // shown at the chrome *estimate* grew by a line or two a frame later.
  // The fallbacks below bound the wait so nothing can hide a lesson.
  const fitNow = contentHeight !== null ? fitBody(contentHeight, bodyMaxHeight, lineHeight) : null;
  const expectedBody = fitNow ? fitNow.height + (fitNow.overflow ? BODY_CUE_H : 0) : null;
  const measurementsSettled =
    (strip ? stripChromeKnown : chromeKnown) &&
    bodyHeight !== null &&
    expectedBody !== null &&
    Math.abs(bodyHeight - expectedBody) <= 1;
  // Three chrome scans (mount + the next two frames) with the hand tiles
  // where the hand row says they are: the room is read from the page as
  // it is once the deal and any mount-time churn are over, so the frame
  // the card reveals in is the one it keeps. (A scan taken between two
  // rendered frames of the 3D shell still saw the tiles' hit targets in
  // flight and read a 30 px room.)
  const pageSettled = Platform.OS !== 'web' || (chromeScans >= 3 && handInPlace);
  const layoutSettled =
    measurementsSettled &&
    pageSettled &&
    chosenFrame === frame &&
    (handRect === null || handAtRest);
  useLayoutEffect(() => {
    if (layoutSettled && !revealed) {
      setRevealedFor(stepKey);
      if (!compact && !strip && !shortViewport)
        lessonFrameRef.current = { key: lessonKey, frame: chosenFrame };
    }
  }, [layoutSettled, revealed, stepKey, compact, strip, shortViewport, lessonKey, chosenFrame]);
  // Fallbacks: past `REVEAL_MAX_MS` the hand and frame gates are waived
  // once the measurements agree (a deal that never settles must not hide
  // a lesson); after `REVEAL_HARD_MAX_MS` *and* `REVEAL_HARD_MAX_FRAMES`
  // rendered frames the card shows regardless. Frames as well as
  // wall-clock: measurements arrive with frames, so a main thread
  // stalled for seconds (a software renderer compiling the dealt tiles'
  // programs) queues no frames and forces nothing out early — a timer
  // that expired during the stall did, and the card grew a line or two
  // the moment the measurements landed. Wall-clock as well as frames: at
  // 60 fps a dozen frames is 200 ms, well inside a deal.
  const [waived, setWaived] = useState('');
  useEffect(() => {
    if (revealed) return;
    const soft = setTimeout(() => setWaived(stepKey), REVEAL_MAX_MS);
    const startedAt = performance.now();
    let frames = 0;
    let raf = requestAnimationFrame(function tick() {
      frames += 1;
      if (frames >= REVEAL_HARD_MAX_FRAMES && performance.now() - startedAt >= REVEAL_HARD_MAX_MS) {
        setRevealedFor(stepKey);
        return;
      }
      raf = requestAnimationFrame(tick);
    });
    return () => {
      clearTimeout(soft);
      cancelAnimationFrame(raf);
    };
  }, [revealed, stepKey]);
  useLayoutEffect(() => {
    if (!revealed && waived === stepKey && measurementsSettled && pageSettled)
      setRevealedFor(stepKey);
  }, [revealed, waived, stepKey, measurementsSettled, pageSettled]);
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
    room,
    frame: chosenFrame,
    bodyMaxHeight,
    revealed,
    gate: {
      chromeKnown: strip ? stripChromeKnown : chromeKnown,
      bodyHeight,
      expectedBody,
      contentHeight,
      handAtRest,
      handRect: toHalo(handRect),
      frame,
      room,
      scans: chromeScans,
      handInPlace,
      settled: layoutSettled,
    },
  });
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
                ? { opacity: 1 }
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
          testID="tutorial-card"
          pointerEvents="auto"
          onLayout={(e) => {
            if (!strip) recordMeasure('card', e.nativeEvent.layout.height);
          }}
          style={[
            {
              width: '100%',
              backgroundColor: glassBg,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: GLASS_BORDER,
              padding: strip
                ? STRIP_PAD
                : compact
                  ? 12
                  : tight
                    ? TIGHT_CARD_PAD
                    : dense
                      ? DENSE_CARD_PAD
                      : 18,
              paddingHorizontal: strip ? 14 : undefined,
              gap: strip
                ? STRIP_GAP
                : compact
                  ? 6
                  : tight
                    ? TIGHT_CARD_GAP
                    : dense
                      ? DENSE_CARD_GAP
                      : 10,
              boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
              // A stretched strip covers the chrome beneath it whole; the
              // content sits centred in the extra height.
              height: strip ? placement.height : undefined,
              justifyContent: strip ? 'center' : undefined,
            },
            solid ? null : webOnly({ backdropFilter: `blur(${GLASS_BLUR_PX}px) saturate(140%)` }),
          ]}
        >
          {strip ? (
            <View
              ref={stripRef}
              style={{ gap: STRIP_GAP }}
              onLayout={(e) => recordMeasure('strip', e.nativeEvent.layout.height + STRIP_FRAME)}
            >
              <StripBody
                narrow={placement.width < NARROW_STRIP_MAX_WIDTH}
                lessonLabel={lessonLabel}
                ids={lesson.steps.map((st) => st.id)}
                index={stepIndex}
                title={step.caption.title}
                body={step.caption.body}
                bodyMaxHeight={bodyMaxHeight}
                onBodyLayout={(height) =>
                  setBodyMeasured((prev) =>
                    prev?.key === measureKey && prev.height === height
                      ? prev
                      : { key: measureKey, height },
                  )
                }
                onContentHeight={(height) =>
                  setContentMeasured((prev) =>
                    prev?.key === contentKey && prev.height === height
                      ? prev
                      : { key: contentKey, height },
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
            </View>
          ) : (
            <>
              {tight ? null : (
                <CardHeader
                  lessonLabel={lessonLabel}
                  ids={lesson.steps.map((st) => st.id)}
                  index={stepIndex}
                  compact={compact}
                  stacked={stackedHeader}
                  dots={!dense || placement.width >= STACKED_HEADER_MAX_WIDTH}
                />
              )}
              <Text
                accessibilityRole="header"
                accessibilityLabel={`Tutorial step: ${step.caption.title}`}
                style={{
                  fontSize: compact ? 15 : dense ? 18 : 20,
                  lineHeight: compact ? 19 : dense ? 22 : 26,
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
                onLayout={(height) =>
                  setBodyMeasured((prev) =>
                    prev?.key === measureKey && prev.height === height
                      ? prev
                      : { key: measureKey, height },
                  )
                }
                onContentHeight={(height) =>
                  setContentMeasured((prev) =>
                    prev?.key === contentKey && prev.height === height
                      ? prev
                      : { key: contentKey, height },
                  )
                }
              />
              <View
                style={{
                  flexDirection: compact ? 'column-reverse' : 'row',
                  justifyContent: 'space-between',
                  alignItems: compact ? 'stretch' : 'center',
                  gap: compact ? 0 : 10,
                  marginTop: compact || dense ? 0 : 2,
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
  /** Vertical room the card had for this placement (`Infinity` when
   *  bounded only by the safe insets); see `bodyCap.ts`. */
  room: number;
  frame: CardFrame;
  /** Body cap handed to `ScrollBody` (unsnapped). */
  bodyMaxHeight: number;
  /** The card has passed its reveal gate (web) and is visible. */
  revealed: boolean;
  /** Inputs of the reveal gate, for the specs' relayout probes. */
  gate: {
    chromeKnown: boolean;
    bodyHeight: number | null;
    expectedBody: number | null;
    contentHeight: number | null;
    handAtRest: boolean;
    handRect: HaloRect | null;
    frame: CardFrame;
    room: number;
    scans: number;
    handInPlace: boolean;
    settled: boolean;
  };
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

/** Body copy in the bottom strip: one size; as many lines as the band
 *  holds (`bodyCap`), never fewer than `MIN_SCROLL_LINES` plus the cue. */
const STRIP_LINE_HEIGHT = 18;
/** Vertical padding of the strip card, and the card frame around the
 *  strip's content block (padding + 1 px borders) — the content is what
 *  gets measured, so a stretched strip reports its natural height. */
const STRIP_PAD = 6;
const STRIP_FRAME = STRIP_PAD * 2 + 2;
/** Gap between the strip's header row and its body. With the padding
 *  this is what keeps the four-line dice caption whole in the 141 px
 *  band over the HUD on a 412×700 phone (44 px header row + 4 + 14 px
 *  frame + 72 px of text = 134 ≤ 141 − 4) and three lines plus the cue
 *  in the 132 px band on a 360×640 one (62 + 66 = 128 ≤ 132 − 4). */
const STRIP_GAP = 4;

/**
 * Scrolling body copy with an overflow cue. When the text is taller than
 * the cap, a small chevron in a gutter *below* the visible lines says
 * "more below" — web shows no scrollbar for an overlay ScrollView, so a
 * capped paragraph otherwise reads as truncated mid-sentence. The scroll
 * area gives up the gutter's height (rounded down to whole lines, so the
 * scroll edge still falls between lines) and the whole block stays inside
 * `maxHeight`; the cue fades once the user has scrolled to the end, and
 * the gutter stays so the card never changes height on scroll.
 */
function ScrollBody({
  text,
  maxHeight,
  fontSize,
  lineHeight,
  onLayout,
  onContentHeight,
}: {
  text: string;
  maxHeight: number;
  fontSize: number;
  lineHeight: number;
  onLayout?: (height: number) => void;
  /** Natural height of the text (the ScrollView's content). */
  onContentHeight?: (height: number) => void;
}) {
  const [contentH, setContentH] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  // Before the content is measured the cap is the limit; once known, a
  // text that fits shows whole (no gutter reserved) and one that does
  // not gets whole lines above the cue.
  const fit = contentH > 0 ? fitBody(contentH, maxHeight, lineHeight) : null;
  const overflow = fit?.overflow ?? false;
  const scrollMax = fit ? fit.height : maxHeight;
  return (
    <View
      testID="tutorial-body"
      style={{ flexGrow: 0, flexShrink: 1, minHeight: 0 }}
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.height)}
    >
      <ScrollView
        style={{ maxHeight: scrollMax, flexGrow: 0 }}
        showsVerticalScrollIndicator
        nestedScrollEnabled
        scrollEventThrottle={32}
        onContentSizeChange={(_w, h) => {
          setContentH(h);
          onContentHeight?.(h);
        }}
        onScroll={(e) => {
          const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
          setAtEnd(contentOffset.y + layoutMeasurement.height >= contentSize.height - 2);
        }}
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
      {overflow ? (
        <View
          testID="tutorial-body-more"
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            height: BODY_CUE_H,
            alignItems: 'center',
            justifyContent: 'flex-end',
            opacity: atEnd ? 0 : 1,
          }}
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
 * Bottom-strip layout (`placement.kind === 'strip'`). Landscape: one row
 * of title + lesson / step labels, then the body beside the buttons —
 * ~90 px tall, so it sits over the dimmed hand row under a wide modal
 * target instead of covering the modal. `narrow` (a portrait phone's
 * band between the hand rows and the footer, ~150 px): title and step
 * label stack beside the buttons, the body runs the full width beneath
 * — the landscape row would leave the body ~150 px wide there.
 */
function StripBody({
  narrow = false,
  lessonLabel,
  ids,
  index,
  title,
  body,
  bodyMaxHeight,
  onBodyLayout,
  onContentHeight,
  cta,
  skip,
  restart,
}: {
  narrow?: boolean;
  lessonLabel: string;
  ids: string[];
  index: number;
  title: string;
  body: string;
  bodyMaxHeight: number;
  onBodyLayout: (height: number) => void;
  onContentHeight: (height: number) => void;
  cta: ReactNode;
  skip: ReactNode;
  restart: ReactNode;
}) {
  const titleText = (
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
  );
  const stepLabel =
    ids.length > 1 ? (
      <Text
        testID="tutorial-step-label"
        numberOfLines={1}
        accessibilityLabel={`Step ${index + 1} of ${ids.length}`}
        style={[MICRO_LABEL, { color: TEXT_SECONDARY }]}
      >
        {`Step ${index + 1} of ${ids.length}`}
      </Text>
    ) : null;
  const buttons = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      {skip}
      {restart}
      {cta}
    </View>
  );
  const scrollBody = (
    <ScrollBody
      text={body}
      maxHeight={bodyMaxHeight}
      fontSize={13}
      lineHeight={STRIP_LINE_HEIGHT}
      onLayout={onBodyLayout}
      onContentHeight={onContentHeight}
    />
  );
  if (narrow) {
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
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            {titleText}
            {stepLabel}
          </View>
          {buttons}
        </View>
        {scrollBody}
      </>
    );
  }
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
        {titleText}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <Text numberOfLines={1} style={[MICRO_LABEL, { color: COLORS.gold }]}>
            {lessonLabel}
          </Text>
          {ids.length > 1 ? (
            <>
              <StepDots ids={ids} index={index} />
              {stepLabel}
            </>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1, minWidth: 0 }}>{scrollBody}</View>
        {buttons}
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
  dots = true,
}: {
  lessonLabel: string;
  ids: string[];
  index: number;
  compact: boolean;
  stacked: boolean;
  /** Show the step dots. A dense card narrower than the stacking width
   *  drops them: the labels alone fill one row, and the step label
   *  already carries the count — the row the dots took goes to the body. */
  dots?: boolean;
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
          {dots ? <StepDots ids={ids} index={index} /> : null}
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
          webOnly({ backdropFilter: `blur(${GLASS_BLUR_PX}px) saturate(140%)` }),
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
