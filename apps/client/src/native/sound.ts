/**
 * Tiny synthesized-tone helpers. Used to give the table audio feedback
 * (discard thuds, win fanfare) without shipping audio assets.
 *
 * Gated on `useGame.settings.sound` (off by default — toggleable in
 * SettingsPanel) AND `useGame.settings.animations` (so the user's
 * reduced-motion preference also suppresses sound). Lazy-creates a
 * single AudioContext on the first attempt — Safari + Chrome both
 * suspend the context until the first user gesture, so the click that
 * actually triggers the first sound also unlocks playback.
 */

import { useGame } from '../state/game.js';

type AudioContextCtor = typeof AudioContext;

declare global {
  interface Window {
    webkitAudioContext?: AudioContextCtor;
  }
}

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }
  const Ctor: AudioContextCtor | undefined =
    typeof window.AudioContext !== 'undefined' ? window.AudioContext : window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function soundEnabled(): boolean {
  const { sound, animations } = useGame.getState().settings;
  return sound && animations;
}

interface ToneSpec {
  freq: number;
  /** Linear-ramp end frequency; same as `freq` if omitted. */
  endFreq?: number;
  /** Peak gain (clamped 0..0.5 to keep it polite). */
  gain?: number;
  /** Duration in seconds. */
  duration: number;
  /** Tone shape — sine is bell-like, triangle is softer-percussive. */
  type?: OscillatorType;
  /** Optional delay before the tone starts (for chords / arpeggios). */
  startOffset?: number;
}

function playTone(spec: ToneSpec): void {
  const audio = ensureCtx();
  if (!audio) return;
  const start = audio.currentTime + (spec.startOffset ?? 0);
  const end = start + spec.duration;
  const peak = Math.min(0.5, spec.gain ?? 0.15);

  const osc = audio.createOscillator();
  osc.type = spec.type ?? 'sine';
  osc.frequency.setValueAtTime(spec.freq, start);
  if (spec.endFreq !== undefined) {
    osc.frequency.linearRampToValueAtTime(spec.endFreq, end);
  }

  const gain = audio.createGain();
  // ADSR-ish envelope: 8ms attack, exponential decay to silence by end.
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + Math.min(0.008, spec.duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

/** Soft tap — fires on local tile selection / drag pickups. */
export function playClick(): void {
  if (!soundEnabled()) return;
  playTone({ freq: 880, endFreq: 660, gain: 0.08, duration: 0.05, type: 'sine' });
}

/** Tile-on-felt thud — fires on every `discarded` engine event. */
export function playDiscard(): void {
  if (!soundEnabled()) return;
  playTone({ freq: 240, endFreq: 140, gain: 0.18, duration: 0.13, type: 'triangle' });
}

/** Short C-major arpeggio — fires on `state.lastResult.kind === 'win'`. */
export function playWinFanfare(): void {
  if (!soundEnabled()) return;
  // C5, E5, G5, C6 — bell-like.
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    playTone({ freq, gain: 0.18, duration: 0.5, type: 'sine', startOffset: i * 0.12 });
  });
}
