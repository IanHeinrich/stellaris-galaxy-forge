export type Rand = () => number;

/** mulberry32: numbers in [0, 1), the same sequence for the same seed. */
export function seeded(seed: number): Rand {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for the generator or a brush stroke: a random whole number JSON carries exactly. */
export function newSeed(): number {
  const [high, low] = crypto.getRandomValues(new Uint32Array(2));
  return (high & 0x1fffff) * 0x100000000 + low;
}
