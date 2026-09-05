import '@/src/polyfills';

import { TransportProvider } from '@/src/net/transport-context';
import { useGame } from '@/src/state/game';
import { resolveRenderer } from '@/src/three/renderer';
import { DiceCeremony } from '@/src/ui/DiceCeremony';
import { FlipBagProvider } from '@/src/ui/FlipBag';
import { FullscreenPrompt } from '@/src/ui/FullscreenPrompt';
import { ShuffleOverlay } from '@/src/ui/ShuffleOverlay';
import { WinCelebration } from '@/src/ui/WinCelebration';
import { type PageChrome, pageChrome, pageSurface } from '@/src/ui/menu/theme';
import { TargetRegistryProvider } from '@/src/ui/tutorial/TargetRegistry';
import { TutorialOverlay } from '@/src/ui/tutorial/TutorialOverlay';
import { useIsHydrated } from '@/src/ui/useIsHydrated';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * Root layout. Mounts the providers every screen needs:
 * - `@/src/polyfills` (platform-split): on native, pulls in
 *   `expo-sqlite/localStorage/install` so the existing localStorage
 *   calls in `identity.ts` and `state/game.ts` survive WebView wipes /
 *   reinstalls. On web, no-ops.
 * - `SafeAreaProvider`: shared safe-area insets for all screens.
 * - `StatusBar` + the page chrome (`usePageChrome`): light on the 3D
 *   flow's void, dark on the classic shells' cream.
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
  const chrome = usePageChrome();
  return (
    <View style={{ flex: 1 }}>
      <SafeAreaProvider>
        <TransportProvider>
          <FlipBagProvider>
            <TargetRegistryProvider>
              <StatusBar style={chrome.statusBar} backgroundColor={chrome.background} />
              <RouteTree chrome={chrome} />
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
 * So the static HTML carries a deterministic shell for the screen area
 * in the 3D flow's void colour (the same colour `+html.tsx` paints
 * behind the app, so nothing flashes — 3D is the web default wherever
 * WebGL2 exists, and the classic renderer swaps the page to cream right
 * after hydration), and the real tree mounts right after hydration —
 * the same client-side mount the routes always had, minus the error.
 * Native and non-SSR client renders skip the shell entirely because
 * `useIsHydrated` is `true` on their first render.
 */
function RouteTree({ chrome }: { chrome: PageChrome }) {
  const hydrated = useIsHydrated();
  if (!hydrated) return <View style={{ flex: 1, backgroundColor: STATIC_CHROME.background }} />;
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: chrome.background },
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

/**
 * What the static render assumes before it can know the renderer: the
 * void every menu surface paints. `+html.tsx` paints html / body the
 * same colour, so the pre-hydration shell, the document behind it and
 * the first frame of the lobby are one surface.
 */
const STATIC_CHROME = pageChrome('menu', '3d');

/**
 * Page chrome for the current route — the colour behind the app root
 * and the matching status-bar style. Everything outside the app's root
 * `View` is painted by the browser from `html` / `body`, so on Android
 * Chrome the strip a retracting URL bar exposes under the lobby (and
 * any overscroll) shows *this* colour: the parlour void for the lobby
 * and the replay routes under either renderer, and for the match only
 * the classic shells' cream (`pageChrome`).
 *
 * The renderer resolves at runtime (persisted setting + WebGL2), which
 * the static render cannot know: the hydration render returns the
 * static default so the pre-rendered tree matches, and the DOM styles
 * (html / body background, the theme-color meta) are applied in an
 * effect — never during render — so nothing here can mismatch.
 */
function usePageChrome(): PageChrome {
  const hydrated = useIsHydrated();
  const setting = useGame((s) => s.settings.renderer);
  const pathname = usePathname();
  const chrome = hydrated
    ? pageChrome(pageSurface(pathname), resolveRenderer(setting))
    : STATIC_CHROME;
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.backgroundColor = chrome.background;
    document.body.style.backgroundColor = chrome.background;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', chrome.background);
  }, [chrome.background]);
  return chrome;
}
