/** One resource total as a row draws it: the amount, and the sprite standing for the resource. */
export interface ResourceRow {
  resource: string;
  amount: number;
  sprite: string;
}

/** The order the game shows resources in; anything it does not name comes after, alphabetically. */
export const RESOURCE_ORDER = [
  "energy",
  "minerals",
  "food",
  "alloys",
  "consumer_goods",
  "trade",
  "physics_research",
  "society_research",
  "engineering_research",
  "influence",
  "unity",
  "volatile_motes",
  "exotic_gases",
  "rare_crystals",
  "sr_living_metal",
  "sr_zro",
  "sr_dark_matter",
  "astral_threads",
  "minor_artifacts",
  "nanites",
];

/** Heuristic deposit names (`d_engineering_5` → `engineering`) onto the game's resource keys. */
const ALIASES: Record<string, string> = {
  physics: "physics_research",
  society: "society_research",
  engineering: "engineering_research",
  trade_value: "trade",
  zro_deposit: "sr_zro",
  dark_matter_deposit: "sr_dark_matter",
  living_metal_deposit: "sr_living_metal",
};

/** The game's key for a resource `HeuristicResolver::deposit_produces` named from the save. */
export function canonicalResource(resource: string): string {
  return ALIASES[resource] ?? resource;
}

export function orderKey(resource: string): number {
  const i = RESOURCE_ORDER.indexOf(resource);
  return i === -1 ? RESOURCE_ORDER.length : i;
}

/** Two resources in display order, the ones the game does not name sorted by key among them. */
export function compareResources(a: string, b: string): number {
  return orderKey(a) - orderKey(b) || a.localeCompare(b);
}

/**
 * Totals per resource in the game's display order, with the icon key for each: the sprite the
 * game's resource definitions name when `icons` knows it, else the conventional `GFX_resource_*`.
 */
export function resourceRows(
  totals: ReadonlyMap<string, number>,
  icons: ReadonlyMap<string, string> = new Map(),
): ResourceRow[] {
  return Array.from(totals, ([resource, amount]) => ({
    resource,
    amount,
    sprite: `sprite:${icons.get(resource) ?? `GFX_resource_${resource}`}`,
  })).sort((a, b) => compareResources(a.resource, b.resource));
}
