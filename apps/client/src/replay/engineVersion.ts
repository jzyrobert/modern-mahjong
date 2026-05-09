/**
 * Stamp recorded into every replay header so playback can warn the user
 * if a saved replay was recorded against a meaningfully different
 * engine version. Bump this when the engine's `Event` or `GameState`
 * shape changes in a way that would render older replays incorrectly.
 *
 * Workspace packages don't track meaningful semver (everything is
 * `0.0.0`), so we use an internal counter independent of npm versions.
 */
export const ENGINE_VERSION = '1';
