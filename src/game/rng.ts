export type Rng = () => number;

/**
 * Deterministic seeded PRNG (mulberry32). Returns a function producing
 * floats in [0, 1) — same seed always produces the same sequence, on any
 * client. This is what replaces Math.random() everywhere in game logic;
 * see mapGenerator.ts and influence.ts.
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derives a new integer seed from a base seed plus an arbitrary string, so
 * different parts of the sim (e.g. each player's spread on a given turn)
 * get independent-looking RNG streams without reusing the same sequence
 * or needing their own entropy source.
 */
export function deriveSeed(baseSeed: number, salt: string): number {
  let h = baseSeed >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h = Math.imul(h ^ salt.charCodeAt(i), 2654435761);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
