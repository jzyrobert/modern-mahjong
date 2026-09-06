import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import {
  type DimensionValue,
  type LayoutChangeEvent,
  Pressable,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { type PlaybackPov, usePlayback } from '../../replay/playback';
import { HOVER_TRANSITION, MENU, TYPE, glass } from '../menu/theme';
import { type ReplayChapter, shortChapterResult } from './chapters';
import { MICRO } from './glassParts';
import {
  PauseIcon,
  PlayGlyphIcon,
  SkipBackIcon,
  SkipForwardIcon,
  StepBackIcon,
  StepForwardIcon,
} from './icons';
import { TIMELINE_GAP, pressX, ratioToX, timelineSegments, xToCursor } from './timeline';

/**
 * Glass scrubber for the 3D replay player. The chapter cards *are* the
 * timeline: each hand is a glass card flexed by its share of the
 * record, the gold playhead runs across the strip, and a tap seeks to
 * the frame under the finger. Transport buttons are glass chips with a
 * gold play / pause; speed and point of view are segmented glass.
 *
 * Two arrangements: `stack` (portrait dock — leading row, timeline,
 * controls) and `row` (landscape footer / desktop panel — everything on
 * one line). Accessible names match the paper `Scrubber`'s so the
 * replay specs drive either.
 */
export function GlassScrubber({
  chapters,
  layout,
  compact,
  leading,
  showCounter = true,
}: {
  chapters: readonly ReplayChapter[];
  layout: 'stack' | 'row';
  compact: boolean;
  /** The point-of-view seat's badge (stack: header row; row: first cell). */
  leading?: ReactNode;
  /** The frame counter — off when the status pill already shows it. */
  showCounter?: boolean;
}) {
  const playback = usePlayback();
  const controls = <TransportGroup compact={compact} />;
  const counter = (
    <Text
      testID="replay-frame-counter"
      style={[
        MICRO,
        { color: MENU.text2, letterSpacing: 0.6, minWidth: compact ? 44 : 52, textAlign: 'center' },
      ]}
      numberOfLines={1}
    >
      {playback.cursor + 1}/{playback.totalFrames}
    </Text>
  );
  const speed = (
    <SpeedPicker speed={playback.speed} onChange={playback.setSpeed} compact={compact} />
  );
  const pov = <PovPicker pov={playback.pov} onChange={playback.setPov} compact={compact} />;

  if (layout === 'row') {
    return (
      <View
        testID="replay-scrubber"
        style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 8 : 12, minWidth: 0 }}
      >
        {leading}
        {controls}
        <Timeline
          chapters={chapters}
          compact={compact}
          showResult={!compact}
          style={{ flex: 1, minWidth: 0 }}
        />
        {showCounter ? counter : null}
        {speed}
        {pov}
      </View>
    );
  }
  return (
    <View testID="replay-scrubber" style={{ ...glass({ radius: 16 }), padding: 6, gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row' }}>{leading}</View>
        {pov}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Timeline
          chapters={chapters}
          compact={compact}
          showResult
          style={{ flex: 1, minWidth: 0 }}
        />
        {counter}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {controls}
        <View style={{ flex: 1 }} />
        {speed}
      </View>
    </View>
  );
}

// ─── Timeline (chapter cards + playhead) ────────────────────────────

/** Strip height, CSS px: 26 on compact strips (the portrait dock), 30 otherwise. */
function timelineHeight(compact: boolean): number {
  return compact ? 26 : 30;
}

function Timeline({
  chapters,
  compact,
  showResult,
  style,
}: {
  chapters: readonly ReplayChapter[];
  compact: boolean;
  showResult: boolean;
  style?: ViewStyle;
}) {
  const playback = usePlayback();
  const [trackWidth, setTrackWidth] = useState(0);
  const trackRef = useRef<View | null>(null);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width),
    [],
  );
  const segments = useMemo(() => timelineSegments(chapters, compact), [chapters, compact]);
  const onPress = useCallback(
    (e: { nativeEvent: unknown }) => {
      if (trackWidth <= 0 || playback.totalFrames <= 1) return;
      // RN-web hands the DOM event through (no `locationX`): measure
      // against the strip's own rect so a tap on a card lands where the
      // playhead would draw the same frame.
      const el = trackRef.current as unknown as { getBoundingClientRect?: () => DOMRect } | null;
      const left = el?.getBoundingClientRect ? el.getBoundingClientRect().left : null;
      const x = pressX(e.nativeEvent, left);
      if (x === null) return;
      playback.goto(xToCursor(segments, x, trackWidth, playback.totalFrames));
    },
    [trackWidth, playback, segments],
  );
  const ratio = playback.totalFrames > 1 ? playback.cursor / (playback.totalFrames - 1) : 0;
  const h = timelineHeight(compact);
  // Playhead x follows the cards' piecewise geometry (percent fallback
  // before the first layout).
  const headX = trackWidth > 0 ? ratioToX(segments, ratio, trackWidth) : null;
  const headLeft: DimensionValue = headX !== null ? headX : `${ratio * 100}%`;
  return (
    <Pressable
      ref={trackRef}
      onPress={onPress}
      onLayout={onLayout}
      accessibilityLabel="Replay timeline"
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 1, max: playback.totalFrames, now: playback.cursor + 1 }}
      style={[{ height: h, minWidth: 0 }, style]}
    >
      <View style={{ flexDirection: 'row', gap: TIMELINE_GAP, height: h }} pointerEvents="none">
        {chapters.length === 0 ? (
          <View
            style={{
              flex: 1,
              borderRadius: 8,
              backgroundColor: MENU.fill,
              borderColor: MENU.hairlineSoft,
              borderWidth: 1,
            }}
          />
        ) : (
          chapters.map((c, i) => (
            <ChapterCard
              key={c.seq}
              chapter={c}
              weight={segments[i]!.weight}
              compact={compact}
              showResult={showResult}
              height={h}
            />
          ))
        )}
      </View>
      {/* Gold playhead */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -3,
          bottom: -3,
          left: headLeft,
          width: 2,
          marginLeft: -1,
          borderRadius: 1,
          backgroundColor: MENU.goldHi,
          boxShadow: '0px 0px 8px rgba(216,168,90,0.8)',
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -6,
          left: headLeft,
          width: 8,
          height: 8,
          marginLeft: -4,
          borderRadius: 4,
          backgroundColor: MENU.goldHi,
          borderColor: '#0e1411',
          borderWidth: 1.5,
        }}
      />
    </Pressable>
  );
}

function ChapterCard({
  chapter: c,
  weight,
  compact,
  showResult,
  height,
}: {
  chapter: ReplayChapter;
  weight: number;
  compact: boolean;
  showResult: boolean;
  height: number;
}) {
  const full = showResult && (!compact || c.current);
  // Compact strips: "H2" instead of "HAND 2" so the result keeps its faan.
  const label = compact ? `H${c.index}` : c.label;
  return (
    <View
      accessibilityLabel={`Chapter ${c.label}`}
      style={{
        flex: weight,
        minWidth: 0,
        height,
        paddingHorizontal: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: c.current ? 'rgba(216,168,90,0.6)' : MENU.hairlineSoft,
        backgroundColor: c.current ? MENU.goldTint : MENU.fill,
        opacity: c.pending ? 0.55 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        overflow: 'hidden',
      }}
    >
      <Text
        style={[
          TYPE.serif,
          { fontSize: 12, lineHeight: 14, color: c.current ? MENU.goldHi : MENU.text2 },
        ]}
      >
        {c.wind}
      </Text>
      <Text
        style={[
          MICRO,
          { letterSpacing: 0.8, color: c.current ? MENU.text : MENU.text2, flexShrink: 0 },
        ]}
        numberOfLines={1}
      >
        {full ? label : String(c.index)}
      </Text>
      {full ? (
        <Text
          style={{
            fontSize: 11,
            lineHeight: 13,
            fontWeight: '600',
            color: MENU.text3,
            flexShrink: 1,
            minWidth: 0,
          }}
          numberOfLines={1}
        >
          {compact ? shortChapterResult(c.result) : c.result}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Transport ──────────────────────────────────────────────────────

function TransportGroup({ compact }: { compact: boolean }) {
  const playback = usePlayback();
  const h = compact ? 26 : 34;
  const iconColor = MENU.text;
  const icon = compact ? 12 : 14;
  return (
    <View
      style={{
        ...glass({ radius: 999, quiet: true }),
        flexDirection: 'row',
        alignItems: 'center',
        padding: 2,
        gap: 2,
        height: h + 4,
      }}
    >
      <TransportButton
        hint="Previous bookmark"
        onPress={playback.jumpPrevBookmark}
        h={h}
        compact={compact}
      >
        <SkipBackIcon size={icon} color={iconColor} />
      </TransportButton>
      <TransportButton
        hint="Step back"
        onPress={() => playback.step(-1)}
        disabled={playback.cursor <= 0}
        h={h}
        compact={compact}
      >
        <StepBackIcon size={icon} color={iconColor} />
      </TransportButton>
      <TransportButton
        hint={playback.isPlaying ? 'Pause' : 'Play'}
        onPress={playback.togglePlay}
        primary
        h={h}
        compact={compact}
      >
        {playback.isPlaying ? (
          <PauseIcon size={icon + 2} color={MENU.goldInk} />
        ) : (
          <PlayGlyphIcon size={icon + 2} color={MENU.goldInk} />
        )}
      </TransportButton>
      <TransportButton
        hint="Step forward"
        onPress={() => playback.step(1)}
        disabled={playback.cursor >= playback.totalFrames - 1}
        h={h}
        compact={compact}
      >
        <StepForwardIcon size={icon} color={iconColor} />
      </TransportButton>
      <TransportButton
        hint="Next bookmark"
        onPress={playback.jumpNextBookmark}
        h={h}
        compact={compact}
      >
        <SkipForwardIcon size={icon} color={iconColor} />
      </TransportButton>
    </View>
  );
}

function TransportButton({
  children,
  hint,
  onPress,
  disabled = false,
  primary = false,
  h,
  compact,
}: {
  children: ReactNode;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  h: number;
  compact: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={hint}
      accessibilityState={{ disabled }}
      hitSlop={2}
      style={({ pressed }) => ({
        width: primary ? (compact ? 38 : 46) : compact ? 28 : 34,
        height: h,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary
          ? pressed
            ? MENU.goldHi
            : MENU.gold
          : pressed
            ? MENU.fillHi
            : 'transparent',
        opacity: disabled ? 0.4 : 1,
        ...(primary ? { boxShadow: '0px 4px 14px rgba(216,168,90,0.28)' } : {}),
        ...HOVER_TRANSITION,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}
    >
      {children}
    </Pressable>
  );
}

// ─── Segmented pickers ──────────────────────────────────────────────

function Segmented({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        ...glass({ radius: 999, quiet: true }),
        flexDirection: 'row',
        alignItems: 'center',
        padding: 2,
        gap: 1,
      }}
    >
      {children}
    </View>
  );
}

function Segment({
  active,
  label,
  onPress,
  children,
  compact,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  children: ReactNode;
  compact: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={2}
      style={({ pressed }) => ({
        minWidth: compact ? 24 : 30,
        height: compact ? 26 : 30,
        paddingHorizontal: compact ? 4 : 7,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? MENU.goldTint : pressed ? MENU.fillHi : 'transparent',
        borderWidth: 1,
        borderColor: active ? MENU.goldEdge : 'transparent',
        ...HOVER_TRANSITION,
      })}
    >
      {children}
    </Pressable>
  );
}

const SPEEDS: ReadonlyArray<0.5 | 1 | 2 | 4> = [0.5, 1, 2, 4];

function SpeedPicker({
  speed,
  onChange,
  compact,
}: {
  speed: 0.5 | 1 | 2 | 4;
  onChange: (rate: 0.5 | 1 | 2 | 4) => void;
  compact: boolean;
}) {
  return (
    <Segmented>
      {SPEEDS.map((s) => (
        <Segment
          key={s}
          active={speed === s}
          label={`Speed ${s}x`}
          onPress={() => onChange(s)}
          compact={compact}
        >
          <Text
            style={[
              MICRO,
              {
                fontSize: 10,
                letterSpacing: 0.4,
                color: speed === s ? MENU.goldHi : MENU.text2,
                textTransform: 'none',
              },
            ]}
          >
            {s}×
          </Text>
        </Segment>
      ))}
    </Segmented>
  );
}

const POV_LABELS: Record<PlaybackPov, string> = { all: 'All', 0: 'E', 1: 'S', 2: 'W', 3: 'N' };
const POV_GLYPHS: Record<PlaybackPov, string> = { all: 'All', 0: '東', 1: '南', 2: '西', 3: '北' };
const POVS: readonly PlaybackPov[] = ['all', 0, 1, 2, 3];

function PovPicker({
  pov,
  onChange,
  compact,
}: {
  pov: PlaybackPov;
  onChange: (pov: PlaybackPov) => void;
  compact: boolean;
}) {
  return (
    <Segmented>
      {POVS.map((p) => {
        const active = pov === p;
        return (
          <Segment
            key={String(p)}
            active={active}
            label={`POV ${POV_LABELS[p]}`}
            onPress={() => onChange(p)}
            compact={compact}
          >
            <Text
              style={
                p === 'all'
                  ? [
                      MICRO,
                      {
                        fontSize: 10,
                        letterSpacing: 0.6,
                        color: active ? MENU.goldHi : MENU.text2,
                      },
                    ]
                  : [
                      TYPE.serif,
                      {
                        fontSize: compact ? 12 : 13,
                        lineHeight: 15,
                        color: active ? MENU.goldHi : MENU.text2,
                      },
                    ]
              }
            >
              {POV_GLYPHS[p]}
            </Text>
          </Segment>
        );
      })}
    </Segmented>
  );
}
