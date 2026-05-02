/** 32-bit random seed for kicking off a new hand on the server. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}
