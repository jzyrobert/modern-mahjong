/**
 * Sound-effect call sites land here. The legacy build synthesised
 * audio with the Web Audio API, which doesn't translate cleanly to
 * RN — re-implementing on top of `expo-audio` (with a tiny bundled
 * .wav per cue) is queued behind the more impactful UX work, and
 * the engine is callable without it. For now this is a documented
 * no-op so the orchestrator can fire the calls without crashing or
 * branching on a feature flag.
 *
 * Currently the only live caller is `playDiscard()` in
 * `net/transport-context.tsx` (fired on every `discarded` engine
 * event). The other cues from the legacy build (click / win
 * fanfare) had no remaining callers and were dropped — re-add an
 * export when something needs them.
 */

export function playDiscard(): void {
  // No-op until expo-audio cues land.
}
