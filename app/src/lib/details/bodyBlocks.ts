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
  /** Every copy of its block the list holds, `body` first. */
  copies: PlanetSummary[];
  /**
   * How many of its copies the game places, where that can be other than one; `null` for a body
   * placed once. `{ min: 0, max: 0 }` when it places none.
   */
  count: CountRange | null;
  /** On a block of planets, the most moons each of them has. */
  moons: number;
}

const sameCount = (a: CountRange | undefined, b: CountRange) =>
  a !== undefined && a.min === b.min && a.max === b.max;

/**
 * How many of a block's copies the game places: from the copies within its lowest count whose
 * orbit always fits, to every copy whose orbit can fit.
 */
function placedCopies(copies: readonly PlanetSummary[]): CountRange | null {
  const spawns = copies.flatMap((c) => (c.spawn === undefined ? [] : [c.spawn]));
  if (spawns.length === 0) return null;
  const least = spawns[0].count.min;
  const min = spawns.filter(
    (s) => s.copy <= least && s.orbit_fit !== "sometimes" && s.orbit_fit !== "never",
  ).length;
  const max = spawns.filter((s) => s.orbit_fit !== "never").length;
  return { min, max };
}

/**
 * The list's rows from its bodies in list order, each moon after its planet. Every copy a block
 * places is a body of its own, and they read as one row: the first copy, with how many of them the
 * game places. The moons of a block of planets are counted on its row, not listed. A body the
 * game places once or not at all, for its count or for its orbit, is a block too, so its row shows
 * "0 to 1".
 */
export function bodyBlocks(bodies: readonly PlanetSummary[]): BodyBlock[] {
  const rows: BodyBlock[] = [];
  const lastCopy = new Map<BodyBlock, number>();
  const written = new Map<BodyBlock, CountRange>();
  let planet: BodyBlock | null = null;
  let firstCopy = false;
  for (const body of bodies) {
    const spawn = body.spawn;
    const several = (row: BodyBlock) => (written.get(row)?.max ?? 1) > 1;
    if (body.moon && planet !== null && several(planet)) {
      if (firstCopy) planet.moons += 1;
      continue;
    }
    let block: BodyBlock | undefined;
    if (spawn !== undefined && spawn.copy > 1) {
      for (let i = rows.length - 1; i >= 0 && block === undefined; i--) {
        const row = rows[i];
        const follows =
          lastCopy.get(row) === spawn.copy - 1 && sameCount(written.get(row), spawn.count);
        if (row.body.moon === body.moon && follows) block = row;
      }
    }
    if (block !== undefined) {
      block.copies.push(body);
    } else {
      block = { body, copies: [body], count: null, moons: 0 };
      rows.push(block);
      if (spawn !== undefined) written.set(block, spawn.count);
    }
    lastCopy.set(block, spawn?.copy ?? 1);
    if (!body.moon) {
      firstCopy = block.body === body;
      planet = block;
    }
  }
  for (const row of rows) {
    const placed = placedCopies(row.copies);
    const ranged = placed !== null && (isRanged(placed) || placed.max !== 1);
    row.count = ranged ? placed : null;
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
