/**
 * Mulberry32: small, fast, deterministic PRNG. Good enough for shuffling
 * a 136-tile wall — we don't need cryptographic strength, but we do need
 * exact reproducibility from a single 32-bit seed.
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher–Yates shuffle driven by a seeded PRNG. Returns the array for chaining. */
export function shuffle<T>(arr: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

/** Roll a pair of d6 deterministically from a seed and salt. */
export function rollDice(seed: number, salt: number): [number, number] {
  const rand = mulberry32((seed ^ (salt * 0x9e3779b1)) >>> 0);
  return [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)];
}
