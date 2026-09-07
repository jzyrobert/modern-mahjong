import { tileId } from '@mahjong/game-logic';
import { useEffect, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { nameForSeat, useGame } from '../state/game';
import { LESSONS, useTutorial } from '../state/tutorial';
import { resolveRenderer } from '../three/renderer';
import { PULSE_TEMPO, useFadeInOut, usePulse } from './animations';
import { COLORS } from './colors';
import { DISMISS_MS } from './timing';

/**
 * Celebratory overlay on `state.lastResult.kind === 'win'`.
 * Auto-dismisses after `DISMISS_MS` (or on tap). The 和 emblem
 * pulses + rocks subtly via the shared `usePulse` hook; the fade-in
 * / fade-out lifecycle goes through `useFadeInOut` which honours
 * `useGame.settings.animations` (snap when reduced-motion is on).
 *
 * Classic renderer only: under the Three.js renderer the celebration
 * is the gold 和 stamp that lands on the glass result card
 * (`three/table/hud/ResultVeil`), so this cream card would be a
 * second, older-looking popup over it.
 */
export function WinCelebration() {
  const rendererSetting = useGame((s) => s.settings.renderer);
  if (resolveRenderer(rendererSetting) === '3d') return null;
  return <ClassicWinCelebration />;
}

function ClassicWinCelebration() {
  const result = useGame((s) => s.state?.lastResult);
  const lobby = useGame((s) => s.lobby);
  const [dismissed, setDismissed] = useState(false);
  const isWin = !!result && result.kind === 'win';
  // The DISMISS_MS timer below keeps running while the tutorial
  // completion prompt is up, so by the time the prompt is dismissed
  // the celebration has fade-cleared itself.
  const tutorialJustCompleted = useTutorial((s) => s.justCompleted);
  // Mid-lesson suppression: strategy lessons (`scoring-intro`,
  // `yaku-gallery`) stage `phase: 'resolved'` + a synthetic
  // `lastResult` on every example step. Without this gate the
  // celebration would re-fire on each step (6–7 times per lesson),
  // drowning the lesson's own caption. Opt-in per lesson via
  // `Lesson.suppressWinCelebration` so gameplay lessons (`win`, `ron`,
  // `robbing-kong`) — whose final hand IS meant to surface the
  // celebration — stay unaffected. The complement to the
  // `justCompleted` guard above: that handles the post-completion
  // dismissal window; this handles every step of a celebration-
  // suppressing lesson up to (and including) the final "Done" tap.
  const activeLessonId = useTutorial((s) => s.active?.lessonId ?? null);
  const tutorialSuppresses = activeLessonId
    ? (LESSONS[activeLessonId]?.suppressWinCelebration ?? false)
    : false;
  const visibleForFade = isWin && !dismissed && !tutorialJustCompleted && !tutorialSuppresses;
  const { fade, fadeOut } = useFadeInOut({ visible: visibleForFade });

  // Content-derived key for the current result. Multiplayer hosts
  // can mutate session settings (faanMin, etc.) while a result is
  // still on screen between hands; each setRules broadcast hands
  // the client a fresh `state` object whose `lastResult` is content-
  // equal but reference-different. Keying the dismiss effect on
  // `result` directly re-fired on every such delta and snapped
  // `dismissed` back to false, re-opening the popup. The string
  // key only changes when the underlying win actually changes.
  const resultKey =
    result?.kind === 'win'
      ? `win:${result.winner}:${result.from}:${tileId(result.tile)}:${result.faan}:${result.selfDraw ? 1 : 0}`
      : result?.kind === 'draw'
        ? `draw:${result.reason}`
        : null;

  useEffect(() => {
    if (resultKey === null) return;
    setDismissed(false);
    const timer = setTimeout(() => {
      fadeOut(() => setDismissed(true));
    }, DISMISS_MS);
    return () => clearTimeout(timer);
  }, [resultKey, fadeOut]);

  const win = result && result.kind === 'win' ? result : null;
  if (!visibleForFade || !win) return null;

  return (
    <Pressable
      onPress={() => {
        fadeOut(() => setDismissed(true));
      }}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(40, 30, 20, 0.55)',
        // Gutter so the celebration card never sits edge-to-edge on a
        // 320 px portrait phone.
        padding: 20,
        zIndex: 110,
      }}
    >
      <Animated.View
        style={{
          opacity: fade,
          backgroundColor: COLORS.paperHi,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          borderRadius: 24,
          paddingVertical: 40,
          // Horizontal padding shrinks below ~360 wide so the inner
          // content (winner name + faan readout) keeps a real gutter
          // even on iPhone SE-class viewports. The earlier hard
          // `paddingHorizontal: 56` + `minWidth: 340` overflowed.
          paddingHorizontal: 32,
          width: '100%',
          maxWidth: 420,
          alignItems: 'center',
          boxShadow: '0px 24px 60px rgba(0,0,0,0.3)',
        }}
      >
        <PulseEmblem />
        <Text
          style={{
            fontSize: 12,
            fontWeight: '800',
            letterSpacing: 1.4,
            color: COLORS.gold,
            marginBottom: 8,
          }}
        >
          WINNER
        </Text>
        <Text
          style={{
            fontSize: 22,
            fontWeight: '900',
            color: COLORS.ink,
            marginBottom: 12,
            textAlign: 'center',
          }}
        >
          {nameForSeat(lobby, win.winner)}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: 6,
            backgroundColor: COLORS.accentSalmonSwatch,
            borderColor: '#e8a890',
            borderWidth: 1,
            borderRadius: 12,
            paddingVertical: 8,
            paddingHorizontal: 16,
            marginBottom: 14,
          }}
        >
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: 28,
              fontWeight: '700',
              color: COLORS.red,
            }}
          >
            {win.faan}
          </Text>
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: 16,
              color: COLORS.red,
              fontWeight: '600',
            }}
          >
            番
          </Text>
          <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.ink, marginLeft: 4 }}>
            faan
          </Text>
        </View>
        <Text style={{ fontSize: 13, color: COLORS.ink3, fontWeight: '600' }}>
          {win.selfDraw ? '自摸 · self-draw' : `Won off seat ${win.from}`}
        </Text>
        <Text style={{ fontSize: 10, color: COLORS.ink3, marginTop: 18, opacity: 0.6 }}>
          Tap anywhere to dismiss
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function PulseEmblem() {
  const t = usePulse({ durationMs: PULSE_TEMPO.ambient });
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] });
  return (
    <Animated.View style={{ marginBottom: 8, transform: [{ scale }, { rotate }] }}>
      <Text
        style={{
          fontFamily: 'Noto Serif TC',
          fontSize: 96,
          lineHeight: 96,
          color: COLORS.red,
          fontWeight: '700',
        }}
      >
        和
      </Text>
    </Animated.View>
  );
}
