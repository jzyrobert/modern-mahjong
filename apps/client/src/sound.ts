import { type AudioPlayer, createAudioPlayer } from 'expo-audio';
import { useGame } from './state/game';

/**
 * Tiny SFX layer over `expo-audio`. We expose three cue families plus a
 * shuffle controller:
 *
 *   - `playTileClick()`  — random `mahjong_tile_*.mp3`. Fired on every
 *     discard and on a successful chi/peng/gang claim (the wooden
 *     "clack" of a tile landing).
 *   - `playDiceRoll()`   — random `roll_two_dice_*.mp3`. Fired when the
 *     opening-rolls dice ceremony surfaces at the start of a hand.
 *   - `startShuffle()`   — random 2 s slice of
 *     `shuffle_the_mahjong_tiles.mp3` with a short fade in + fade out,
 *     for the between-hand shuffle ceremony. Returns a `stop()` that
 *     fades out the slice early (e.g. if the overlay unmounts before
 *     the 2 s elapses).
 *
 * Every call gates on `useGame.settings.sound` and swallows playback
 * errors — autoplay can block before a user gesture, and unit-test
 * envs (vitest jsdom) don't ship a working web audio path.
 *
 * Players are pooled per source: we `createAudioPlayer(require(...))`
 * once on first cue and reuse the instance for every subsequent play,
 * seeking back to 0 each time. That keeps decoded buffers warm so
 * rapid discards don't pay the decode/network round-trip on every
 * tap.
 */

// `require(...)` returns the Metro asset id (number) for bundled
// audio. Three lists so we can pick a random variant per cue without
// the pools colliding.
const TILE_SOURCES: number[] = [
  require('../assets/sounds/mahjong_tile_1.mp3'),
  require('../assets/sounds/mahjong_tile_2.mp3'),
  require('../assets/sounds/mahjong_tile_3.mp3'),
  require('../assets/sounds/mahjong_tile_4.mp3'),
];

const DICE_SOURCES: number[] = [
  require('../assets/sounds/roll_two_dice_1.mp3'),
  require('../assets/sounds/roll_two_dice_2.mp3'),
  require('../assets/sounds/roll_two_dice_3.mp3'),
];

const SHUFFLE_SOURCE: number = require('../assets/sounds/shuffle_the_mahjong_tiles.mp3');

const SHUFFLE_SLICE_MS = 2000;
const SHUFFLE_FADE_MS = 200;
const SHUFFLE_VOLUME = 0.6;

function soundEnabled(): boolean {
  return useGame.getState().settings.sound;
}

function safePause(player: AudioPlayer): void {
  try {
    player.pause();
  } catch {
    /* player removed mid-flight — silent skip */
  }
}

function getOrCreatePlayer(pool: Map<number, AudioPlayer>, source: number): AudioPlayer | null {
  const existing = pool.get(source);
  if (existing) return existing;
  try {
    const player = createAudioPlayer(source);
    pool.set(source, player);
    return player;
  } catch {
    // expo-audio is unavailable (vitest jsdom, or a misconfigured
    // build). Silently skip — callers don't need to branch.
    return null;
  }
}

const oneShotPool = new Map<number, AudioPlayer>();

// Eagerly warm up the tile-clack players. Discard is the latency-
// sensitive cue — paying the native player construction + decode on
// the first user tap reads as a stutter. The other pools (dice,
// shuffle) stay lazy because they only fire at hand boundaries.
for (const src of TILE_SOURCES) getOrCreatePlayer(oneShotPool, src);

function playOneShot(sources: number[], volume = 1): void {
  if (!soundEnabled()) return;
  const pick = sources[Math.floor(Math.random() * sources.length)];
  if (pick === undefined) return;
  const player = getOrCreatePlayer(oneShotPool, pick);
  if (!player) return;
  try {
    player.volume = volume;
    // Seeking restarts the clip even when the previous play() hasn't
    // finished — important for rapid back-to-back discards or a
    // chi/peng claim that fires inside the same tick as the discard.
    player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    /* autoplay block / disposed player — silent skip */
  }
}

export function playTileClick(): void {
  playOneShot(TILE_SOURCES);
}

export function playDiceRoll(): void {
  // Dice clips are noticeably louder than the tile clacks in the
  // packs we shipped; pull them down a notch so the ceremony doesn't
  // peak the output before the cleaner clack lands.
  playOneShot(DICE_SOURCES, 0.7);
}

let shufflePlayer: AudioPlayer | null = null;
// Generation token so a `stop()` closure handed back to an old caller
// can't yank the volume on a fresh slice. Bumped on every
// `startShuffle()`; each ramp / pause timer captures its own
// generation and bails if the global has moved on.
let shuffleGen = 0;

function rampVolume(
  player: AudioPlayer,
  from: number,
  to: number,
  durationMs: number,
  gen: number,
  timers: ReturnType<typeof setTimeout>[],
): void {
  // Manual ramp — `expo-audio` exposes `volume` as a plain setter but
  // doesn't bundle a tween primitive. 8 steps over 200 ms is smooth
  // enough for a fade without flooding the bridge on native.
  const steps = 8;
  const stepMs = Math.max(1, Math.floor(durationMs / steps));
  for (let i = 1; i <= steps; i++) {
    const v = from + ((to - from) * i) / steps;
    const t = setTimeout(() => {
      if (gen !== shuffleGen) return;
      try {
        player.volume = v;
      } catch {
        /* player removed mid-ramp — silent skip */
      }
    }, stepMs * i);
    timers.push(t);
  }
}

/**
 * Begin a faded-in 2 s slice of the shuffle clip starting at a random
 * offset, and return a `stop()` to abort early with a fade-out. Calling
 * `stop()` after the slice has already retired is a no-op. Re-entrant —
 * a second `startShuffle()` cancels the in-flight slice; the prior
 * `stop()` handle becomes inert.
 */
export function startShuffle(): () => void {
  if (!soundEnabled()) return () => {};
  if (!shufflePlayer) {
    try {
      shufflePlayer = createAudioPlayer(SHUFFLE_SOURCE);
    } catch {
      return () => {};
    }
  }
  const player = shufflePlayer;
  const gen = ++shuffleGen;
  const timers: ReturnType<typeof setTimeout>[] = [];

  // The clip is ~10 s in the pack we shipped, but `player.duration`
  // is 0 until the metadata loads. Fall back to a known-safe slice
  // window if we got here before the load completed; the next call
  // will see a real duration and pick a true random offset.
  const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 8;
  const sliceSec = SHUFFLE_SLICE_MS / 1000;
  const maxOffset = Math.max(0, duration - sliceSec);
  const offset = Math.random() * maxOffset;

  try {
    player.volume = 0;
    player.seekTo(offset).catch(() => {});
    player.play();
  } catch {
    return () => {};
  }
  rampVolume(player, 0, SHUFFLE_VOLUME, SHUFFLE_FADE_MS, gen, timers);

  const fadeOutAt = SHUFFLE_SLICE_MS - SHUFFLE_FADE_MS;
  timers.push(
    setTimeout(() => {
      if (gen !== shuffleGen) return;
      rampVolume(player, SHUFFLE_VOLUME, 0, SHUFFLE_FADE_MS, gen, timers);
    }, fadeOutAt),
  );
  timers.push(
    setTimeout(() => {
      if (gen !== shuffleGen) return;
      safePause(player);
    }, SHUFFLE_SLICE_MS),
  );

  let stopped = false;
  return () => {
    if (stopped || gen !== shuffleGen) return;
    stopped = true;
    for (const t of timers) clearTimeout(t);
    rampVolume(player, player.volume, 0, SHUFFLE_FADE_MS, gen, timers);
    timers.push(
      setTimeout(() => {
        if (gen !== shuffleGen) return;
        safePause(player);
      }, SHUFFLE_FADE_MS),
    );
  };
}
