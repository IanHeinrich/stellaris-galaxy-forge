/**
 * The rows of a scenario system's Planets list: one per initializer block, so the copies a block
 * places a random number of times are one row with their count.
 */
import type { ClassPool } from "../../generated/ClassPool";
import type { CountRange } from "../../generated/CountRange";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import { counted } from "../text";
import { isRanged, rangeWords } from "./spawnFacts";

/** A row of the Planets list: a body, or the first of the copies its block places. */
export interface BodyBlock {
  body: PlanetSummary;
  /** How many its block places, where that can be other than one; `null` for a body placed once. */
  count: CountRange | null;
  /** On a block of planets, the most moons each of them has. */
  moons: number;
}

const sameCount = (a: CountRange | null, b: CountRange) =>
  a !== null && a.min === b.min && a.max === b.max;

/**
 * The list's rows from its bodies in list order, each moon after its planet. Every copy a block
 * places is a body of its own, and they read as one row: the first copy, with the block's count.
 * The moons of a block of planets are counted on its row, not listed. A body the game places
 * once or not at all is a block too, so its row shows "0 to 1".
 */
export function bodyBlocks(bodies: readonly PlanetSummary[]): BodyBlock[] {
  const rows: BodyBlock[] = [];
  const lastCopy = new Map<BodyBlock, number>();
  let planet: BodyBlock | null = null;
  let firstCopy = false;
  for (const body of bodies) {
    const spawn = body.spawn;
    if (body.moon && planet !== null && planet.count !== null && planet.count.max > 1) {
      if (firstCopy) planet.moons += 1;
      continue;
    }
    let block: BodyBlock | undefined;
    if (spawn !== undefined && spawn.copy > 1) {
      for (let i = rows.length - 1; i >= 0 && block === undefined; i--) {
        const row = rows[i];
        const follows = lastCopy.get(row) === spawn.copy - 1 && sameCount(row.count, spawn.count);
        if (row.body.moon === body.moon && follows) block = row;
      }
    }
    if (block !== undefined) {
      lastCopy.set(block, spawn?.copy ?? 1);
    } else {
      const several = spawn !== undefined && (isRanged(spawn.count) || spawn.count.max > 1);
      const count = several ? spawn.count : null;
      block = { body, count, moons: 0 };
      rows.push(block);
      lastCopy.set(block, spawn?.copy ?? 1);
    }
    if (!body.moon) {
      firstCopy = block.body === body;
      planet = block;
    }
  }
  return rows;
}

/** What a block's bodies are, plural. */
export function blockNoun(moon: boolean, asteroid: boolean): string {
  if (asteroid) return "asteroids";
  return moon ? "moons" : "planets";
}

/** What a block's count says on hover. */
export function blockCountTitle(count: CountRange, moon: boolean, asteroid: boolean): string {
  const noun = blockNoun(moon, asteroid);
  if (count.max <= 1) return `Some games have this ${noun.slice(0, -1)} and some don't.`;
  return moon
    ? `The game places ${rangeWords(count)} of these moons around the planet when it builds the system.`
    : `The game places ${rangeWords(count)} of these ${noun} when it builds the system.`;
}

/** The moons each planet of a block has, on its row. */
export function moonsEach(moons: number): string {
  return `each with up to ${counted(moons, "moon")}`;
}

const DRAWS: Record<string, string> = {
  random: "any class",
  random_colonizable: "habitable class",
  random_non_colonizable: "uninhabitable class",
  random_asteroid: "asteroid class",
};

/** What a rolled block's row says of its class, in a few words. */
export function drawWords(pool: ClassPool): string {
  switch (pool.kind) {
    case "random":
      return DRAWS[pool.draw] ?? "any class";
    case "planet_list":
      return `one of ${pool.members.length} classes`;
    case "star_list":
      return "a star class";
  }
}
