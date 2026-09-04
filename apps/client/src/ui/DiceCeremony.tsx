import type { OpeningRolls, Seat } from '@mahjong/game-logic';
import { SEATS } from '@mahjong/game-logic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nameForSeat, useGame } from '../state/game';
import { LESSONS, useActiveTutorialStep, useTutorial } from '../state/tutorial';
import { portraitHeldHandTop, portraitStripBottom } from '../three/entry';
import { resolveRenderer } from '../three/renderer';
import { useFadeInOut } from './animations';
import { COLORS } from './colors';
import { webStyle } from './menu/theme';
import { DISMISS_MS } from './timing';
import { useTargetRegistry } from './tutorial/TargetRegistry';
import { SEAT_WIND_GLYPH } from './winds';

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

/**
 * Over the Three.js table the ceremony wears the HUD's glass language
 * (dark glass + gold hairline, uppercase micro-label, ivory chunky dice
 * with the traditional red 1 / 4 pips, gold totals). The classic shells
 * keep the cream paper card. Picked per render from `resolveRenderer`,
 * the same switch `Match.tsx` uses to mount the shell.
 */
const GLASS_DICE = {
  scrim: 'rgba(6,10,8,0.56)',
  bg: 'rgba(14,20,17,0.84)',
  border: 'rgba(216,168,90,0.45)',
  text: 'rgba(255,255,255,0.92)',
  text2: 'rgba(255,255,255,0.62)',
  gold: '#d8a85a',
  ivory: '#f4ecd8',
  ivorySide: '#c8b78f',
  pipInk: '#2a2418',
  pipRed: '#b14d3a',
  shadow: '0px 12px 40px rgba(0,0,0,0.35)',
  font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const;

// Persist the most recently dismissed `state.seed` so a page reload
// (in solo, online, or LAN) honours the user's dismissal instead of
// re-popping the overlay. New hands generate fresh seeds via
// `randomSeed()`, so a different seed on the next match still
// triggers the ceremony — only the exact seed the user dismissed is
// suppressed.
const DISMISSED_STORAGE_KEY = 'mj.dismissedDiceSeed.v1';

/** Tags the fading-out panel for the tutorial chrome scan (`IGNORE_ATTR`). */
const IGNORE_PROPS: Record<string, unknown> = { dataSet: { tutorialIgnore: '1' } };

declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_HOLD_DICE__: boolean | undefined;
}

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
  const rendererSetting = useGame((s) => s.settings.renderer);
  const glass = resolveRenderer(rendererSetting) === '3d';
  // Glass layout variants. Wide (landscape phone, desktop): the four
  // seats sit in one row so the panel never wraps into a 2×2 block that
  // would cover the chrome; short (landscape phone): a compact card —
  // 40 px dice with the total inline beside the pair, one-line names, the
  // dealer line and dismiss hint on one row — ≤ 150 px tall, so it sits
  // centred in the 412 px viewport clear of both the 46 px chrome row
  // and the hand row's tops (~300 px). Round-3: the 220 px card cut
  // across the top of every hand tile.
  const { width: vw, height: vh } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = glass && vw >= 700;
  const short = glass && vh < 600;
  const dieSize = short ? 40 : 48;
  // Phone portrait over the 3D table: the held hand sits high (its top
  // ~ 590 px on a 915 px phone, above the action tray) and the seat strip
  // ends ~ 98 px down, so the card is centred in the band between them
  // instead of the whole viewport — it never covers the tiles, and its
  // top edge clears the strip (round-4: the table moved up under the
  // strip and the centred card's top edge met the badges).
  const handTop = glass && !short && portraitHeldHandTop ? portraitHeldHandTop(vw, vh) : null;
  const stripBottom = glass && !short && portraitStripBottom ? portraitStripBottom(vw, vh) : null;
  const scrimPadBottom = handTop !== null ? Math.max(20, vh - handTop + 12) : 20;
  const scrimPadTop = stripBottom !== null ? Math.max(20, stripBottom + insets.top + 8) : 20;
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
  // Tutorial-scoped dismissal. Tutorials run on fixed seeds and don't
  // write to `localStorage`-backed `dismissedSeed` (a pin there would
  // bleed into unrelated non-tutorial matches with the same RNG roll).
  // Instead, the tutorial store carries a `dismissedTutorialSeed`
  // pin that:
  //   - is set when the user dismisses the modal during a lesson
  //     (so the modal stays closed for the rest of that lesson AND
  //      across the lesson-end → completion-prompt → leave dance,
  //      where `tutorialLessonId` has already gone null but the same
  //      seed would otherwise re-pop the modal on the empty board);
  //   - is cleared synchronously by `begin()` (so a replay re-pops
  //     the modal — the clear has to land before any DiceCeremony
  //     render to beat the open predicate, which is why this lives
  //     in the zustand store and not in component state cleared by
  //     a useEffect).
  const dismissedTutorialSeed = useTutorial((s) => s.dismissedTutorialSeed);
  const setDismissedTutorialSeed = useTutorial((s) => s.setDismissedTutorialSeed);
  const open =
    !!rolls &&
    seed !== undefined &&
    tutorialAllowsDice &&
    seed !== dismissedSeed &&
    seed !== dismissedTutorialSeed;
  // `useFadeInOut` honours `useGame.settings.animations` — when the
  // user has reduced-motion on the overlay snaps in / out instead of
  // fading. The dismiss timer is unchanged so on-screen duration is
  // the same either way.
  const { fade, fadeOut } = useFadeInOut({ visible: open });
  // Seed whose dismissal is fading out: the panel is tagged so the
  // tutorial's chrome scan ignores it while it goes (see `IGNORE_ATTR`).
  const [dismissingSeed, setDismissingSeed] = useState<number | null>(null);

  // Fade out then commit the dismissal. In a tutorial session the
  // dismissal pins `dismissedTutorialSeed` in the tutorial store
  // (cleared synchronously on the next `begin()`); outside tutorials
  // it persists to localStorage so a reload (solo / online / LAN)
  // honours it. Shared between the auto-dismiss timer and the
  // tap-to-dismiss handler.
  const dismiss = useCallback(
    (s: number) => {
      setDismissingSeed(s);
      fadeOut(() => {
        if (tutorialLessonId) {
          setDismissedTutorialSeed(s);
        } else {
          setDismissedSeed(s);
          writeDismissedSeed(s);
        }
      });
    },
    [fadeOut, tutorialLessonId, setDismissedTutorialSeed],
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
    // Test seam: the screenshot verifier pins the modal open so the
    // opening-rolls state can be captured after the scene has settled.
    if (globalThis.__MAHJONG_TEST_HOLD_DICE__ === true) return;
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
  // Web: register the rect synchronously in the commit that mounts the
  // card, so the coach-mark's spotlight hole opens on the modal's first
  // paint. The `onLayout` path below runs through RNW's ResizeObserver +
  // `setTimeout`, which a CPU-starved page (software GL, a low-end
  // phone) can hold for hundreds of ms — the user sat behind a blank
  // full-screen dim meanwhile. Native has no DOM and keeps `onLayout`.
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const rootEl = registry.rootRef.current as unknown as {
      getBoundingClientRect?: () => { left: number; top: number };
    } | null;
    const el = cardRef.current as unknown as {
      getBoundingClientRect?: () => { left: number; top: number; width: number; height: number };
    } | null;
    if (!rootEl?.getBoundingClientRect || !el?.getBoundingClientRect) return;
    const r = rootEl.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    if (t.width <= 0 || t.height <= 0) return;
    registry.set('dice-ceremony', {
      x: t.left - r.left,
      y: t.top - r.top,
      w: t.width,
      h: t.height,
    });
  }, [registry, visible]);
  if (!visible) return null;
  const rolling = SEATS.filter((s) => rolls.dice[s]);
  const title = rolls.fullRoll ? 'Opening rolls' : 'Dealer rolls';
  const dealerName = nameForSeat(lobby, dealer as Seat);

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
      testID="dice-ceremony"
      // `dataSet` is a react-native-web extension (renders `data-*`),
      // absent from Pressable's cross-platform prop types.
      {...(dismissingSeed === seed ? IGNORE_PROPS : null)}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: glass ? GLASS_DICE.scrim : 'rgba(40, 30, 20, 0.5)',
        // Matches the `Modal` primitive's gutter so the dialog never
        // sits edge-to-edge on a portrait phone (a 320px iPhone SE
        // would otherwise clip the rounded corners).
        padding: 20,
        paddingTop: scrimPadTop,
        paddingBottom: scrimPadBottom,
        zIndex: 100,
      }}
    >
      <Animated.View
        ref={(node) => {
          cardRef.current = node as unknown as typeof cardRef.current;
        }}
        onLayout={() => {
          // Match `TutorialTarget`'s storage convention: measure both
          // the card and the registry root in window coords and store
          // the offset between them. The subtraction cancels the
          // negative root y Android Fabric reports for the activity
          // content frame under edge-to-edge, so the overlay paints
          // halos in a single consistent coord space.
          const rootNode = registry.rootRef.current as unknown as {
            measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void;
          } | null;
          if (!rootNode) return;
          rootNode.measureInWindow((rootX, rootY) => {
            cardRef.current?.measureInWindow((x, y, w, h) => {
              registry.set('dice-ceremony', {
                x: x - rootX,
                y: y - rootY,
                w,
                h,
              });
            });
          });
        }}
        testID={glass ? 'dice-ceremony-glass' : 'dice-ceremony-paper'}
        style={
          glass
            ? {
                opacity: fade,
                backgroundColor: GLASS_DICE.bg,
                borderColor: GLASS_DICE.border,
                borderWidth: 1,
                padding: short ? 12 : 22,
                paddingTop: short ? 10 : 18,
                borderRadius: short ? 16 : 20,
                alignItems: 'center',
                width: '100%',
                // Four 126 px columns + gaps + padding on wide viewports;
                // 2×2 on portrait phones.
                maxWidth: wide ? (short ? 600 : 620) : 400,
                boxShadow: GLASS_DICE.shadow,
                ...webStyle({
                  backdropFilter: 'blur(16px) saturate(140%)',
                  WebkitBackdropFilter: 'blur(16px) saturate(140%)',
                }),
              }
            : {
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
              }
        }
      >
        {glass ? (
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: GLASS_DICE.text2,
              fontFamily: GLASS_DICE.font,
              marginBottom: short ? 8 : 16,
            }}
          >
            {title}
          </Text>
        ) : (
          <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.ink, marginBottom: 16 }}>
            {title}
          </Text>
        )}
        <View
          style={{
            flexDirection: 'row',
            gap: glass ? (short ? 12 : 22) : 24,
            justifyContent: 'center',
            flexWrap: wide ? 'nowrap' : 'wrap',
          }}
        >
          {rolling.map((seat) => {
            const pair = rolls.dice[seat];
            if (!pair) return null;
            const isDealer = seat === dealer;
            return (
              <View
                key={seat}
                testID={glass ? 'dice-seat' : undefined}
                style={{
                  alignItems: 'center',
                  gap: glass ? (short ? 4 : 8) : 6,
                  // Fixed columns keep the dice rows aligned when one
                  // name wraps to two lines (compact: one line + the
                  // inline total needs the extra width).
                  width: glass ? (short ? 132 : wide ? 126 : 118) : undefined,
                }}
              >
                {glass ? (
                  <View
                    style={{
                      minHeight: short ? 14 : 28,
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      alignSelf: 'stretch',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        letterSpacing: 0.4,
                        lineHeight: 14,
                        textAlign: 'center',
                        color: isDealer ? GLASS_DICE.gold : GLASS_DICE.text2,
                        fontFamily: GLASS_DICE.font,
                      }}
                      numberOfLines={short ? 1 : 2}
                    >
                      {`${SEAT_WIND_GLYPH[seat]} ${nameForSeat(lobby, seat as Seat)}`}
                    </Text>
                  </View>
                ) : (
                  <Text
                    style={{ fontSize: 11, fontWeight: '700', color: COLORS.ink3 }}
                    numberOfLines={1}
                  >
                    {nameForSeat(lobby, seat as Seat)}
                  </Text>
                )}
                <View style={{ flexDirection: 'row', gap: glass ? 8 : 6, alignItems: 'center' }}>
                  <Die value={pair[0]} delay={0} glass={glass} size={dieSize} />
                  <Die value={pair[1]} delay={120} glass={glass} size={dieSize} />
                  {short ? (
                    // Compact: the total sits beside the pair instead of
                    // under it, saving a text row.
                    <Text
                      style={{
                        fontSize: 17,
                        fontWeight: '800',
                        color: GLASS_DICE.gold,
                        fontFamily: GLASS_DICE.font,
                        letterSpacing: 0.5,
                        marginLeft: 2,
                        minWidth: 22,
                        textAlign: 'center',
                      }}
                    >
                      {pair[0] + pair[1]}
                    </Text>
                  ) : null}
                </View>
                {short ? null : (
                  <Text
                    style={
                      glass
                        ? {
                            fontSize: 18,
                            fontWeight: '800',
                            color: GLASS_DICE.gold,
                            fontFamily: GLASS_DICE.font,
                            letterSpacing: 0.5,
                          }
                        : { fontSize: 12, fontWeight: '800', color: COLORS.ink }
                    }
                  >
                    {pair[0] + pair[1]}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
        {glass ? (
          // Short (landscape phone): the dealer line and the dismiss hint
          // share one row, so the panel ends ~20 px sooner and the
          // tutorial's bottom strip (`placement.kind === 'strip'`) sits
          // clear of it below the hand row instead of over its footer.
          <View
            style={{
              marginTop: short ? 8 : 18,
              paddingTop: short ? 6 : 12,
              borderTopWidth: 1,
              borderTopColor: 'rgba(255,255,255,0.12)',
              alignSelf: 'stretch',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: short ? 'row' : 'column',
              // Wrap only in the row layout: a wrapping column packs its
              // single line at the start and left-aligns the two lines.
              flexWrap: short ? 'wrap' : 'nowrap',
              columnGap: 10,
              rowGap: short ? 4 : 6,
            }}
          >
            <Text style={{ fontSize: 13, color: GLASS_DICE.text, fontFamily: GLASS_DICE.font }}>
              Dealer{' '}
              <Text style={{ color: GLASS_DICE.gold, fontWeight: '800' }}>
                {SEAT_WIND_GLYPH[dealer as Seat]} {dealerName}
              </Text>
            </Text>
            {short ? (
              <Text
                style={{ fontSize: 11, lineHeight: 16, color: GLASS_DICE.text2 }}
                accessible={false}
              >
                ·
              </Text>
            ) : null}
            <Text
              style={{
                fontSize: 11,
                lineHeight: short ? 16 : undefined,
                color: GLASS_DICE.text2,
                fontFamily: GLASS_DICE.font,
              }}
            >
              Tap anywhere to dismiss
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ marginTop: 18, fontSize: 13, color: COLORS.ink }}>
              Dealer: seat <Text style={{ color: COLORS.red, fontWeight: '700' }}>{dealer}</Text> (
              {dealerName})
            </Text>
            <Text style={{ marginTop: 6, fontSize: 11, color: COLORS.ink3 }}>
              Tap anywhere to dismiss
            </Text>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

function Die({
  value,
  delay,
  glass = false,
  size: sizeOverride,
}: {
  value: number;
  delay: number;
  glass?: boolean;
  /** Glass only: die edge in px (48 default; short viewports pass 40). */
  size?: number | undefined;
}) {
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
  // Traditional mahjong dice: the 1 and the 4 are red, the rest ink.
  const pipColor = glass
    ? value === 1 || value === 4
      ? GLASS_DICE.pipRed
      : GLASS_DICE.pipInk
    : COLORS.red;
  const size = glass ? (sizeOverride ?? 48) : 44;
  const pips = Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3) + 1;
    const col = (i % 3) + 1;
    const filled = (PIPS[value] ?? []).some(([r, c]) => r === row && c === col);
    const big = glass && value === 1;
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
              width: big ? 11 : glass ? 8 : 7,
              height: big ? 11 : glass ? 8 : 7,
              borderRadius: 6,
              backgroundColor: pipColor,
              ...(glass ? { boxShadow: 'inset 0px 1px 1px rgba(0,0,0,0.35)' } : {}),
            }}
          />
        ) : null}
      </View>
    );
  });
  if (!glass) {
    return (
      <Animated.View
        style={{
          width: size,
          height: size,
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
        {pips}
      </Animated.View>
    );
  }
  // Glass: a chunky ivory die — a darker side slab peeks out under the
  // lit top face (inset highlight along the top edge, shade along the
  // bottom) so it reads as a shaded block, not a flat card.
  return (
    <Animated.View
      style={{
        width: size,
        height: size + 5,
        opacity: t,
        transform: [{ scale }, { rotate }],
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 5,
          bottom: 0,
          borderRadius: 10,
          backgroundColor: GLASS_DICE.ivorySide,
          boxShadow: '0px 8px 18px rgba(0,0,0,0.5)',
        }}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: 10,
          backgroundColor: GLASS_DICE.ivory,
          padding: 6,
          flexDirection: 'row',
          flexWrap: 'wrap',
          boxShadow:
            'inset 0px 2px 0px rgba(255,255,255,0.75), inset 0px -3px 0px rgba(120,100,60,0.22), 0px 1px 0px rgba(0,0,0,0.25)',
          ...webStyle({
            backgroundImage: 'linear-gradient(160deg, #fbf5e7 0%, #efe4c9 100%)',
          }),
        }}
      >
        {pips}
      </View>
    </Animated.View>
  );
}
