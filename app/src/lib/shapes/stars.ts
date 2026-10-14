import { seeded } from "../random";

/** The star classes a rolled shape's systems take: the game's own odds, one class, or a mix of ticked classes. */
export type StarChoice =
  { kind: "random" } | { kind: "one"; class: string } | { kind: "mix"; classes: string[] };

/** A star class the generator rolls, with the weights a pick of it and a pick of no class give it. */
export interface StarClassOdds {
  key: string;
  /** How often a pick of this class draws it. */
  odds: number;
  /** How often a pick of no class rolls it: zero for a class only special layouts make. */
  randomOdds: number;
}

/** Keeps the star draw apart from the scattered fill's, which reads the same seed. */
const STARS_STREAM = 0x5354_4152;

/**
 * Each class `choice` may draw with its weight, in `classes`' order. Random weighs the classes
 * a pick of no class rolls; a mix weighs its ticked classes by their own odds. Empty when no
 * class has a weight, as for a mix with none ticked.
 */
export function starWeights(
  choice: StarChoice,
  classes: readonly StarClassOdds[],
): Array<[string, number]> {
  switch (choice.kind) {
    case "random":
      return classes.filter((c) => c.randomOdds > 0).map((c) => [c.key, c.randomOdds]);
    case "one":
      return [[choice.class, 1]];
    case "mix": {
      const ticked = new Set(choice.classes);
      return classes.filter((c) => ticked.has(c.key) && c.odds > 0).map((c) => [c.key, c.odds]);
    }
  }
}

/**
 * `count` star classes drawn by `weights` from `seed`, one draw per point in order, so a shape
 * that grows keeps its earlier points' classes. Empty when no class has a weight.
 */
export function rollStars(
  count: number,
  seed: number,
  weights: ReadonlyArray<readonly [string, number]>,
): string[] {
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  if (!(total > 0)) return [];
  const rand = seeded(seed ^ STARS_STREAM);
  return Array.from({ length: count }, () => {
    let r = rand() * total;
    for (const [key, w] of weights) {
      r -= w;
      if (r < 0) return key;
    }
    return weights[weights.length - 1][0];
  });
}
