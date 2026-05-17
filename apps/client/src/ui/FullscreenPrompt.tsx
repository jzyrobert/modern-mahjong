import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { COLORS } from './colors';

/**
 * Browsers reject `Element.requestFullscreen()` outside a user-activation
 * gesture (a tap, click, key press). An `orientationchange` /  `resize`
 * event from rotating the device is *not* counted, so we can't silently
 * enter fullscreen when the user flips to landscape. Instead, mount a
 * small "tap for fullscreen" button in the corner whenever:
 *
 *   - the platform is web (no DOM on native targets),
 *   - the viewport is in landscape orientation (`width > height`),
 *   - the height is small enough to be a phone (`< 600 px`), so iPad
 *     landscape and laptops don't trigger the prompt,
 *   - we're not already in fullscreen,
 *   - the user hasn't dismissed this session.
 *
 * Tapping the button is a user gesture, so `requestFullscreen()` from
 * the press handler succeeds. Rotating back to portrait resets the
 * dismissal so a later landscape rotation gets another offer.
 *
 * No-op on native (React Native Web's `document` shim doesn't exist on
 * iOS / Android, and the OS already handles fullscreen via its own
 * shell). SSR-safe — every DOM access is gated on `typeof document`.
 */
export function FullscreenPrompt() {
  const { width, height } = useWindowDimensions();
  const [inFullscreen, setInFullscreen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

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
    if (height >= width) setDismissed(false);
  }, [width, height]);

  if (Platform.OS !== 'web') return null;
  if (typeof document === 'undefined') return null;
  if (width <= height) return null;
  if (height >= 600) return null;
  if (inFullscreen) return null;
  if (dismissed) return null;

  return (
    // Bottom-left, below the bot-columns / discard area and to the
    // left of the centred hand. Top-right would overlap the ☰ menu
    // pill inside the rail's status card; left and right of centre
    // along the top overlap the bot columns. The bottom-left corner
    // of the bottom band is reliably empty felt regardless of which
    // seat is active, so the prompt never intercepts a tap meant
    // for a button. `pointerEvents="box-none"` so the wrapper itself
    // doesn't catch taps — only its Pressable children do.
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 1000, alignItems: 'flex-start' }}
    >
      <Pressable
        onPress={requestWebFullscreen}
        accessibilityRole="button"
        accessibilityLabel="Enter fullscreen"
        style={({ pressed }) => ({
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
        })}
      >
        <Text style={{ fontSize: 13, fontWeight: '900', color: '#3a2c0d' }}>⛶</Text>
        <Text style={{ fontSize: 9, fontWeight: '900', color: '#3a2c0d', letterSpacing: 0.5 }}>
          FULLSCREEN
        </Text>
      </Pressable>
      <Pressable
        onPress={() => setDismissed(true)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss fullscreen prompt"
        style={({ pressed }) => ({
          marginTop: 2,
          alignSelf: 'flex-start',
          paddingHorizontal: 6,
          paddingVertical: 2,
          opacity: pressed ? 0.55 : 0.85,
          backgroundColor: 'rgba(0,0,0,0.35)',
          borderRadius: 5,
        })}
      >
        <Text
          style={{
            fontSize: 8,
            fontWeight: '800',
            color: COLORS.paper,
            letterSpacing: 0.5,
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
