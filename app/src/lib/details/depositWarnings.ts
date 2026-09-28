/**
 * What the game takes away on its next month tick after a deposit edit on a colony, as the
 * sentences the planet page asks the user to confirm. The save stores no district caps, so
 * a cap is what the planet's deposits add up to, and "may" says when something else adds to it.
 */
import type { DepositTypeView } from "../../generated/DepositTypeView";
import type { PlanetPage } from "../../generated/PlanetPage";
import type { PlanetPageDeposit } from "../../generated/PlanetPageDeposit";
import { displayNameIn, readableKey, type Names } from "../names";
import { counted, thousands } from "../text";

export const TERRAFORMING_NOTE =
  "This planet is terraforming. The game changes its deposits, added ones too, when it finishes.";

const DISTRICT_CAP = /^(district_\w+)_max_add$/;
const MAX_DISTRICTS = "planet_max_districts_add";

/**
 * The zones and buildings that need one of a set of deposits, as the game's own triggers
 * check for them: `has_rare_crystals_deposit` and its siblings, the Betharian zone script,
 * the Xeno Zoo's destroy trigger and the Sky Mountain zone.
 */
const NEEDS: readonly { deposits: readonly string[]; needed: readonly string[] }[] = [
  {
    deposits: [
      "d_crystalline_caverns",
      "d_crystal_forest",
      "d_crystal_reef",
      "d_industrial_sector",
      "d_crystaline_growths",
      "d_crystal_kraken_body",
      "d_crystal_kraken_body_bombed",
      "d_crystalline_glacier",
      "d_celestial_storm_1_mines",
      "d_celestial_storm_3_crystal",
    ],
    needed: [
      "zone_rare_crystals",
      "zone_rare_crystals_nexus",
      "zone_rare_crystals_hive",
      "building_crystal_mines",
    ],
  },
  {
    deposits: [
      "d_dust_caverns",
      "d_dust_desert",
      "d_industrial_sector",
      "d_explosive_atmosphere",
      "d_particle_storm_3_motes",
    ],
    needed: [
      "zone_volatile_motes",
      "zone_volatile_motes_nexus",
      "zone_volatile_motes_hive",
      "building_mote_harvesters",
    ],
  },
  {
    deposits: [
      "d_bubbling_swamp",
      "d_fuming_bog",
      "d_industrial_sector",
      "d_exotic_mountain",
      "d_bogplants",
      "d_toxic_god_envenomed_seas_upgraded",
    ],
    needed: [
      "zone_exotic_gases",
      "zone_exotic_gases_nexus",
      "zone_exotic_gases_hive",
      "building_gas_extractors",
    ],
  },
  {
    deposits: ["d_betharian_deposit"],
    needed: [
      "zone_betharian",
      "zone_betharian_nexus",
      "zone_betharian_hive",
      "building_betharian_power_plant",
    ],
  },
  { deposits: ["d_alien_pets_deposit", "d_avian_reserve"], needed: ["building_xeno_zoo"] },
  { deposits: ["d_sky_mountain"], needed: ["zone_minerals_physics"] },
];

/** The deposit the page removes from a row: its last not being cleared, else its last. */
export function removalTarget(
  page: PlanetPage,
  kind: string,
  swapType: string | null,
): PlanetPageDeposit | null {
  const held = page.deposits.filter((d) => d.kind === kind && d.swap_type === swapType);
  const cleared = new Set(page.clearing.map((c) => c.deposit));
  const free = held.filter((d) => !cleared.has(d.id));
  return free[free.length - 1] ?? held[held.length - 1] ?? null;
}

/** Every localisation key the warnings name, for one read. */
export function warningNameKeys(page: PlanetPage): string[] {
  const colony = page.colony;
  return [
    ...(colony?.districts.map((d) => d.kind) ?? []),
    ...(colony?.zones ?? []),
    ...(colony?.buildings ?? []),
    ...page.clearing.flatMap((c) => c.cost.map(([resource]) => resource)),
  ];
}

function depositName(kind: string, views: ReadonlyMap<string, DepositTypeView>): string {
  return views.get(kind)?.name ?? readableKey(kind);
}

/** `district_generator` as the game names it, "Generator District", counted. */
function districts(names: Names, key: string, n: number): string {
  const name = names.get(key) ?? `${readableKey(key.replace(/^district_/, ""))} District`;
  return counted(n, name);
}

/** What the planet's deposits add to one cap, `except` one of them. */
function depositCap(
  page: PlanetPage,
  views: ReadonlyMap<string, DepositTypeView>,
  key: string,
  except: number | null,
): number {
  let total = 0;
  for (const deposit of page.deposits) {
    if (deposit.id === except) continue;
    for (const effect of views.get(deposit.kind)?.effects ?? []) {
      if (effect.key === key) total += effect.value;
    }
  }
  return total;
}

/**
 * The districts an edit that changes caps by `changes` may cost, `before` being what the
 * deposits add to each cap now. A district type's cap is taken to be its deposits' sum: the
 * game demolishes what is built over the new sum, and "may" does so when more is built than
 * the deposits alone allow, so something else adds to the cap. The total cap depends on the
 * planet's size too, so a cut to it always "may" demolish.
 */
function capWarnings(
  page: PlanetPage,
  views: ReadonlyMap<string, DepositTypeView>,
  names: Names,
  changes: readonly { key: string; value: number }[],
  except: number | null,
): string[] {
  const colony = page.colony;
  if (colony === null) return [];
  const warnings: string[] = [];
  for (const { key, value } of changes) {
    if (value >= 0) continue;
    if (key === MAX_DISTRICTS) {
      const built = colony.districts.reduce((n, d) => n + d.level, 0);
      const n = Math.min(-value, built);
      if (n > 0) warnings.push(`The game may demolish ${counted(n, "district")} within a month.`);
      continue;
    }
    const district = DISTRICT_CAP.exec(key)?.[1];
    if (district === undefined) continue;
    const built = colony.districts.find((d) => d.kind === district)?.level ?? 0;
    const before = depositCap(page, views, key, null);
    const after = depositCap(page, views, key, except) + (except === null ? value : 0);
    const n = Math.min(-value, built - Math.max(after, 0));
    if (n <= 0) continue;
    const verb = built <= before ? "demolishes" : "may demolish";
    warnings.push(`The game ${verb} ${districts(names, district, n)} within a month.`);
  }
  return warnings;
}

/** "750 Energy Credits and 250 Minerals". */
function costText(cost: readonly [string, number][], names: Names): string {
  return cost
    .map(([resource, n]) => `${thousands(n)} ${displayNameIn(names, resource)}`)
    .join(" and ");
}

/** What removing `deposit` from the page's planet costs the colony, one sentence each. */
export function removalWarnings(
  page: PlanetPage,
  deposit: PlanetPageDeposit,
  views: ReadonlyMap<string, DepositTypeView>,
  names: Names,
): string[] {
  const name = depositName(deposit.kind, views);
  const warnings: string[] = [];
  const clearing = page.clearing.find((c) => c.deposit === deposit.id);
  if (clearing !== undefined) {
    const spent = clearing.cost.length === 0 ? "resources" : costText(clearing.cost, names);
    warnings.push(
      `${name} is being cleared. Removing it cancels the clearing, and the ${spent} already spent isn't refunded.`,
    );
  }
  const lost = (views.get(deposit.kind)?.effects ?? []).map((e) => ({
    key: e.key,
    value: -e.value,
  }));
  warnings.push(...capWarnings(page, views, names, lost, deposit.id));
  const colony = page.colony;
  if (colony === null) return warnings;
  const left = new Set(page.deposits.filter((d) => d.id !== deposit.id).map((d) => d.kind));
  const built = new Set([...colony.zones, ...colony.buildings]);
  const warned = new Set<string>();
  for (const need of NEEDS) {
    if (!need.deposits.includes(deposit.kind)) continue;
    if (need.deposits.some((kind) => left.has(kind))) continue;
    for (const key of need.needed) {
      if (!built.has(key) || warned.has(key)) continue;
      warned.add(key);
      warnings.push(
        `${displayNameIn(names, key)} needs ${name}. The game removes it within a month.`,
      );
    }
  }
  return warnings;
}

/** What adding a deposit of type `kind` to the page's planet costs the colony. */
export function addWarnings(
  page: PlanetPage,
  kind: string,
  views: ReadonlyMap<string, DepositTypeView>,
  names: Names,
): string[] {
  const effects = views.get(kind)?.effects ?? [];
  return capWarnings(page, views, names, effects, null);
}
