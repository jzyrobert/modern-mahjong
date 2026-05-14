import { useCallback, useState } from 'react';
import { type LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import { type PlaybackPov, usePlayback } from '../../replay/playback';
import type { ReplayBookmark, ReplayBookmarkKind } from '../../replay/types';
import { COLORS } from '../colors';

const PIP_COLOR: Record<ReplayBookmarkKind, string> = {
  'hand-start': COLORS.ink2,
  gang: COLORS.red,
  'robbed-gang': '#a64ad9',
  win: COLORS.gold,
  draw: COLORS.green,
};

/**
 * Scrubber strip — a horizontal track + play/pause + step controls +
 * speed picker + POV picker. Drives the `usePlayback` context. Tap a
 * bookmark pip to jump there; drag the track for fine-grained seek.
 */
export function Scrubber({ compact = false }: { compact?: boolean }) {
  const playback = usePlayback();
  const [trackWidth, setTrackWidth] = useState(0);
  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const onTrackPress = useCallback(
    (e: { nativeEvent: { locationX: number } }) => {
      if (trackWidth <= 0 || playback.totalFrames <= 1) return;
      const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / trackWidth));
      playback.goto(Math.round(ratio * (playback.totalFrames - 1)));
    },
    [trackWidth, playback],
  );

  const cursorRatio = playback.totalFrames > 1 ? playback.cursor / (playback.totalFrames - 1) : 0;

  return (
    <View
      style={{
        backgroundColor: COLORS.paperHi,
        borderTopColor: COLORS.hairline,
        borderTopWidth: 1,
        paddingHorizontal: compact ? 8 : 12,
        paddingVertical: compact ? 6 : 10,
        gap: compact ? 5 : 8,
      }}
    >
      {/* Track + pips */}
      <Pressable
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
          {/* Bookmark pips */}
          {playback.bookmarks.map((b) => (
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
              borderColor: COLORS.paperHi,
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
        borderRadius: 6,
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
              : COLORS.creamLow,
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
            {POV_LABELS[p]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
