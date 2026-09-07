import { useCallback, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import { type PlaybackPov, usePlayback } from '../../replay/playback';
import type { ReplayBookmark, ReplayBookmarkKind } from '../../replay/types';
import { COLORS } from '../colors';
import type { ReplayChapter } from './chapters';
import { pressX, xToCursor } from './timeline';

const PIP_COLOR: Record<ReplayBookmarkKind, string> = {
  'hand-start': COLORS.ink2,
  gang: COLORS.red,
  'robbed-gang': '#a64ad9',
  win: COLORS.gold,
  draw: COLORS.success,
};

/**
 * Scrubber strip — chapter strip + horizontal track + play/pause +
 * step controls + speed picker + POV picker. Drives the `usePlayback`
 * context.
 *
 * When `chapters` is passed, the rotated-square bookmark pips are
 * replaced by a horizontally-flexed per-hand chapter strip above the
 * track. Each chapter shows the round-wind glyph, hand label, and a
 * one-line result (`Robert wins 5 faan` / `Drawn game` / `IN PROGRESS`
 * / `Pending`). Taps seek to the chapter's first frame. When
 * `chapters` is omitted, the legacy bookmark-pip overlay sits on top
 * of the track instead.
 */
export function Scrubber({
  compact = false,
  chapters,
}: {
  compact?: boolean;
  chapters?: readonly ReplayChapter[] | undefined;
}) {
  const playback = usePlayback();
  const [trackWidth, setTrackWidth] = useState(0);
  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const trackRef = useRef<View | null>(null);
  const onTrackPress = useCallback(
    (e: { nativeEvent: unknown }) => {
      if (trackWidth <= 0 || playback.totalFrames <= 1) return;
      // RN-web's event has no `locationX`; measure against the track.
      const el = trackRef.current as unknown as { getBoundingClientRect?: () => DOMRect } | null;
      const left = el?.getBoundingClientRect ? el.getBoundingClientRect().left : null;
      const x = pressX(e.nativeEvent, left);
      if (x === null) return;
      playback.goto(xToCursor([], x, trackWidth, playback.totalFrames));
    },
    [trackWidth, playback],
  );

  const cursorRatio = playback.totalFrames > 1 ? playback.cursor / (playback.totalFrames - 1) : 0;
  const showChapters = chapters && chapters.length > 0;

  return (
    <View
      style={{
        backgroundColor: 'rgba(255,255,255,0.94)',
        borderTopColor: COLORS.hairline,
        borderTopWidth: 1,
        paddingHorizontal: compact ? 12 : 16,
        paddingVertical: compact ? 6 : 10,
        gap: compact ? 5 : 8,
      }}
    >
      {showChapters ? (
        <ChapterStrip chapters={chapters} compact={compact} onSeek={(seq) => playback.goto(seq)} />
      ) : null}

      {/* Track + pips */}
      <Pressable
        ref={trackRef}
        onPress={onTrackPress}
        onLayout={onTrackLayout}
        accessibilityLabel="Replay timeline"
        style={{
          height: compact ? 18 : 22,
          justifyContent: 'center',
          paddingVertical: 4,
        }}
      >
        <View
          style={{
            position: 'relative',
            height: 6,
            borderRadius: 3,
            backgroundColor: COLORS.creamLow,
          }}
        >
          {/* Filled bar up to cursor */}
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${cursorRatio * 100}%`,
              backgroundColor: COLORS.red,
              borderRadius: 3,
            }}
          />
          {/* Bookmark pips — only when the chapter strip isn't already
           *  carrying the hand boundaries. */}
          {showChapters
            ? null
            : playback.bookmarks.map((b) => (
                <BookmarkPip
                  key={`${b.seq}-${b.kind}`}
                  bookmark={b}
                  totalFrames={playback.totalFrames}
                  onPress={() => playback.goto(b.seq)}
                />
              ))}
          {/* Cursor knob */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: `${cursorRatio * 100}%`,
              top: -4,
              width: 14,
              height: 14,
              borderRadius: 7,
              transform: [{ translateX: -7 }],
              backgroundColor: COLORS.red,
              borderColor: 'white',
              borderWidth: 2,
            }}
          />
        </View>
      </Pressable>

      {/* Controls row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: compact ? 3 : 6,
          flexWrap: 'wrap',
        }}
      >
        <ControlButton
          onPress={playback.jumpPrevBookmark}
          label="⏮"
          hint="Previous bookmark"
          compact={compact}
        />
        <ControlButton
          onPress={() => playback.step(-1)}
          label="◀"
          hint="Step back"
          disabled={playback.cursor <= 0}
          compact={compact}
        />
        <ControlButton
          onPress={playback.togglePlay}
          label={playback.isPlaying ? '⏸' : '▶'}
          hint={playback.isPlaying ? 'Pause' : 'Play'}
          primary
          compact={compact}
        />
        <ControlButton
          onPress={() => playback.step(1)}
          label="▶"
          hint="Step forward"
          disabled={playback.cursor >= playback.totalFrames - 1}
          compact={compact}
        />
        <ControlButton
          onPress={playback.jumpNextBookmark}
          label="⏭"
          hint="Next bookmark"
          compact={compact}
        />

        <SpeedPicker speed={playback.speed} onChange={playback.setSpeed} compact={compact} />
        <PovPicker pov={playback.pov} onChange={playback.setPov} compact={compact} />

        <View style={{ flex: 1 }} />
        <Text
          style={{
            fontSize: compact ? 10 : 11,
            fontWeight: '700',
            color: COLORS.ink3,
            fontFamily: 'Courier',
          }}
        >
          {playback.cursor + 1}/{playback.totalFrames}
        </Text>
      </View>
    </View>
  );
}

function ChapterStrip({
  chapters,
  compact,
  onSeek,
}: {
  chapters: readonly ReplayChapter[];
  compact: boolean;
  onSeek: (seq: number) => void;
}) {
  // On the very narrow compact layout, only the current chapter shows
  // its full label + result; the rest collapse to a wind-glyph cell so
  // the strip fits without wrapping.
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {chapters.map((c) => {
        const showFull = !compact || c.current;
        return (
          <Pressable
            key={c.seq}
            onPress={() => onSeek(c.seq)}
            accessibilityLabel={`Chapter ${c.label}`}
            style={({ pressed }) => ({
              flex: Math.max(0.001, c.to - c.from) * (showFull && compact ? 3 : 1),
              minWidth: 0,
              paddingHorizontal: compact ? 6 : 8,
              paddingVertical: compact ? 5 : 6,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: c.current
                ? COLORS.accentSalmonEdge
                : pressed
                  ? COLORS.creamPressed
                  : COLORS.hairline,
              backgroundColor: c.current
                ? COLORS.accentSalmonSwatch
                : c.pending
                  ? 'rgba(205,193,173,0.25)'
                  : COLORS.creamLow,
              opacity: c.pending ? 0.6 : 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
            })}
          >
            <Text
              style={{
                fontFamily: 'Noto Serif TC',
                fontSize: compact ? 13 : 14,
                fontWeight: '700',
                color: c.current ? COLORS.red : COLORS.ink2,
                lineHeight: compact ? 14 : 16,
              }}
            >
              {c.wind}
            </Text>
            {showFull ? (
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{
                    fontSize: compact ? 9 : 9,
                    fontWeight: '900',
                    letterSpacing: 0.5,
                    color: COLORS.ink,
                  }}
                  numberOfLines={1}
                >
                  {c.label}
                </Text>
                <Text
                  style={{
                    fontSize: compact ? 8 : 9,
                    fontWeight: '700',
                    color: COLORS.ink3,
                  }}
                  numberOfLines={1}
                >
                  {c.result}
                </Text>
              </View>
            ) : (
              <Text style={{ fontSize: 8, fontWeight: '800', color: COLORS.ink3 }}>{c.index}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function BookmarkPip({
  bookmark,
  totalFrames,
  onPress,
}: {
  bookmark: ReplayBookmark;
  totalFrames: number;
  onPress: () => void;
}) {
  const ratio = totalFrames > 1 ? bookmark.seq / (totalFrames - 1) : 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={bookmark.label}
      style={{
        position: 'absolute',
        left: `${ratio * 100}%`,
        top: -2,
        bottom: -2,
        width: 18,
        transform: [{ translateX: -9 }],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          backgroundColor: PIP_COLOR[bookmark.kind],
          transform: [{ rotate: '45deg' }],
          borderColor: COLORS.paperHi,
          borderWidth: 1,
        }}
      />
    </Pressable>
  );
}

function ControlButton({
  label,
  hint,
  onPress,
  disabled,
  primary,
  compact,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  compact?: boolean;
}) {
  const minWidth = primary ? (compact ? 40 : 48) : compact ? 28 : 36;
  const heightDim = primary ? (compact ? 30 : 36) : compact ? 24 : 28;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={hint}
      disabled={disabled}
      style={({ pressed }) => ({
        minWidth,
        height: heightDim,
        paddingHorizontal: compact ? 6 : 10,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: disabled
          ? COLORS.creamLow
          : primary
            ? pressed
              ? COLORS.redHot
              : COLORS.red
            : pressed
              ? COLORS.creamPressed
              : 'white',
        borderColor: COLORS.hairline,
        borderWidth: 1,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text
        style={{
          fontSize: primary ? (compact ? 15 : 18) : compact ? 12 : 14,
          color: primary ? 'white' : COLORS.ink,
          fontWeight: '700',
        }}
      >
        {label}
      </Text>
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
  compact?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: COLORS.creamLow,
        borderRadius: 6,
        padding: 2,
        borderColor: COLORS.hairline,
        borderWidth: 1,
      }}
    >
      {SPEEDS.map((s) => (
        <Pressable
          key={s}
          onPress={() => onChange(s)}
          accessibilityLabel={`Speed ${s}x`}
          style={({ pressed }) => ({
            paddingHorizontal: compact ? 5 : 8,
            paddingVertical: compact ? 3 : 4,
            borderRadius: 4,
            backgroundColor:
              speed === s
                ? COLORS.accentSalmonSwatch
                : pressed
                  ? COLORS.creamPressed
                  : 'transparent',
          })}
        >
          <Text
            style={{
              fontSize: compact ? 10 : 11,
              fontWeight: speed === s ? '900' : '700',
              color: speed === s ? COLORS.red : COLORS.ink2,
              fontFamily: 'Courier',
            }}
          >
            {s}×
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const POV_LABELS: Record<PlaybackPov, string> = {
  all: 'All',
  0: 'E',
  1: 'S',
  2: 'W',
  3: 'N',
};

const POV_GLYPHS: Record<PlaybackPov, string> = {
  all: 'All',
  0: '東',
  1: '南',
  2: '西',
  3: '北',
};

const POVS: readonly PlaybackPov[] = ['all', 0, 1, 2, 3];

function PovPicker({
  pov,
  onChange,
  compact,
}: {
  pov: PlaybackPov;
  onChange: (pov: PlaybackPov) => void;
  compact?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: COLORS.creamLow,
        borderRadius: 6,
        padding: 2,
        borderColor: COLORS.hairline,
        borderWidth: 1,
      }}
    >
      {POVS.map((p) => (
        <Pressable
          key={String(p)}
          onPress={() => onChange(p)}
          accessibilityLabel={`POV ${POV_LABELS[p]}`}
          style={({ pressed }) => ({
            paddingHorizontal: compact ? 4 : 6,
            paddingVertical: compact ? 3 : 4,
            borderRadius: 4,
            backgroundColor:
              pov === p ? COLORS.accentSalmonSwatch : pressed ? COLORS.creamPressed : 'transparent',
          })}
        >
          <Text
            style={{
              fontSize: compact ? 9 : 10,
              fontWeight: pov === p ? '900' : '700',
              color: pov === p ? COLORS.red : COLORS.ink2,
              fontFamily: 'Noto Serif TC',
            }}
          >
            {POV_GLYPHS[p]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
