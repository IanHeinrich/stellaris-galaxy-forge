import type { DepositView } from "../../generated/DepositView";
import type { InitPlanetView } from "../../generated/InitPlanetView";
import type { InitializerView } from "../../generated/InitializerView";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import { initClassLabel, randomListLabel } from "../details/labels";
import { STAR_BODY_CLASS } from "../details/starBody";
import { resourceRows, type ResourceRow } from "../resources";

/** One body an initializer spawns, ready to render. */
export interface InitializerRow {
  id: string;
  moon: boolean;
  /** The class as the initializer writes it, which also decides the icon's tint. */
  planetClass: string;
  /** The localisation key of that class, or null for the random kinds the game names none of. */
  classKey: string | null;
  classLabel: string;
  sprite: string | null;
  /** The localisation key of the body's own name; null when the initializer leaves it to the game. */
  nameKey: string | null;
  size: string | null;
  count: number;
  homePlanet: boolean;
  ring: boolean;
  resources: ResourceRow[];
}

/** The star the system is built around: the localised class, the list a random one draws from, or the key. */
export function starClassLabel(
  starClass: string | null,
  names: ReadonlyMap<string, string> = new Map(),
): string {
  if (starClass === null || starClass === "") return "random";
  if (starClass.startsWith("rl_")) return randomListLabel(starClass);
  return names.get(starClass) ?? starClass;
}

/** `16`, or `10–20` for a size the game rolls between two bounds. */
function sizeText(size: [number, number] | null): string | null {
  if (size === null) return null;
  const [min, max] = size;
  return min === max ? String(min) : `${min}–${max}`;
}

/** What the named deposits produce, summed per resource in the game's display order. */
function depositRows(
  keys: readonly string[],
  deposits: ReadonlyMap<string, DepositView>,
  icons: ReadonlyMap<string, string>,
): ResourceRow[] {
  const totals = new Map<string, number>();
  for (const key of keys) {
    for (const [resource, amount] of deposits.get(key)?.produces ?? []) {
      totals.set(resource, (totals.get(resource) ?? 0) + amount);
    }
  }
  return resourceRows(totals, icons);
}

function bodyRow(
  planet: InitPlanetView,
  id: string,
  moon: boolean,
  classes: ReadonlyMap<string, PlanetClassView>,
  deposits: ReadonlyMap<string, DepositView>,
  icons: ReadonlyMap<string, string>,
): InitializerRow {
  return {
    id,
    moon,
    planetClass: planet.class,
    classKey: planet.class.startsWith("pc_") ? planet.class : null,
    classLabel: initClassLabel(planet.class),
    sprite: classes.get(planet.class)?.icon_sprite ?? null,
    nameKey: planet.name,
    size: sizeText(planet.size),
    count: planet.count,
    homePlanet: planet.home_planet,
    ring: planet.has_ring,
    resources: depositRows(planet.deposits, deposits, icons),
  };
}

/**
 * Every body the initializer spawns, flattened in file order with each moon after its planet. The
 * body standing in for the system's own star is left out: the Star row already says what it is.
 */
export function initializerRows(
  view: InitializerView,
  classes: ReadonlyMap<string, PlanetClassView>,
  deposits: ReadonlyMap<string, DepositView>,
  icons: ReadonlyMap<string, string> = new Map(),
): InitializerRow[] {
  const rows: InitializerRow[] = [];
  view.planets.forEach((planet, i) => {
    if (planet.class === STAR_BODY_CLASS) return;
    rows.push(bodyRow(planet, String(i), false, classes, deposits, icons));
    planet.moons.forEach((moon, m) =>
      rows.push(bodyRow(moon, `${i}.${m}`, true, classes, deposits, icons)),
    );
  });
  return rows;
}

/** Every localisation key the spawn list shows: the star class, each body's class and name. */
export function initializerNameKeys(
  view: InitializerView,
  rows: readonly InitializerRow[],
): string[] {
  const keys = view.class === null ? [] : [view.class];
  for (const row of rows) {
    if (row.classKey !== null) keys.push(row.classKey);
    if (row.nameKey !== null) keys.push(row.nameKey);
  }
  return keys;
}
