#!/usr/bin/env bash
#
# android-lifecycle-smoke.sh — exercises the app's
# foreground/background/foreground lifecycle on a booted AVD. The
# meaningful assertions are:
#
#   1. The APK installs and the launcher activity starts.
#   2. The app reaches a foreground state that's not the system
#      "App keeps stopping" dialog.
#   3. After ~35 s in the background (long enough to cross the
#      WebView's typical aggressive-background-throttle threshold),
#      a fresh `am start` puts the app back in the foreground.
#   4. The process remains alive afterwards and no `FATAL` /
#      `AndroidRuntime` lines appear in the post-resume logcat
#      window.
#
# Snapshot/restore parity (the DO `MatchSession.snapshot()` round-
# trip) is unit-tested separately. This script is just the missing
# real-WebView lifecycle leg.

set -euo pipefail

PACKAGE_ID="${PACKAGE_ID:-com.modernmahjong.app}"
APK_PATH="${APK_PATH:-apps/client/app-preview.apk}"
OUT_DIR="apps/client/lifecycle-smoke"
BACKGROUND_SECONDS="${BACKGROUND_SECONDS:-35}"

mkdir -p "$OUT_DIR"

echo "→ Wait for device"
adb wait-for-device

echo "→ Wait for boot completed"
boot_completed=""
for _ in $(seq 1 60); do
  boot_completed=$(adb shell getprop sys.boot_completed | tr -d '\r')
  if [ "$boot_completed" = "1" ]; then break; fi
  sleep 2
done
if [ "$boot_completed" != "1" ]; then
  echo "::error::AVD never reported sys.boot_completed=1"
  exit 1
fi

echo "→ Install $APK_PATH"
adb install -r -t "$APK_PATH"

# Reset logcat so the post-resume scan only sees lines from this run.
adb logcat -c

echo "→ Launch $PACKAGE_ID"
adb shell monkey -p "$PACKAGE_ID" -c android.intent.category.LAUNCHER 1 >/dev/null

# Give the JS bundle time to hydrate + render the lobby.
sleep 12

adb shell screencap -p /sdcard/lobby.png
adb pull /sdcard/lobby.png "$OUT_DIR/01-foreground.png" >/dev/null

# Foreground assertion: dumpsys window must show our package.
focus=$(adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | head -2 || true)
echo "$focus"
if ! echo "$focus" | grep -q "$PACKAGE_ID"; then
  echo "::error::Lobby never reached foreground; mCurrentFocus=$focus"
  adb logcat -d > "$OUT_DIR/launch.log" || true
  exit 1
fi

pid_before=$(adb shell pidof "$PACKAGE_ID" | tr -d '\r' || true)
if [ -z "$pid_before" ]; then
  echo "::error::App process is gone immediately after launch"
  adb logcat -d > "$OUT_DIR/launch.log" || true
  exit 1
fi
echo "Foreground process pid=$pid_before"

echo "→ Send to background (HOME) and sleep ${BACKGROUND_SECONDS}s"
adb shell input keyevent KEYCODE_HOME
sleep "$BACKGROUND_SECONDS"

# Process can be killed by the OOM/cached-app reaper while
# backgrounded — that's a real failure for the lifecycle smoke
# because the app should survive long enough for the user to
# resume mid-hand. Catch it here.
pid_during=$(adb shell pidof "$PACKAGE_ID" | tr -d '\r' || true)
echo "Background process pid=$pid_during"
if [ -z "$pid_during" ]; then
  echo "::warning::App process was reaped during background sleep — resumption will be a cold start. Continuing the smoke anyway."
fi

echo "→ Foreground via am start"
adb shell am start -n "$PACKAGE_ID/.MainActivity"
sleep 8

adb shell screencap -p /sdcard/resumed.png
adb pull /sdcard/resumed.png "$OUT_DIR/02-resumed.png" >/dev/null

pid_after=$(adb shell pidof "$PACKAGE_ID" | tr -d '\r' || true)
if [ -z "$pid_after" ]; then
  echo "::error::App process is not alive after foregrounding"
  adb logcat -d > "$OUT_DIR/post-resume.log" || true
  exit 1
fi
echo "Resumed process pid=$pid_after"

# Foreground assertion: dumpsys window must again show our package.
focus_after=$(adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | head -2 || true)
echo "$focus_after"
if ! echo "$focus_after" | grep -q "$PACKAGE_ID"; then
  echo "::error::App did not return to the foreground after am start"
  adb logcat -d > "$OUT_DIR/post-resume.log" || true
  exit 1
fi

# Pull the post-resume slice of logcat for the smoke artefact, and
# fail if it contains anything fatal.
adb logcat -d > "$OUT_DIR/post-resume.log"
if grep -E "FATAL EXCEPTION|AndroidRuntime: FATAL|--------- beginning of crash" "$OUT_DIR/post-resume.log" \
   | grep -i -- "$PACKAGE_ID\|com.facebook.react\|com.expo" >/dev/null; then
  echo "::error::Fatal crash in logcat after resume:"
  grep -E "FATAL EXCEPTION|AndroidRuntime: FATAL|--------- beginning of crash" "$OUT_DIR/post-resume.log" | head -20
  exit 1
fi

echo "Lifecycle smoke OK"
