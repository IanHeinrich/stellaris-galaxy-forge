import type { DepositView } from "../../generated/DepositView";
import type { InitPlanetView } from "../../generated/InitPlanetView";
import type { InitializerView } from "../../generated/InitializerView";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import { planetClassLabel } from "../details/labels";
import { resourceRows, type ResourceRow } from "../resources";

/** The class an initializer gives the body standing in for the system's own star. */
const STAR = "star";

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

/** A body block without a class leaves the choice to the game, like `random`. */
const RANDOM_CLASSES: Record<string, string> = {
  "": "random planet, any class",
  none: "no planet",
  random: "random planet, any class",
  random_colonizable: "random habitable planet",
  random_non_colonizable: "random uninhabitable planet",
  random_asteroid: "random asteroid",
  random_non_machine: "random planet, no machine world",
  random_non_ideal: "random planet, not the ideal class",
  random_ruler: "random habitable planet for a ruler",
  random_pre_ftl: "random pre-FTL world",
};

/** `rl_habitable_planets` → `random from habitable planets`. */
function randomListLabel(key: string): string {
  return `random from ${key.slice(3).replace(/_/g, " ")}`;
}

/** What a body's class is called: a planet class, one of the random kinds, or a random list. */
export function initClassLabel(planetClass: string): string {
  const random = RANDOM_CLASSES[planetClass];
  if (random !== undefined) return random;
  if (planetClass.startsWith("rl_")) return randomListLabel(planetClass);
  if (planetClass.startsWith("random")) return planetClass.replace(/_/g, " ");
  return planetClassLabel(planetClass);
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
    if (planet.class === STAR) return;
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
