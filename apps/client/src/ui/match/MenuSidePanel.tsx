import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { COLORS } from '../colors';
// `EmoteRow` import removed while the reaction system is being reworked
// (the emote panel is commented out below). Re-add when the new
// reaction surface lands.
import { MenuRowsList, type MenuSheetProps } from './MenuSheet';

const PANEL_WIDTH = 450;
const SLIDE_MS = 260;
const SCRIM_MS = 200;

/**
 * Right-anchored slide-in menu panel used by `<DesktopShell>`.
 * Replaces the mobile bottom-sheet on wide viewports — the sheet's
 * spatial disconnect from the ☰ trigger (top-right chrome) reads as
 * a mobile affordance on desktop, where a right-edge panel pairs
 * with the trigger and leaves the felt visible behind a light scrim.
 *
 * Shape:
 *   - Scrim (`rgba(0,0,0,0.25)`, fades 0→1 in 200 ms) covers the
 *     viewport; tapping it closes the panel.
 *   - 300-px wide panel anchored to the right edge, full viewport
 *     height. Slides in/out via `translateX` ±300 over 260 ms with
 *     the design-spec bezier curve.
 *   - Header (Menu label + ✕ button), then the `<EmoteRow>` block,
 *     then a `<ScrollView>` of `<MenuRowsList>` rows.
 *
 * The panel mounts when `open` flips true and unmounts only after
 * the close animation finishes — so the slide-out is visible AND
 * the menu rows aren't in the DOM while the menu is closed.
 * The latter matters because the row hints include strings like
 * "All 136 tiles…" that would otherwise collide with selectors
 * (`getByText(/\d+ tiles/)`) used to find the live wall count in
 * Playwright specs.
 */
export function MenuSidePanel({
  open,
  onClose,
  onOpenSettings,
  onOpenLog,
  onOpenReference,
  onOpenScoring,
  onLeave,
  onSendChat,
}: MenuSheetProps) {
  const [rendered, setRendered] = useState(open);
  // Both `Animated.Value`s start in the closed state so the open
  // animation runs from off-screen → on-screen on first mount.
  const scrim = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(1)).current;

  // Mount as soon as `open` flips true so the open animation can run.
  // Unmount happens via the animation-finish callback below, not here,
  // because we need the slide-out to play before the rows leave the
  // DOM.
  useEffect(() => {
    if (open) {
      setRendered(true);
    }
  }, [open]);

  useEffect(() => {
    if (!rendered) return;
    const anim = Animated.parallel([
      Animated.timing(scrim, {
        toValue: open ? 1 : 0,
        duration: SCRIM_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: open ? 0 : 1,
        duration: SLIDE_MS,
        easing: Easing.bezier(0.32, 0.72, 0, 1),
        useNativeDriver: true,
      }),
    ]);
    anim.start(({ finished }) => {
      // Only unmount on a *finished* close — a mid-flight interrupt
      // (e.g. user re-opening before the close finishes) hits the
      // `finished: false` branch and leaves `rendered` alone so the
      // next open effect can take over.
      if (finished && !open) setRendered(false);
    });
    return () => anim.stop();
  }, [open, rendered, scrim, slide]);

  if (!rendered) return null;

  const translateX = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, PANEL_WIDTH],
  });

  return (
    <View
      // Full-viewport container; positioned absolutely so it overlays
      // the shell. `pointerEvents` flips with `open` so the slide-out
      // animation doesn't keep the felt unclickable while the panel
      // is on its way off-screen.
      pointerEvents={open ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 30,
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.25)',
          opacity: scrim,
          zIndex: 10,
        }}
      >
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close menu"
          style={{ width: '100%', height: '100%' }}
        />
      </Animated.View>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: PANEL_WIDTH,
          backgroundColor: COLORS.paper,
          borderLeftWidth: 1,
          borderLeftColor: COLORS.hairline,
          boxShadow: '-8px 0 32px rgba(0,0,0,0.13)',
          transform: [{ translateX }],
          zIndex: 20,
          // The panel column owns its own flex stack: header
          // (fixed), emote (fixed), scroll area (flex 1).
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <PanelHeader onClose={onClose} />
        {/* Emote row temporarily disabled — the reaction system is being
            reworked. Re-enable (or replace with the new reaction surface)
            once the redesign lands. */}
        {/*
        {onSendChat ? (
          <View style={{ paddingTop: 10, paddingHorizontal: 11, paddingBottom: 4 }}>
            <EmoteRow
              onSendChat={(emote) => {
                onSendChat(emote);
                onClose();
              }}
            />
          </View>
        ) : null}
        */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: 7,
            paddingHorizontal: 11,
            paddingBottom: 14,
            gap: 5,
          }}
        >
          <MenuRowsList
            onClose={onClose}
            onOpenSettings={onOpenSettings}
            onOpenLog={onOpenLog}
            onOpenReference={onOpenReference}
            onOpenScoring={onOpenScoring}
            onLeave={onLeave}
          />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 13,
        paddingBottom: 10,
        paddingHorizontal: 13,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.hairline,
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: '900', color: COLORS.ink }}>Menu</Text>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close menu"
        style={({ pressed }) => ({
          paddingVertical: 3,
          paddingHorizontal: 9,
          borderRadius: 7,
          borderWidth: 1,
          borderColor: COLORS.hairline,
          backgroundColor: pressed ? COLORS.creamLow : COLORS.paperHi,
        })}
      >
        <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.ink3 }}>✕</Text>
      </Pressable>
    </View>
  );
}
