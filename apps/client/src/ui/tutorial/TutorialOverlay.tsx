import { useRouter } from 'expo-router';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useTransport } from '../../net/transport-context';
import { useGame } from '../../state/game';
import { LESSONS, nextLesson, useActiveTutorialStep, useTutorial } from '../../state/tutorial';
import { COLORS } from '../colors';
import { type TargetRect, useTutorialTargetRect } from './TargetRegistry';
import { useTutorialController } from './useTutorialController';

/**
 * Full-screen tutorial overlay. Mounted under both `MobileShell` and
 * `DesktopShell` and gated on `useActiveTutorialStep()` — when no
 * lesson is active, it renders nothing.
 *
 * Layout pieces:
 *   - **Halo** — a 4px translucent gold ring around the target rect
 *     with `borderRadius: 12`. Provides the "this is what you're
 *     meant to interact with" affordance. The dimming around it is
 *     painted by a huge-spread `boxShadow` on the same View so the
 *     dimmed area's inner edge follows the rounded corners exactly.
 *     Without that, sharp cutout corners would leave undimmed
 *     "L"-fragments at the four halo corners.
 *   - **Scrim panels** — four transparent, absolutely-positioned
 *     rectangles surrounding the halo bounding rect. They absorb
 *     taps outside the highlighted region but contribute no pixels
 *     of their own — the halo's `boxShadow` does the actual
 *     painting. When no target is registered for the active step,
 *     these collapse to a single full-screen panel that *does* paint
 *     the scrim color (no halo means no rounded cutout to respect).
 *   - **Caption card** — title + body + Skip / Next buttons.
 *     Positioned below the target if there's room, above otherwise;
 *     centered when there's no target. Tap-to-pass-through, so the
 *     user can still hit the highlighted element.
 *
 * After the lesson's last step is advanced, the overlay flips to a
 * `<CompletionPrompt>` modal (drained by `useTutorial.justCompleted`)
 * that offers the next curriculum lesson, "continue playing", or
 * "back to lobby". See the component docstring below.
 */
export function TutorialOverlay() {
  // Drive the controller while the overlay is mounted. Mounting
  // happens at every shell render, but the controller's effect is
  // gated on `active`, so this is a no-op when no lesson is in flight.
  useTutorialController();

  const active = useActiveTutorialStep();
  const justCompleted = useTutorial((s) => s.justCompleted);
  const dismiss = useTutorial((s) => s.dismiss);
  const advance = useTutorial((s) => s.advance);
  const window = useWindowDimensions();
  const targetRect = useTutorialTargetRect(active?.step.targetId ?? null);

  // Post-completion prompt takes precedence — the active step is
  // already cleared by `advance()` when the lesson finished, and
  // we want the prompt mounted instead of the regular caption.
  if (!active && justCompleted) {
    return <CompletionPrompt lessonId={justCompleted} />;
  }
  if (!active) return null;
  const { step } = active;

  // Pad the highlight so the halo doesn't crowd the target's edges.
  const PAD = 8;
  const HALO_BORDER = 3;
  const SCRIM_COLOR = 'rgba(20,15,10,0.55)';

  // The target's rect is registered relative to the registry root,
  // which sits at the top of the activity content frame. On Android
  // Fabric in edge-to-edge mode the activity content frame extends
  // above the visible window (its `measureInWindow` y reads negative,
  // since the status bar overlays the top of the frame). The
  // `(target - root)` subtraction in `TutorialTarget` already cancels
  // that negative offset, so the rect's y here is already in the
  // overlay's coord space — no further safe-area correction needed.
  const halo = targetRect
    ? {
        left: Math.max(0, targetRect.x - PAD),
        top: Math.max(0, targetRect.y - PAD),
        width: targetRect.w + PAD * 2,
        height: targetRect.h + PAD * 2,
      }
    : null;

  // Caption placement: anchor to a screen edge rather than to the
  // halo. An earlier draft positioned the caption right below the
  // halo, which broke for the watch-the-discards step on mobile —
  // as the discard pool grows with each bot turn the halo expands
  // downward and the caption ends up overlapping (or being pushed
  // off-screen by) new tiles. Anchoring to a fixed edge keeps the
  // caption stable regardless of how the targeted element resizes.
  // Heuristic: only dock at the bottom when the halo sits clearly
  // in the *upper third* of the viewport (a wall-draw cue, header
  // pill, etc.). Anything in the middle or lower portion of the
  // screen — own hand, claim bar, shared-discards pool — gets the
  // caption pinned to the top, since those targets sit well below
  // the caption's natural top-edge position. The earlier
  // half-and-half threshold flipped the wrong way for halos that
  // started near the centre and grew downward (the discard pool),
  // briefly placing the caption over the hand. Without a target,
  // centre vertically.
  const CAPTION_HEIGHT = 160;
  const EDGE_GAP = 60;
  let captionTop: number;
  if (!halo) {
    captionTop = Math.max(40, window.height / 2 - CAPTION_HEIGHT / 2);
  } else {
    const haloCentre = halo.top + halo.height / 2;
    const haloInUpperThird = haloCentre < window.height / 3;
    captionTop = haloInUpperThird
      ? Math.max(EDGE_GAP, window.height - EDGE_GAP - CAPTION_HEIGHT)
      : EDGE_GAP;
  }

  // Cancel-the-cutout: four rectangles around the halo painted with
  // `SCRIM_COLOR`. When no target exists, render a single full-screen
  // scrim instead. Each panel carries a stable `key` so React doesn't
  // churn the four edges' identity when the halo position shifts.
  //
  // Earlier this code kept the four panels transparent and relied on
  // a 9999-px-spread `boxShadow` on the halo View to paint the entire
  // dim region (so the cutout naturally followed the halo's
  // `borderRadius`). Android's renderer caps `boxShadow` spread well
  // short of 9999 — on at least Pixel-class API 36 it stops within a
  // few hundred px of the halo edge — so anything farther than that
  // (typically the screen area below the halo) ended up undimmed.
  // Painting the panels directly is reliable across platforms; the
  // only cost is four tiny L-shapes (≈31 sq-px each at borderRadius=12)
  // between the halo's curved border and its rectangular bound that
  // stay undimmed. The halo's own `borderColor` already draws a
  // visible gold ring through those L-shapes, so the gap reads as
  // part of the highlight rather than a rendering bug.
  // Panels are anchored to the overlay's bounds via `right: 0` /
  // `bottom: 0` rather than sized with `useWindowDimensions()`.
  // `window.height` returns the visible window minus the
  // safe-area-bottom inset on Android edge-to-edge — ~268 px short of
  // the physical screen — which used to leave the strip behind the
  // system nav bar undimmed. The overlay wrapper below spans the
  // entire app root (it inherits the registry root's `flex: 1`), so
  // anchoring panels to its edges covers the full screen reliably.
  const scrimPanels: ReadonlyArray<Panel & { key: string }> = halo
    ? scrimAround(halo)
    : [{ key: 'full', left: 0, top: 0, right: 0, bottom: 0 }];

  return (
    // Plain absolute-positioned overlay rather than `RNModal`:
    // react-native-web's `Modal` wraps children in a focus-trap
    // backdrop that absorbs every click that isn't on a Pressable
    // child, which would defeat the whole point of letting the user
    // tap the highlighted element. We get the same z-stacking via a
    // top-level mount in `app/_layout.tsx` (the overlay sits after
    // every other root-level child).
    <View
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        // Stack above any sibling we don't statically know about.
        // Web maps `elevation` to z-index; the scrim's specific
        // panels rely on their absolute position instead.
        zIndex: 1000,
      }}
      // `box-none` so the wrapper itself never absorbs touches; only
      // the scrim panels (which want to block) and the caption card
      // (which wants to handle taps) do.
      pointerEvents="box-none"
    >
      {scrimPanels.map((panel) => (
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
            backgroundColor: SCRIM_COLOR,
          }}
        />
      ))}
      {halo ? (
        <View
          style={{
            position: 'absolute',
            left: halo.left,
            top: halo.top,
            width: halo.width,
            height: halo.height,
            borderWidth: HALO_BORDER,
            borderColor: COLORS.gold,
            borderRadius: 12,
          }}
          pointerEvents="none"
        />
      ) : null}
      <View
        style={{
          position: 'absolute',
          left: 20,
          right: 20,
          top: captionTop,
          alignItems: 'center',
        }}
        pointerEvents="box-none"
      >
        <View
          // Tap-eater so taps on the card don't fall through to the
          // scrim and pass to whatever sits underneath.
          pointerEvents="auto"
          style={{
            maxWidth: 460,
            width: '100%',
            backgroundColor: COLORS.paperHi,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.hairline,
            padding: 18,
            gap: 10,
            boxShadow: '0px 8px 24px rgba(0,0,0,0.18)',
          }}
        >
          <Text
            accessibilityRole="header"
            accessibilityLabel={`Tutorial step: ${step.caption.title}`}
            style={{
              fontSize: 16,
              fontWeight: '900',
              color: COLORS.ink,
            }}
          >
            {step.caption.title}
          </Text>
          <Text style={{ fontSize: 13, color: COLORS.ink2, lineHeight: 19 }}>
            {step.caption.body}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 4,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip lesson"
              onPress={dismiss}
              style={({ pressed }) => ({
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: pressed ? COLORS.creamLow : 'transparent',
              })}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.ink3 }}>
                Skip lesson
              </Text>
            </Pressable>
            {step.completedWhen ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={step.ctaLabel ?? 'Got it'}
                onPress={advance}
                style={({ pressed }) => ({
                  paddingHorizontal: 16,
                  paddingVertical: 9,
                  borderRadius: 9,
                  backgroundColor: pressed ? COLORS.creamPressed : COLORS.accentSalmonSwatch,
                  borderWidth: 1,
                  borderColor: COLORS.accentSalmonEdge,
                })}
              >
                <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.red }}>
                  {step.ctaLabel ?? 'Got it'}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </View>
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

interface HaloRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Compute the four scrim rectangles surrounding a halo cut-out. Each
 *  rectangle is anchored to the overlay edge it shares with the halo
 *  (e.g. the top strip uses `top: 0 / right: 0 / left: 0` and a
 *  computed `height`), so the panels reliably fill the overlay
 *  parent's actual bounds — `useWindowDimensions()` excludes the
 *  Android nav-bar inset, so width/height-based sizing left a strip
 *  behind the nav bar undimmed. The halo region itself is left
 *  uncovered; the rest is painted with SCRIM_COLOR by the caller. */
function scrimAround(halo: HaloRect): Array<Panel & { key: string }> {
  return [
    // Top strip — full width, from y=0 to halo.top
    { key: 'top', left: 0, top: 0, right: 0, height: halo.top },
    // Bottom strip — from halo bottom to overlay bottom
    {
      key: 'bottom',
      left: 0,
      top: halo.top + halo.height,
      right: 0,
      bottom: 0,
    },
    // Left strip — from x=0 to halo.left, between halo top + bottom
    {
      key: 'left',
      left: 0,
      top: halo.top,
      width: halo.left,
      height: halo.height,
    },
    // Right strip — from halo right edge to overlay right edge
    {
      key: 'right',
      left: halo.left + halo.width,
      top: halo.top,
      right: 0,
      height: halo.height,
    },
  ];
}

/**
 * Centered modal-style card shown after the last step of a user-
 * facing lesson finishes. Offers three follow-ups:
 *   - "Next lesson: <title>" (only when another lesson is still
 *     unfinished in `LESSON_ORDER`) starts the next curriculum
 *     entry via `transport.joinSoloTutorial`. The active match is
 *     replaced by a fresh tutorial seed, same as launching from the
 *     lobby card.
 *   - "Continue playing" tears the prompt down and leaves the user
 *     in the just-finished tutorial's match — the engine's still
 *     mid-hand with passive bots, fine to keep poking around.
 *   - "Back to lobby" leaves the match and routes to `/`. Matches
 *     the in-match `Leave` flow.
 *
 * Lives outside `useActiveTutorialStep`'s gate because the active
 * step is already cleared by `advance()` when the lesson finishes —
 * the overlay's primary `if (!active)` short-circuit forwards to
 * this prompt instead of returning null when `justCompleted` is set.
 */
function CompletionPrompt({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const transport = useTransport();
  const dismissCompletion = useTutorial((s) => s.dismissCompletion);
  const tutorialsCompleted = useGame((s) => s.settings.tutorialsCompleted);
  const window = useWindowDimensions();

  // `LESSONS` always has the entry — `advance()` only flips
  // `justCompleted` after the lesson it actually ran resolved, and
  // lessons aren't deleted at runtime. Fall back gracefully just in
  // case (skips the title interpolation rather than crashing).
  const lesson = LESSONS[lessonId];
  // Pick the next incomplete lesson after the freshly-finished one.
  // `nextLesson()` walks LESSON_ORDER and returns the first entry
  // not in `tutorialsCompleted` — by the time we render this prompt
  // `tutorialsCompleted` already includes `lessonId`, so the next
  // call returns the *following* curriculum entry (or null when the
  // user just finished the last one).
  const next = nextLesson(tutorialsCompleted);

  const SCRIM_COLOR = 'rgba(20,15,10,0.55)';
  const CARD_MAX_WIDTH = 460;

  const onContinue = () => {
    dismissCompletion();
  };
  const onNextLesson = () => {
    if (!next) return;
    // `joinSoloTutorial` calls `useTutorial.begin(nextId)` which
    // resets `justCompleted: null` on its own — no need to
    // dismissCompletion() first.
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
        backgroundColor: SCRIM_COLOR,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      // The prompt is modal — every tap outside the card should
      // hit the scrim (no pass-through). Default `pointerEvents` on
      // the wrapper does exactly that since the scrim covers the
      // whole screen.
    >
      <View
        style={{
          width: Math.min(CARD_MAX_WIDTH, window.width - 40),
          backgroundColor: COLORS.paperHi,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: COLORS.hairline,
          padding: 20,
          gap: 14,
          boxShadow: '0px 12px 32px rgba(0,0,0,0.22)',
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ fontSize: 17, fontWeight: '900', color: COLORS.ink }}
        >
          Nice work!
        </Text>
        <Text style={{ fontSize: 13, color: COLORS.ink2, lineHeight: 19 }}>
          {next
            ? `You finished "${lesson?.title ?? 'the lesson'}". Want to keep going with the next lesson, or keep playing this hand?`
            : `That's every lesson done. Keep playing this hand, or head back to the lobby for a real match.`}
        </Text>
        <View style={{ gap: 8 }}>
          {next ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Start next lesson: ${next.title}`}
              onPress={onNextLesson}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 11,
                borderRadius: 9,
                backgroundColor: pressed ? COLORS.creamPressed : COLORS.accentSalmonSwatch,
                borderWidth: 1,
                borderColor: COLORS.accentSalmonEdge,
                alignItems: 'center',
              })}
            >
              <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.red }}>
                Next lesson: {next.title}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue playing"
            onPress={onContinue}
            style={({ pressed }) => ({
              paddingHorizontal: 16,
              paddingVertical: 11,
              borderRadius: 9,
              backgroundColor: pressed ? COLORS.creamLow : COLORS.cream,
              borderWidth: 1,
              borderColor: COLORS.hairline,
              alignItems: 'center',
            })}
          >
            <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.ink }}>
              Continue playing
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to lobby"
            onPress={onLeaveToLobby}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 9,
              borderRadius: 8,
              backgroundColor: pressed ? COLORS.creamLow : 'transparent',
              alignItems: 'center',
            })}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.ink3 }}>
              Back to lobby
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// Re-export the rect type for components that want to type their
// `<TutorialTarget>` measurements without reaching into TargetRegistry.
export type { TargetRect };
