// Native bundle: pull in expo-sqlite's `localStorage` polyfill so the
// existing localStorage-backed code paths in `identity.ts` and
// `state/game.ts` work on iOS/Android, where the WebView doesn't ship a
// durable `localStorage`. Web has native `localStorage` so the `.web.ts`
// sibling intentionally no-ops to keep `expo-sqlite/web/worker.ts`
// (and its `.wasm` asset) out of the web bundle.
import 'expo-sqlite/localStorage/install';
