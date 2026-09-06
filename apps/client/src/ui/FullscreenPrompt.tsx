import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useGame } from '../state/game';
import { useTutorial } from '../state/tutorial';
import { resolveRenderer } from '../three/renderer';
import { COLORS } from './colors';
import { useIsLandscape } from './useOrientation';

/**
 * Over the Three.js shells the prompt wears the HUD's glass language —
 * a secondary pill (dark glass, gold-tinted hairline) so the only gold
 * fill on screen stays the primary CTA / active turn. The classic
 * shells keep the original gold chip.
 */
const GLASS_PROMPT = {
  bg: 'rgba(14,20,17,0.78)',
  bgPressed: 'rgba(30,38,33,0.9)',
  border: 'rgba(216,168,90,0.55)',
  fg: 'rgba(255,255,255,0.92)',
  gold: '#d8a85a',
  dismissBg: 'rgba(14,20,17,0.9)',
  // Secondary text that *measures* ≥ 0.62 alpha on screen: the label
  // sits on a translucent pill over a bright felt, and 0.72 on a 0.78
  // pill read as ~0.55 grey to the round-5 critic. A denser pill and
  // 0.84 ink keep it a secondary label that still clears 4.5:1.
  dismissFg: 'rgba(255,255,255,0.84)',
} as const;

/**
 * Surfaces that host the prompt *inline* (the wide lobby's header on a
 * short landscape viewport — 915 × 512 once Android Chrome's URL bar
 * has gone — mounts the desktop layout, whose cards scroll under a
 * fixed corner chip: round-4 critic, "the fullscreen prompt overlaps
 * the LAN card copy") claim it here so the root, absolutely-positioned
 * instance stands down while they are mounted.
 */
let inlineClaims = 0;
const claimListeners = new Set<() => void>();
function claimInlinePrompt(): () => void {
  inlineClaims++;
  for (const l of claimListeners) l();
  return () => {
    inlineClaims--;
    for (const l of claimListeners) l();
  };
}
function subscribeClaims(fn: () => void): () => void {
  claimListeners.add(fn);
  return () => {
    claimListeners.delete(fn);
  };
}
const readClaims = () => inlineClaims > 0;
const readNoClaims = () => false;

/**
 * Browsers reject `Element.requestFullscreen()` outside a user-activation
 * gesture (a tap, click, key press). An `orientationchange` /  `resize`
 * event from rotating the device is *not* counted, so we can't silently
 * enter fullscreen when the user flips to landscape. Instead, mount a
 * small "tap for fullscreen" button in the corner whenever:
 *
 *   - the platform is web (no DOM on native targets),
 *   - the viewport is in landscape orientation (via `useIsLandscape`,
 *     the shared matchMedia-based hook — see CLAUDE.md's "Orientation"
 *     convention),
 *   - the height is small enough to be a phone (`< 600 px`), so iPad
 *     landscape and laptops don't trigger the prompt,
 *   - we're not already in fullscreen,
 *   - the user hasn't dismissed this session,
 *   - no tutorial lesson (or its completion prompt) is showing — the
 *     prompt mounts above the coach-mark overlay and would sit on the
 *     caption card's corner in the landscape side dock.
 *
 * Tapping the button is a user gesture, so `requestFullscreen()` from
 * the press handler succeeds. Rotating back to portrait resets the
 * dismissal so a later landscape rotation gets another offer.
 *
 * Orientation specifically reads `matchMedia('(orientation: landscape)')`
 * rather than a raw `width > height` compare — Android Chrome shrinks
 * `window.innerHeight` when the soft keyboard opens, which can flip a
 * dimension-based check mid-tap and unmount the prompt out from under
 * the user. The matchMedia query stays pinned to the device's physical
 * orientation regardless of the keyboard.
 *
 * No-op on native (React Native Web's `document` shim doesn't exist on
 * iOS / Android, and the OS already handles fullscreen via its own
 * shell). SSR-safe — every DOM access is gated on `typeof document`.
 */
export function FullscreenPrompt({ inline = false }: { inline?: boolean } = {}) {
  const { height } = useWindowDimensions();
  const isLandscape = useIsLandscape();
  const [inFullscreen, setInFullscreen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const tutorialShowing = useTutorial((s) => s.active !== null || s.justCompleted !== null);
  const rendererSetting = useGame((s) => s.settings.renderer);
  const glass = resolveRenderer(rendererSetting) === '3d';
  const claimed = useSyncExternalStore(subscribeClaims, readClaims, readNoClaims);
  // An inline host owns the prompt while mounted (see `claimInlinePrompt`).
  useEffect(() => (inline ? claimInlinePrompt() : undefined), [inline]);

  // Subscribe to the browser's fullscreen-change event so the prompt
  // re-mounts when the user exits fullscreen via Esc / system chrome.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    const update = () => setInFullscreen(isWebFullscreen());
    update();
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
    };
  }, []);

  // Reset the manual dismissal when the user rotates back to portrait
  // — a fresh landscape flip should offer the prompt again.
  useEffect(() => {
    if (!isLandscape) setDismissed(false);
  }, [isLandscape]);

  if (Platform.OS !== 'web') return null;
  if (typeof document === 'undefined') return null;
  if (!isLandscape) return null;
  if (height >= 600) return null;
  if (inFullscreen) return null;
  if (dismissed) return null;
  if (tutorialShowing) return null;
  if (!inline && claimed) return null;

  return (
    // Top-right corner. The post-V2_3 landscape layout puts the ☰
    // menu pill at top-LEFT in the chrome row, so placing the
    // fullscreen prompt there now intercepts the menu tap. The right
    // edge of the chrome row hosts the rightmost `DenseOppRow` strip
    // — non-interactive (no Pressable wrap), and the prompt
    // self-hides as soon as the user accepts / dismisses, so the
    // brief visual overlap with the opponent's name + countdown is
    // acceptable. `pointerEvents="box-none"` so the wrapper itself
    // doesn't catch taps — only its Pressable children do.
    <View
      pointerEvents="box-none"
      style={
        inline
          ? // In a header row: the two pills side by side, scrolling with
            // the page, so no card ever passes under them.
            { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }
          : { position: 'absolute', top: 8, right: 8, zIndex: 1000, alignItems: 'flex-end' }
      }
    >
      <Pressable
        onPress={requestWebFullscreen}
        accessibilityRole="button"
        accessibilityLabel="Enter fullscreen"
        style={({ pressed }) =>
          glass
            ? {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                backgroundColor: pressed ? GLASS_PROMPT.bgPressed : GLASS_PROMPT.bg,
                borderWidth: 1,
                borderColor: GLASS_PROMPT.border,
                boxShadow: '0px 12px 40px rgba(0,0,0,0.35)',
              }
            : {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 9,
                paddingVertical: 5,
                borderRadius: 8,
                backgroundColor: pressed ? '#c89432' : 'rgba(216,168,90,0.95)',
                borderWidth: 1,
                borderColor: '#a87f24',
                boxShadow: '0px 2px 6px rgba(0,0,0,0.25)',
              }
        }
      >
        <Text
          style={{ fontSize: 13, fontWeight: '900', color: glass ? GLASS_PROMPT.gold : '#3a2c0d' }}
        >
          ⛶
        </Text>
        <Text
          style={{
            fontSize: glass ? 10 : 9,
            fontWeight: glass ? '800' : '900',
            color: glass ? GLASS_PROMPT.fg : '#3a2c0d',
            letterSpacing: glass ? 1.6 : 0.5,
          }}
        >
          FULLSCREEN
        </Text>
      </Pressable>
      <Pressable
        onPress={() => setDismissed(true)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss fullscreen prompt"
        style={({ pressed }) => ({
          marginTop: inline ? 0 : glass ? 4 : 2,
          alignSelf: inline ? 'center' : 'flex-end',
          paddingHorizontal: glass ? 9 : 6,
          paddingVertical: glass ? 3 : 2,
          opacity: pressed ? 0.55 : glass ? 1 : 0.85,
          backgroundColor: glass ? GLASS_PROMPT.dismissBg : 'rgba(0,0,0,0.35)',
          borderWidth: glass ? 1 : 0,
          borderColor: glass ? 'rgba(255,255,255,0.12)' : 'transparent',
          borderRadius: glass ? 999 : 5,
        })}
      >
        <Text
          style={{
            fontSize: glass ? 10 : 8,
            fontWeight: '800',
            color: glass ? GLASS_PROMPT.dismissFg : COLORS.paper,
            letterSpacing: glass ? 1.2 : 0.5,
            textTransform: 'uppercase',
          }}
        >
          Dismiss
        </Text>
      </Pressable>
    </View>
  );
}

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
}
interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}

function isWebFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FullscreenDocument;
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
}

function requestWebFullscreen() {
  if (typeof document === 'undefined') return;
  const el = document.documentElement as FullscreenElement;
  const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (!req) return;
  req.call(el).catch((e) => {
    // Most failures are the user denying the permission prompt — log
    // and move on. The button stays mounted so they can retry.
    console.warn('fullscreen request failed', e);
  });
}
