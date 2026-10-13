/**
 * What a scenario body's class can be, as its Class row lists it, and the body as one class it
 * can be rolls it.
 */
import type { ClassRolls } from "../../generated/ClassRolls";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SpawnStar } from "../../generated/SpawnStar";
import type { StarClassView } from "../../generated/StarClassView";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { Names } from "../names";
import { bodyClassName } from "./labels";
import { classOdds, mergedByName, type NamedPick, rowAsks, starOdds } from "./spawnFacts";

/** A star whose class an `rl_` list rolls. */
export type RolledStar = Extract<SpawnStar, { state: "rolled" }>;

/**
 * The list under a scenario body's Class row of what its class can be: the star classes of the
 * star list it is drawn from, likeliest first, or the planet classes it can be, those that show
 * under one name as one. `asks` is the class each row's toggle asks for, in the same order.
 */
export type ClassList =
  | { kind: "stars"; star: RolledStar; asks: (string | null)[] }
  | { kind: "planets"; rows: NamedPick[]; asks: (string | null)[] };

/** Whether the body's orbit, and the system's star, leave which class it rolls open. */
export function classDrawFit(
  details: SystemDetails,
  summary: PlanetSummary,
): { orbitRanged: boolean; starRolled: boolean; exact: boolean } {
  const orbit = summary.layout?.orbit;
  const orbitRanged = orbit == null || orbit.min !== orbit.max;
  const starRolled = details.spawn?.star?.state !== "fixed";
  return { orbitRanged, starRolled, exact: !orbitRanged && !starRolled };
}

/** The list of what body `summary` of `details` can be, as its Class row shows it; null where it has none. */
export function classListOf(
  details: SystemDetails,
  summary: PlanetSummary,
  names: Names,
  starClasses: ReadonlyMap<string, StarClassView>,
): ClassList | null {
  const spawn = summary.spawn;
  if (spawn === undefined || spawn.changed_class !== null || spawn.class.state !== "rolled") {
    return null;
  }
  const pool = spawn.class.pool;
  const star = details.spawn?.star;
  if (pool.kind === "star_list" && star?.state === "rolled") {
    const classes = starOdds(star.members).map((o) =>
      (starClasses.get(o.key)?.planet_keys ?? []).slice(0, 1),
    );
    return { kind: "stars", star, asks: rowAsks(classes) };
  }
  const odds =
    pool.kind === "planet_list"
      ? pool.members.map((m) => ({ key: m.key, chance: null }))
      : pool.kind === "random" && pool.at_orbit !== undefined && pool.at_orbit.length > 0
        ? classOdds(pool.at_orbit).map((o) => ({
            key: o.key,
            chance: classDrawFit(details, summary).exact ? o.share : null,
          }))
        : null;
  if (odds === null) return null;
  const rows = mergedByName(odds, (key) => bodyClassName(key, names, summary.moon));
  return { kind: "planets", rows, asks: rowAsks(rows.map((row) => row.keys)) };
}

/** `summary` with the size, ring, deposits and planet features the body rolls as one class. */
export function rolledAs(summary: PlanetSummary, rolls: ClassRolls): PlanetSummary {
  const spawn = summary.spawn;
  if (spawn === undefined) return summary;
  return {
    ...summary,
    size: null,
    layout: {
      orbit: null,
      at: null,
      orbit_step: null,
      angle_step: null,
      turns_from: null,
      ...summary.layout,
      size: rolls.size,
    },
    spawn: {
      ...spawn,
      ring: rolls.ring,
      rolled_deposits: rolls.deposits,
      rolled_features: rolls.features,
    },
  };
}
