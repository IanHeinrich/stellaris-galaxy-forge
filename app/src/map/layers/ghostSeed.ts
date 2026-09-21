/** A tiny deterministic generator: the same seed always yields the same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spreads an id's bits before it seeds the generator, so consecutive ids do not draw alike. */
export function hashId(id: number): number {
  let x = Math.imul(id ^ (id >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** The generator seeded by a system's id: what every ghost drawn for that system is placed by. */
export function seededBy(id: number): () => number {
  return mulberry32(hashId(id));
}

/** A ghost system's star, in world units: the size the mod's spawned satellites are drawn at. */
export const GHOST_STAR_RADIUS = 1.4;
