import type { OpeningRolls, Seat } from '@mahjong/game-logic';
import { SEATS } from '@mahjong/game-logic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { nameForSeat, useGame } from '../state/game';
import { LESSONS, useActiveTutorialStep, useTutorial } from '../state/tutorial';
import { useFadeInOut } from './animations';
import { COLORS } from './colors';
import { DISMISS_MS } from './timing';
import { useTargetRegistry } from './tutorial/TargetRegistry';

const PIPS: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [
    [1, 1],
    [3, 3],
  ],
  3: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  4: [
    [1, 1],
    [1, 3],
    [3, 1],
    [3, 3],
  ],
  5: [
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 1],
    [3, 3],
  ],
  6: [
    [1, 1],
    [1, 3],
    [2, 1],
    [2, 3],
    [3, 1],
    [3, 3],
  ],
};

// Persist the most recently dismissed `state.seed` so a page reload
// (in solo, online, or LAN) honours the user's dismissal instead of
// re-popping the overlay. New hands generate fresh seeds via
// `randomSeed()`, so a different seed on the next match still
// triggers the ceremony — only the exact seed the user dismissed is
// suppressed.
const DISMISSED_STORAGE_KEY = 'mj.dismissedDiceSeed.v1';

function readDismissedSeed(): number | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeDismissedSeed(seed: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, String(seed));
  } catch {
    /* storage full / disabled — silent skip; worst case the overlay
       reappears on the next reload. */
  }
}

/**
 * Opening-rolls overlay. Triggered by a fresh
 * `state.openingRolls`. Auto-dismisses after `DISMISS_MS`; tap anywhere
 * on the backdrop to dismiss early. Animations are RN core `Animated`
 * (no reanimated) so it works in Expo Go.
 */
export function DiceCeremony() {
  const seed = useGame((s) => s.state?.seed);
  const rolls = useGame((s) => s.state?.openingRolls);
  const dealer = useGame((s) => s.state?.dealer);
  const lobby = useGame((s) => s.lobby);
  // Key dismissal by `state.seed` rather than a boolean — JSON.parse
  // on every server delta produces a fresh `openingRolls` reference,
  // so a bare `dismissed` boolean reset by `useEffect([rolls])` would
  // retrigger the ceremony on every action. Lazy-init from
  // localStorage so reloads (solo / online / LAN) honour the
  // previous dismissal.
  const [dismissedSeed, setDismissedSeed] = useState<number | null>(() => readDismissedSeed());
  // Suppress the ceremony for any tutorial that doesn't opt into
  // it via `lesson.showOpeningRolls`. Most lessons render a
  // welcome caption immediately on entry; without this gate the
  // dice modal would stack underneath the caption and read as
  // visual noise. The basics lesson opts in (it introduces the
  // dice as part of the core flow), the rest don't.
  const tutorialActive = useTutorial((s) => s.active);
  const tutorialLessonId = tutorialActive?.lessonId ?? null;
  const tutorialAllowsDice =
    !tutorialActive || (LESSONS[tutorialActive.lessonId]?.showOpeningRolls ?? false);
  // Per-tutorial-session dismissal. Tutorials run on fixed seeds, so
  // the localStorage `dismissedSeed` memo would suppress the dice
  // modal forever after the first run. Track dismissal by the
  // currently-active lesson id instead: dismiss → store the lesson
  // id; replay → a `null → lessonId` transition (handled below) clears
  // the stored id, so the modal shows again. Outside tutorials this
  // value stays null and the localStorage gate alone applies.
  const [tutorialDismissedFor, setTutorialDismissedFor] = useState<string | null>(null);
  // Reset per-session state when a tutorial begins (incl. replays).
  // Without this, `tutorialDismissedFor` from a prior run would carry
  // into a replay of the same lesson and silently suppress the modal;
  // and the in-memory `dismissedSeed` pinned by the tutorial dismissal
  // (see `dismiss` below) would stay set across sessions.
  //
  // Done at render time via the tracked-prev-state pattern (React's
  // "Adjusting state based on props" idiom) rather than in a
  // `useEffect`. An effect runs *after* commit, so on the first
  // render following `begin(lessonId)` the `open` predicate below
  // would still see the stale dismissal values and the modal would
  // never appear — the previous run's pinned `dismissedSeed === 5`
  // matched the lesson's fixed seed and gated `open` to false.
  // Setting state during render triggers an immediate re-render
  // with the cleared values; the equality check above the setters
  // keeps it from looping.
  const [prevLessonId, setPrevLessonId] = useState<string | null>(null);
  if (tutorialLessonId !== prevLessonId) {
    setPrevLessonId(tutorialLessonId);
    if (tutorialLessonId !== null) {
      setTutorialDismissedFor(null);
      setDismissedSeed(readDismissedSeed());
    }
  }
  const open =
    !!rolls &&
    seed !== undefined &&
    tutorialAllowsDice &&
    seed !== dismissedSeed &&
    (!tutorialLessonId || tutorialDismissedFor !== tutorialLessonId);
  // `useFadeInOut` honours `useGame.settings.animations` — when the
  // user has reduced-motion on the overlay snaps in / out instead of
  // fading. The dismiss timer is unchanged so on-screen duration is
  // the same either way.
  const { fade, fadeOut } = useFadeInOut({ visible: open });

  // Fade out then commit the dismissal. In a tutorial session the
  // dismissal is keyed by lesson id (cleared on the next replay);
  // outside tutorials it persists to localStorage so a reload
  // (solo / online / LAN) honours it. Shared between the
  // auto-dismiss timer and the tap-to-dismiss handler.
  const dismiss = useCallback(
    (s: number) => {
      fadeOut(() => {
        if (tutorialLessonId) {
          setTutorialDismissedFor(tutorialLessonId);
          // Also pin the seed in-memory so the modal stays closed
          // once the tutorial ends and the lesson-id gate stops
          // applying — without this, finishing the basics lesson
          // reopened the dice modal. Skip the localStorage write:
          // tutorials use fixed seeds and persisting them would
          // bleed into unrelated non-tutorial matches.
          setDismissedSeed(s);
        } else {
          setDismissedSeed(s);
          writeDismissedSeed(s);
        }
      });
    },
    [fadeOut, tutorialLessonId],
  );

  // While a lesson step targets the dice ceremony, suspend the
  // auto-dismiss timer — the user is reading the tutorial caption
  // alongside the dice and shouldn't have the modal vanish out from
  // under them on the usual short timeout. Once the step advances
  // past the dice (`dice-ceremony` is no longer the active target)
  // we retire the modal so it doesn't stack with the next caption.
  const activeStep = useActiveTutorialStep();
  const tutorialTargetsDice = activeStep?.step.targetId === 'dice-ceremony';
  useEffect(() => {
    if (!open || seed === undefined || tutorialTargetsDice) return;
    const timer = setTimeout(() => dismiss(seed), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [open, seed, dismiss, tutorialTargetsDice]);
  // Auto-retire the modal when a tutorial that surfaced it advances
  // past the dice step. Without this the dice card would linger
  // under the welcome caption on the next step.
  const wasTargetingRef = useRef(tutorialTargetsDice);
  useEffect(() => {
    if (wasTargetingRef.current && !tutorialTargetsDice && open && seed !== undefined) {
      dismiss(seed);
    }
    wasTargetingRef.current = tutorialTargetsDice;
  }, [tutorialTargetsDice, open, seed, dismiss]);

  // Register the dice card's screen rect with the tutorial target
  // registry so the basics dice step can halo it. Refreshed on
  // every layout pass — the modal animates in via `useFadeInOut`,
  // so the rect lands once the card mounts and stays stable until
  // dismiss.
  const registry = useTargetRegistry();
  const cardRef = useRef<{
    measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void;
  } | null>(null);
  useEffect(() => {
    return () => {
      registry.set('dice-ceremony', null);
    };
  }, [registry]);

  const visible = open && dealer !== undefined;
  if (!visible) return null;
  const rolling = SEATS.filter((s) => rolls.dice[s]);

  return (
    <Pressable
      onPress={() => {
        // While a tutorial step is highlighting the dice, the
        // overlay's scrim catches taps on the rest of the screen
        // and only the halo cutout reveals the dice card. A tap
        // there should advance the tutorial rather than dismiss
        // the modal out of sequence; ignore the press and let the
        // user drive the lesson via the caption's CTA instead.
        if (tutorialTargetsDice) return;
        dismiss(seed);
      }}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(40, 30, 20, 0.5)',
        // Matches the `Modal` primitive's gutter so the dialog never
        // sits edge-to-edge on a portrait phone (a 320px iPhone SE
        // would otherwise clip the rounded corners).
        padding: 20,
        zIndex: 100,
      }}
    >
      <Animated.View
        ref={(node) => {
          cardRef.current = node as unknown as typeof cardRef.current;
        }}
        onLayout={() => {
          cardRef.current?.measureInWindow((x, y, w, h) => {
            registry.set('dice-ceremony', { x, y, w, h });
          });
        }}
        style={{
          opacity: fade,
          backgroundColor: COLORS.paperHi,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          padding: 24,
          borderRadius: 16,
          alignItems: 'center',
          // Width cap so the dialog stays compact on tablets / desktop
          // without growing absurd.
          width: '100%',
          maxWidth: 420,
          boxShadow: '0px 24px 60px rgba(0,0,0,0.2)',
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.ink, marginBottom: 16 }}>
          {rolls.fullRoll ? 'Opening rolls' : 'Dealer rolls'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
          {rolling.map((seat) => {
            const pair = rolls.dice[seat];
            if (!pair) return null;
            return (
              <View key={seat} style={{ alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.ink3 }}>
                  {nameForSeat(lobby, seat as Seat)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Die value={pair[0]} delay={0} />
                  <Die value={pair[1]} delay={120} />
                </View>
                <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.ink }}>
                  {pair[0] + pair[1]}
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={{ marginTop: 18, fontSize: 13, color: COLORS.ink }}>
          Dealer: seat <Text style={{ color: COLORS.red, fontWeight: '700' }}>{dealer}</Text> (
          {nameForSeat(lobby, dealer as Seat)})
        </Text>
        <Text style={{ marginTop: 6, fontSize: 11, color: COLORS.ink3 }}>
          Tap anywhere to dismiss
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function Die({ value, delay }: { value: number; delay: number }) {
  const animsEnabled = useGame((s) => s.settings.animations);
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animsEnabled) {
      t.setValue(1);
      return;
    }
    Animated.sequence([
      Animated.delay(delay),
      Animated.spring(t, { toValue: 1, friction: 6, tension: 100, useNativeDriver: true }),
    ]).start();
  }, [delay, t, animsEnabled]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] });
  return (
    <Animated.View
      style={{
        width: 44,
        height: 44,
        backgroundColor: '#fdfaf2',
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        padding: 6,
        boxShadow: '0px 2px 6px rgba(0,0,0,0.18)',
        flexDirection: 'row',
        flexWrap: 'wrap',
        opacity: t,
        transform: [{ scale }, { rotate }],
      }}
    >
      {Array.from({ length: 9 }, (_, i) => {
        const row = Math.floor(i / 3) + 1;
        const col = (i % 3) + 1;
        const filled = (PIPS[value] ?? []).some(([r, c]) => r === row && c === col);
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: 3x3 grid is fixed
            key={i}
            style={{
              width: '33.33%',
              height: '33.33%',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {filled ? (
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: COLORS.red,
                }}
              />
            ) : null}
          </View>
        );
      })}
    </Animated.View>
  );
}
