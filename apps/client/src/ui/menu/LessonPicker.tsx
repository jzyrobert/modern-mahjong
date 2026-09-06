import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useGame } from '../../state/game';
import { LESSONS, LESSON_ORDER } from '../../state/tutorial';
import { CheckIcon } from './icons';
import { HOVER_TRANSITION, MENU, TYPE, webStyle } from './theme';

/**
 * Tutorial lesson picker shared by both lobby layouts. Every lesson in
 * `LESSON_ORDER` is tappable (completed ones replay); the accessible
 * name is `Start <title>` / `Replay <title>` and the testID is
 * `lesson-<id>` — both are load-bearing for the tutorial e2e specs and
 * the screenshot verifier's `startTutorial` step.
 */
export interface LessonItem {
  id: string;
  title: string;
  blurb: string;
  done: boolean;
  /** 1-based curriculum position. */
  index: number;
}

export function useLessonItems(): LessonItem[] {
  const completed = useGame((s) => s.settings.tutorialsCompleted);
  const items: LessonItem[] = [];
  LESSON_ORDER.forEach((id, i) => {
    const lesson = LESSONS[id];
    if (!lesson) return;
    items.push({
      id,
      title: lesson.title,
      blurb: lesson.blurb,
      done: completed.includes(id),
      index: i + 1,
    });
  });
  return items;
}

export function lessonProgressLabel(done: number, total: number): string {
  if (done === 0) return 'New here? Pick any lesson to begin';
  if (done >= total) return `All ${total} lessons complete`;
  return `${done}/${total} lessons done`;
}

function TickBadge({ done, size = 20 }: { done: boolean; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: done ? MENU.gold : 'transparent',
        borderWidth: done ? 0 : 1,
        borderColor: MENU.hairline,
      }}
    >
      {done ? <CheckIcon size={size * 0.6} color={MENU.goldInk} /> : null}
    </View>
  );
}

interface LessonPressableProps {
  item: LessonItem;
  onPress: () => void;
}

function useLessonA11y(item: LessonItem) {
  return {
    accessibilityRole: 'button' as const,
    accessibilityLabel: `${item.done ? 'Replay' : 'Start'} ${item.title}`,
    testID: `lesson-${item.id}`,
  };
}

/** Rail card (phone): index + tick, title, two-line blurb. */
export function LessonCard({
  item,
  onPress,
  width = 164,
}: LessonPressableProps & { width?: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...useLessonA11y(item)}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        width,
        minHeight: 112,
        padding: 12,
        gap: 6,
        borderRadius: 14,
        backgroundColor: pressed ? MENU.fillHi : item.done ? 'rgba(216,168,90,0.08)' : MENU.fill,
        borderWidth: 1,
        borderColor: item.done ? MENU.goldEdge : MENU.hairline,
        ...HOVER_TRANSITION,
        transform: [{ translateY: hovered && !pressed ? -2 : 0 }, { scale: pressed ? 0.97 : 1 }],
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[TYPE.label, { fontSize: 10, letterSpacing: 1.6, color: MENU.goldMuted }]}>
          {String(item.index).padStart(2, '0')}
        </Text>
        <TickBadge done={item.done} size={18} />
      </View>
      <Text
        style={{ fontSize: 13, lineHeight: 16, fontWeight: '800', color: MENU.text }}
        numberOfLines={2}
      >
        {item.title}
      </Text>
      <Text style={[TYPE.small, { lineHeight: 15 }]} numberOfLines={2}>
        {item.blurb}
      </Text>
    </Pressable>
  );
}

/** Grid chip (desktop card): tick + title on one compact row. */
export function LessonChip({ item, onPress }: LessonPressableProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      {...useLessonA11y(item)}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 10,
        minHeight: 40,
        borderRadius: 10,
        backgroundColor: pressed ? MENU.fillHi : hovered ? MENU.fillHi : MENU.fill,
        borderWidth: 1,
        borderColor: item.done ? MENU.goldEdge : MENU.hairlineSoft,
        ...HOVER_TRANSITION,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <TickBadge done={item.done} size={18} />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          lineHeight: 15,
          fontWeight: '700',
          color: MENU.text,
        }}
        numberOfLines={2}
      >
        {item.title}
      </Text>
      <Text style={{ fontSize: 10, fontWeight: '700', color: MENU.goldMuted, letterSpacing: 1 }}>
        {String(item.index).padStart(2, '0')}
      </Text>
    </Pressable>
  );
}

interface PickerProps {
  items: LessonItem[];
  onStart: (id: string) => void;
}

/** Trailing fade of the lesson rail, CSS px past the gutter. */
export const LESSON_RAIL_FADE_PX = 36;

/**
 * Horizontal card row — phone. Bleeds to the card edge with `gutter`
 * px of side padding on both ends (symmetric inset), and on web the
 * trailing edge fades out over `LESSON_RAIL_FADE_PX` (a CSS mask on
 * the wrapping View, where Chromium always honours it) so the card cut
 * by the panel edge reads as intentional overflow rather than a hard
 * clip against the panel's border. The leading edge fades over the
 * gutter only, so card 01 stays fully opaque at scroll 0.
 */
export function LessonRail({ items, onStart, gutter = 12 }: PickerProps & { gutter?: number }) {
  const fade = `linear-gradient(to right, transparent 0px, #000 ${gutter}px, #000 calc(100% - ${gutter + LESSON_RAIL_FADE_PX}px), transparent calc(100% - 2px))`;
  return (
    <View
      testID="lesson-rail"
      style={{
        marginHorizontal: -gutter,
        ...webStyle({ maskImage: fade, WebkitMaskImage: fade }),
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: 8 }}
      >
        {items.map((item) => (
          <LessonCard key={item.id} item={item} onPress={() => onStart(item.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

/** Two-column chip grid — desktop card body. */
export function LessonGrid({ items, onStart, columns = 2 }: PickerProps & { columns?: number }) {
  const basis = `${Math.floor(100 / columns) - 1}%` as `${number}%`;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {items.map((item) => (
        <View key={item.id} style={{ flexBasis: basis, flexGrow: 1 }}>
          <LessonChip item={item} onPress={() => onStart(item.id)} />
        </View>
      ))}
    </View>
  );
}

/** Thin gold progress bar under the tutorial card header. */
export function LessonProgress({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: done }}
      style={{ height: 4, borderRadius: 999, backgroundColor: MENU.fill, overflow: 'hidden' }}
    >
      <View
        style={{ width: `${pct}%`, height: 4, backgroundColor: MENU.gold, borderRadius: 999 }}
      />
    </View>
  );
}
