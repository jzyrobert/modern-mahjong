#!/usr/bin/env bash
#
# android-lan-host-smoke.sh — drives the LAN-hosting flow on a booted
# AVD (or any connected adb device) and asserts the host actually
# reaches the pre-game lobby instead of bouncing back to the menu
# with a "Couldn't reach the match server" toast.
#
# This is the regression that was invisible to the unit tests in
# `packages/match-session/test/host-bridge.test.ts` because those
# use a mocked native module. The real failure mode (Android API 28+
# blocking cleartext WS to non-localhost addresses unless the
# manifest opts in) only shows up against the actual NanoHTTPD
# server + RN runtime, which is what this script exercises.
#
# Usage:
#   ./apps/client/scripts/android-lan-host-smoke.sh           # uses the most recent local APK
#   APK_PATH=path/to/foo.apk ./apps/client/scripts/...        # use a specific APK
#   BACKGROUND_SECONDS=… not used here; see android-lifecycle-smoke.sh
#
# Pre-reqs: an x86_64 release APK already built locally:
#   ANDROID_HOME=… ./gradlew :app:assembleRelease -PreactNativeArchitectures=x86_64
# and a booted device/AVD reachable via `adb`.
#
# Smoke artefacts (screenshots + UI dumps + logcat) land under
# `apps/client/lan-host-smoke/` so a failing CI / local run can be
# triaged after the fact.

set -euo pipefail

ADB="${ADB:-${ANDROID_HOME:-/home/ubuntu/Android/Sdk}/platform-tools/adb}"
PACKAGE_ID="${PACKAGE_ID:-com.modernmahjong.app}"
APK_PATH="${APK_PATH:-apps/client/android/app/build/outputs/apk/release/app-release.apk}"
OUT_DIR="apps/client/lan-host-smoke"

mkdir -p "$OUT_DIR"

echo "→ Wait for device"
"$ADB" wait-for-device

echo "→ Wait for boot_completed"
for _ in $(seq 1 120); do
  bc=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
  [ "$bc" = "1" ] && break
  sleep 2
done
[ "${bc:-}" = "1" ] || { echo "::error::AVD never reported sys.boot_completed=1"; exit 1; }

echo "→ Install $APK_PATH"
"$ADB" install -r -t "$APK_PATH"

# Helper: dump the current UI hierarchy and echo bounds for a node
# whose content-desc matches the given regex. Returns "x y" of the
# centre point on stdout, or exits non-zero if not found.
center_of() {
  local desc_regex="$1" xml="$OUT_DIR/.dump.xml"
  "$ADB" shell uiautomator dump /sdcard/.dump.xml >/dev/null
  "$ADB" pull /sdcard/.dump.xml "$xml" >/dev/null 2>&1
  local m
  m=$(grep -oE "content-desc=\"$desc_regex\"[^>]*bounds=\"\\[[0-9]+,[0-9]+\\]\\[[0-9]+,[0-9]+\\]\"" "$xml" | head -1 || true)
  [ -n "$m" ] || return 1
  echo "$m" | sed -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/' | \
    awk '{ printf "%d %d\n", ($1+$3)/2, ($2+$4)/2 }'
}

tap_center() {
  local desc="$1" coords
  coords=$(center_of "$desc") || { echo "::error::Could not find '$desc' in UI tree"; return 1; }
  echo "  tap $desc at $coords"
  "$ADB" shell input tap $coords
}

"$ADB" logcat -c

echo "→ Launch $PACKAGE_ID"
"$ADB" shell monkey -p "$PACKAGE_ID" -c android.intent.category.LAUNCHER 1 >/dev/null

# Give Hermes time to evaluate the bundle + render the lobby.
sleep 12
"$ADB" shell screencap -p /sdcard/01.png
"$ADB" pull /sdcard/01.png "$OUT_DIR/01-lobby.png" >/dev/null

# The LAN card lives below the fold. The lobby has grown over time
# (5 tutorial rows + a Replays card before the LAN card) so a fixed
# scroll count is fragile — instead, scroll a few times and bail out
# of the loop as soon as "Host LAN match"'s bounds resolve to a real
# coordinate. uiautomator reports `[0,0][0,0]` for off-screen Views,
# so without this check `tap` would click the screen corner and the
# downstream assertion would fail waiting for a /match navigation
# that never happened.
echo "→ Scrolling until 'Host LAN match' is reachable"
for attempt in 1 2 3 4 5 6; do
  coords=$(center_of "Host LAN match" 2>/dev/null || true)
  read -r cx cy <<<"$coords"
  if [ -n "${cx:-}" ] && [ -n "${cy:-}" ] && [ "$cx" -gt 0 ] && [ "$cy" -gt 0 ]; then
    echo "  reachable at $coords after $((attempt - 1)) scroll(s)"
    break
  fi
  "$ADB" shell input swipe 540 1500 540 500 600
  sleep 1
done

echo "→ Tap 'Host LAN match'"
tap_center "Host LAN match"

# Status flow: tap → onHostLan() starts the embedded server, wires
# the in-process MatchSession bridge, advertises on mDNS, and calls
# `transport.joinLan` — which navigates to /match and lands the host
# in the pre-game waiting room (header reads "Lobby"). On failure,
# `hostStatus` surfaces an inline error blurb under the button on
# the menu screen ("Couldn't start the embedded server: …" or "No
# LAN address found — are you on Wi-Fi?"); we treat both as fast-
# fail signals so the smoke doesn't burn its 30s budget waiting for
# a navigation that won't happen. We re-poll the UI tree instead of
# trusting a fixed sleep so the script doesn't flake on slow
# runners (TCG-emulated AVDs land in ~10s; KVM-accelerated hosts
# under 2s).
echo "→ Waiting for the pre-game waiting room"
ok=""
for i in $(seq 1 30); do
  sleep 1
  "$ADB" shell uiautomator dump /sdcard/p.xml >/dev/null 2>&1 || continue
  "$ADB" pull /sdcard/p.xml "$OUT_DIR/post.xml" >/dev/null 2>&1
  if grep -q 'text="Lobby"' "$OUT_DIR/post.xml"; then ok="lobby"; break; fi
  if grep -q "Couldn.t start the embedded server" "$OUT_DIR/post.xml"; then ok="server-fail"; break; fi
  if grep -q "No LAN address found" "$OUT_DIR/post.xml"; then ok="no-lan"; break; fi
done

"$ADB" shell screencap -p /sdcard/03.png
"$ADB" pull /sdcard/03.png "$OUT_DIR/03-after-host.png" >/dev/null
"$ADB" logcat -d > "$OUT_DIR/post-host.log"

case "${ok:-}" in
  lobby)
    echo "LAN host smoke OK — host reached the pre-game waiting room"
    exit 0
    ;;
  server-fail)
    echo "::error::Host saw 'Couldn't start the embedded server' instead of the pre-game waiting room"
    exit 1
    ;;
  no-lan)
    echo "::error::Host saw 'No LAN address found' — emulator/device is not on Wi-Fi"
    exit 1
    ;;
  *)
    echo "::error::Neither the waiting room nor an inline error appeared within 30s"
    exit 1
    ;;
esac
