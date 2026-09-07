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
import {
  SHEET_CUE_STRIP_PX,
  SHEET_FADE_PX,
  sheetCueAlphaAt,
  sheetCueGradient,
  sheetShowsCue,
} from './sheetLayout';
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
 * the end, and hosts an optional pinned `footer`. The chevron sits in
 * the fade's bottom `SHEET_CUE_STRIP_PX`, a flat ≥ 0.94-alpha band of
 * the sheet fill, so the copy scrolls under the glyph rather than
 * showing through it.
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
        {cue ? <FoldCue fill={fill} chevron={P.text2} /> : null}
      </View>
      {footer}
    </>
  );
}

/** Steps of the native fallback fade (no `linear-gradient` off-web):
 *  the ramp in steps, then the strip as one flat band. */
const FADE_STEPS = 6;
/** Chevron box (rotated 45°, so it spans ~13 px) and its bottom inset —
 *  the glyph lies wholly inside the strip. */
const CHEVRON_PX = 9;
const CHEVRON_INSET_PX = 5;

function FoldCue({ fill, chevron }: { fill: string; chevron: string }) {
  const rgb = fill.startsWith('rgb(') ? fill.slice(4, -1) : hexToRgb(fill);
  const rampH = SHEET_FADE_PX - SHEET_CUE_STRIP_PX;
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
        paddingBottom: CHEVRON_INSET_PX,
        ...(Platform.OS === 'web'
          ? ({ backgroundImage: sheetCueGradient(rgb) } as unknown as ViewStyle)
          : null),
      }}
    >
      {Platform.OS !== 'web'
        ? Array.from({ length: FADE_STEPS + 1 }, (_, i) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed ladder of fade steps
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: i < FADE_STEPS ? (i * rampH) / FADE_STEPS : rampH,
                height: i < FADE_STEPS ? rampH / FADE_STEPS + 1 : SHEET_CUE_STRIP_PX,
                backgroundColor: `rgba(${rgb},${sheetCueAlphaAt(
                  i < FADE_STEPS ? ((i + 1) / FADE_STEPS) * (rampH / SHEET_FADE_PX) : 1,
                )})`,
              }}
            />
          ))
        : null}
      <View
        testID="sheet-scroll-chevron"
        style={{
          width: CHEVRON_PX,
          height: CHEVRON_PX,
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
