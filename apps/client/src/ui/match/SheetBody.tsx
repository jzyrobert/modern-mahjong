import { type ReactNode, useState } from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  ScrollView,
  View,
  type ViewStyle,
} from 'react-native';
import { COLORS } from '../colors';
import { SHEET_FADE_PX, sheetShowsCue } from './sheetLayout';
import { type SheetTheme, sheetPalette } from './sheetTheme';

interface SheetBodyProps {
  theme: SheetTheme;
  children: ReactNode;
  contentContainerStyle?: ViewStyle;
  /**
   * Rendered *below* the scroll region, inside the sheet, so it is
   * always reachable however long the body — the breakdown's TOTAL row,
   * which used to scroll off a landscape phone's 90 %-height sheet.
   */
  footer?: ReactNode;
  /** Forwarded to the ScrollView (recipes / specs scroll it). */
  testID?: string;
}

/** Sheet ground the fade blends into (matches `Modal`'s card fill). */
const GLASS_FILL = 'rgb(14,20,17)';
const PAPER_FILL = COLORS.paperHi;

/**
 * The scrolling body of an in-match sheet. The `Modal` card caps its
 * height at 90 % of the viewport and the body scrolls inside it — but
 * a sheet cut mid-row on a landscape phone gave no sign that the older
 * log rows or the breakdown's total were below the fold. This wraps
 * the ScrollView with a bottom fade + chevron that shows while content
 * is hidden below (`sheetShowsCue`) and clears once the user reaches
 * the end, and hosts an optional pinned `footer`.
 *
 * Renders as two siblings (fragment) so the `Modal` card's flex column
 * sizes the scroll region and the footer directly — a wrapper View
 * would need its own shrink rules to let the region give up height.
 */
export function SheetBody({
  theme,
  children,
  contentContainerStyle,
  footer,
  testID,
}: SheetBodyProps) {
  const glass = theme === 'glass';
  const P = sheetPalette(theme);
  const [layoutH, setLayoutH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const cue = sheetShowsCue(layoutH, contentH, scrollY);
  const fill = glass ? GLASS_FILL : PAPER_FILL;
  const onLayout = (e: LayoutChangeEvent) => setLayoutH(e.nativeEvent.layout.height);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setScrollY(e.nativeEvent.contentOffset.y);
  return (
    <>
      <View style={{ flexShrink: 1 }}>
        <ScrollView
          testID={testID}
          onLayout={onLayout}
          onContentSizeChange={(_w, h) => setContentH(h)}
          onScroll={onScroll}
          scrollEventThrottle={32}
          contentContainerStyle={contentContainerStyle}
        >
          {children}
        </ScrollView>
        {cue ? <FoldCue fill={fill} glass={glass} chevron={P.text2} /> : null}
      </View>
      {footer}
    </>
  );
}

/** Steps of the native fallback fade (no `linear-gradient` off-web). */
const FADE_STEPS = 6;

function FoldCue({ fill, glass, chevron }: { fill: string; glass: boolean; chevron: string }) {
  const rgb = fill.startsWith('rgb(') ? fill.slice(4, -1) : hexToRgb(fill);
  const alphaAt = (t: number) => (glass ? 0.92 : 0.96) * t;
  return (
    <View
      pointerEvents="none"
      testID="sheet-scroll-cue"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: SHEET_FADE_PX,
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 8,
        ...(Platform.OS === 'web'
          ? ({
              backgroundImage: `linear-gradient(180deg, rgba(${rgb},0) 0%, rgba(${rgb},${alphaAt(1)}) 100%)`,
            } as unknown as ViewStyle)
          : null),
      }}
    >
      {Platform.OS !== 'web'
        ? Array.from({ length: FADE_STEPS }, (_, i) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed ladder of fade steps
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: (i * SHEET_FADE_PX) / FADE_STEPS,
                height: SHEET_FADE_PX / FADE_STEPS + 1,
                backgroundColor: `rgba(${rgb},${alphaAt((i + 1) / FADE_STEPS)})`,
              }}
            />
          ))
        : null}
      <View
        style={{
          width: 9,
          height: 9,
          borderRightWidth: 1.5,
          borderBottomWidth: 1.5,
          borderColor: chevron,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
