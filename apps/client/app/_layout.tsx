import '@/src/polyfills';

import { TransportProvider } from '@/src/net/transport-context';
import { DiceCeremony } from '@/src/ui/DiceCeremony';
import { FlipBagProvider } from '@/src/ui/FlipBag';
import { FullscreenPrompt } from '@/src/ui/FullscreenPrompt';
import { ShuffleOverlay } from '@/src/ui/ShuffleOverlay';
import { WinCelebration } from '@/src/ui/WinCelebration';
import { TargetRegistryProvider } from '@/src/ui/tutorial/TargetRegistry';
import { TutorialOverlay } from '@/src/ui/tutorial/TutorialOverlay';
import { useIsHydrated } from '@/src/ui/useIsHydrated';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * Root layout. Mounts the providers every screen needs:
 * - `@/src/polyfills` (platform-split): on native, pulls in
 *   `expo-sqlite/localStorage/install` so the existing localStorage
 *   calls in `identity.ts` and `state/game.ts` survive WebView wipes /
 *   reinstalls. On web, no-ops.
 * - `SafeAreaProvider`: shared safe-area insets for all screens.
 * - `StatusBar` set to dark on the cream surface.
 * - Match-flow overlays (DiceCeremony, ShuffleOverlay, WinCelebration) —
 *   absolute-positioned, gated on engine state slices, animated with
 *   RN core `Animated` so they work in Expo Go without reanimated.
 *   Mounted at root so they layer over both `/` (lobby) and `/match`.
 * - `FlipBagProvider` — the shared rect cache used by `<FlipView>`-
 *   wrapped tiles for layoutId-style FLIP transitions (wall→hand on
 *   draw, hand→discard, discard→meld, between-hand dispense). Lives at
 *   root so a tile's identity survives across route changes (e.g. lobby
 *   → match).
 *
 * The route tree itself is mounted through `<RouteTree>`, which keeps
 * it out of the static render — see the note there.
 */
export default function RootLayout() {
  return (
    <View style={{ flex: 1 }}>
      <SafeAreaProvider>
        <TransportProvider>
          <FlipBagProvider>
            <TargetRegistryProvider>
              <StatusBar style="dark" backgroundColor="#f1eadc" />
              <RouteTree />
            </TargetRegistryProvider>
          </FlipBagProvider>
        </TransportProvider>
      </SafeAreaProvider>
    </View>
  );
}

/**
 * The `<Stack>` of routes plus the root-level match overlays, rendered
 * only once the client has hydrated.
 *
 * `expo export` (`web.output: "static"`) pre-renders every route in
 * Node, and React then hydrates that HTML in the browser. Every screen
 * here branches at render time on things Node can't know and that
 * differ per client: viewport size (`useWindowDimensions` is 0×0 in
 * Node, so the pre-render always took the phone layout), the
 * `localStorage`-backed display name / settings / replay library,
 * `matchMedia` orientation, WebGL2 availability. Whatever the static
 * render picks is wrong for some — on a desktop, for every — client,
 * and React 19 treats any such difference as a hydration failure
 * (error #418: it throws the pre-rendered tree away and re-renders on
 * the client). Before the `localStorage` guard in `src/identity.ts`
 * the pre-render threw outright and left the screen's Suspense
 * boundary marked client-rendered (`<!--$!-->`, error #419 on every
 * page load).
 *
 * So the static HTML carries a deterministic cream shell for the
 * screen area (the same colour `+html.tsx` paints behind the app, so
 * nothing flashes), and the real tree mounts right after hydration —
 * the same client-side mount the routes always had, minus the error.
 * Native and non-SSR client renders skip the shell entirely because
 * `useIsHydrated` is `true` on their first render.
 */
function RouteTree() {
  const hydrated = useIsHydrated();
  if (!hydrated) return <View style={{ flex: 1, backgroundColor: '#f1eadc' }} />;
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#f1eadc' },
        }}
      />
      <ShuffleOverlay />
      <DiceCeremony />
      <WinCelebration />
      <TutorialOverlay />
      <FullscreenPrompt />
    </>
  );
}
