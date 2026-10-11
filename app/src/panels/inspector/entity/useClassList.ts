import { useMemo } from "react";
import type { SpawnStar } from "../../../generated/SpawnStar";
import { bodyClassName } from "../../../lib/details/labels";
import {
  classOdds,
  mergedByName,
  type NamedPick,
  rowAsks,
  starOdds,
} from "../../../lib/details/spawnFacts";
import type { Names } from "../../../lib/names";
import { useGameDataStore, type GameDataState } from "../../../store/gameDataStore";
import type { BodyRead } from "./bodySources";

type RolledStar = Extract<SpawnStar, { state: "rolled" }>;

/**
 * The list under a scenario body's Class row of what its class can be: the star classes of the
 * star list it is drawn from, likeliest first, or the planet classes it can be, those that show
 * under one name as one. `asks` is the class each row's toggle asks for, in the same order.
 */
export type ClassList =
  | { kind: "stars"; star: RolledStar; asks: (string | null)[] }
  | { kind: "planets"; rows: NamedPick[]; asks: (string | null)[] };

/** Whether the body's orbit, and the system's star, leave which class it rolls open. */
export function classDrawFit(read: BodyRead): {
  orbitRanged: boolean;
  starRolled: boolean;
  exact: boolean;
} {
  const orbit = read.summary.layout?.orbit;
  const orbitRanged = orbit == null || orbit.min !== orbit.max;
  const starRolled = read.details.spawn?.star?.state !== "fixed";
  return { orbitRanged, starRolled, exact: !orbitRanged && !starRolled };
}

function classListOf(
  read: BodyRead,
  names: Names,
  starClasses: GameDataState["starClasses"],
): ClassList | null {
  const spawn = read.summary.spawn;
  if (spawn === undefined || spawn.changed_class !== null || spawn.class.state !== "rolled") {
    return null;
  }
  const pool = spawn.class.pool;
  const star = read.details.spawn?.star;
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
            chance: classDrawFit(read).exact ? o.share : null,
          }))
        : null;
  if (odds === null) return null;
  const rows = mergedByName(odds, (key) => bodyClassName(key, names, read.summary.moon));
  return { kind: "planets", rows, asks: rowAsks(rows.map((row) => row.keys)) };
}

/** The list of what body `read`'s class can be, as its Class row shows it; null where it has none. */
export function useClassList(read: BodyRead): ClassList | null {
  const names = useGameDataStore((s) => s.names);
  const starClasses = useGameDataStore((s) => s.starClasses);
  return useMemo(() => classListOf(read, names, starClasses), [read, names, starClasses]);
}
