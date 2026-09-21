import type { CountryNode } from "../generated/CountryNode";
import type { DocumentKind } from "../generated/DocumentKind";
import type { MapColor } from "../generated/MapColor";
import type { SpecialKind } from "../generated/SpecialKind";
import type { SystemNode } from "../generated/SystemNode";
import { drawsBorders, isMarauder, territoryKind, type CountryTypes } from "./countryKinds";
import { basesBeside, clanOf, isHome } from "./marauder";
import { MARAUDER_COLORS, ownerColors, type OwnerColors } from "./visual/ownerColors";

export type OwnerKind = "country" | "marauder_clan";

/** One owner the map paints a territory for and the Empires list names. */
export interface OwnerEntry {
  id: number;
  label: string;
  colors: OwnerColors;
  kind: OwnerKind;
  /** The country behind the owner; a marauder clan a scenario places has none. */
  country?: CountryNode;
  /** A clan's home system, where its Empires row goes. */
  home?: number;
}

/** Every system's owner, and what each owner is. */
export interface Ownership {
  readonly owners: ReadonlyMap<number, number>;
  readonly table: ReadonlyMap<number, OwnerEntry>;
}

export interface OwnershipInput {
  readonly kind: DocumentKind | null;
  /** A scenario's systems carry the owners its scripts stamp on them. */
  readonly systems: ReadonlyMap<number, SystemNode>;
  readonly countries: ReadonlyMap<number, CountryNode>;
  readonly countryTypes: CountryTypes;
  readonly mapColors: ReadonlyMap<string, MapColor>;
  readonly countryName: (country: CountryNode) => string;
}

export const NO_OWNERSHIP: Ownership = Object.freeze({
  owners: new Map<number, number>(),
  table: new Map<number, OwnerEntry>(),
});

/** A clan's id among the owners: negative, so it never collides with a country's. */
export function clanOwnerId(clan: number): number {
  return -clan;
}

export function clanLabel(clan: number): string {
  return `Marauder clan ${clan}`;
}

/**
 * Who owns what, from every source at once. A save's owners are its countries, one entry
 * per country the game paints borders for. A scenario's are the owners its scripts stamp,
 * overlaid by the structure the text itself carries: each marauder clan, a home and the raid
 * bases hyperlaned to it, becomes one synthetic owner.
 */
export function composeOwnership(input: OwnershipInput): Ownership {
  const { kind, systems, countries, countryTypes, mapColors, countryName } = input;
  const owners = new Map<number, number>();
  for (const s of systems.values()) if (s.owner !== null) owners.set(s.id, s.owner);
  const table = new Map<number, OwnerEntry>();
  let index = 0;
  for (const country of countries.values()) {
    const slot = index++;
    if (!drawsBorders(country, countryTypes)) continue;
    table.set(country.id, {
      id: country.id,
      label: countryName(country),
      colors: ownerColors(country, slot, mapColors),
      kind: "country",
      country,
    });
  }
  if (kind !== "scenario") return { owners, table };
  for (const home of systems.values()) {
    if (!isHome(home) || home.marauder === null) continue;
    const clan = clanOf(home.marauder);
    const id = clanOwnerId(clan);
    for (const s of [home, ...basesBeside(home, systems)]) {
      // The scripted marauder country holding a clan's system is that clan read from the scripts.
      if (s.owner !== null && isMarauder(countries.get(s.owner))) table.delete(s.owner);
      owners.set(s.id, id);
    }
    table.set(id, {
      id,
      label: clanLabel(clan),
      colors: MARAUDER_COLORS,
      kind: "marauder_clan",
      home: home.id,
    });
  }
  return { owners, table };
}

/** The special kind a whole territory stands for, when its owner is a clan or a fallen empire. */
export function ownerTerritoryKind(
  entry: OwnerEntry | undefined,
  types: CountryTypes,
): Extract<SpecialKind, "marauder" | "fallen_empire"> | null {
  if (entry === undefined) return null;
  if (entry.kind === "marauder_clan") return "marauder";
  return territoryKind(entry.country, types);
}

/** Whether a country that would paint borders was left out of the table: a clan took its systems. */
export function supersededCountry(
  ownership: Ownership,
  country: CountryNode,
  types: CountryTypes,
): boolean {
  return drawsBorders(country, types) && !ownership.table.has(country.id);
}

/** Every system `ownerId` owns, ascending. */
export function systemsOf(owners: ReadonlyMap<number, number>, ownerId: number): number[] {
  const ids: number[] = [];
  for (const [id, owner] of owners) if (owner === ownerId) ids.push(id);
  return ids.sort((a, b) => a - b);
}

/** The systems whose owner is a marauder clan the scenario places. */
export function clanSystemsOf(ownership: Ownership): Set<number> {
  const ids = new Set<number>();
  for (const [id, owner] of ownership.owners) {
    if (ownership.table.get(owner)?.kind === "marauder_clan") ids.add(id);
  }
  return ids;
}

function sameEntry(a: OwnerEntry, b: OwnerEntry): boolean {
  return (
    a.id === b.id &&
    a.label === b.label &&
    a.kind === b.kind &&
    a.country === b.country &&
    a.home === b.home &&
    a.colors.outline === b.colors.outline &&
    a.colors.fill === b.colors.fill
  );
}

function sameMap<T>(
  a: ReadonlyMap<number, T>,
  b: ReadonlyMap<number, T>,
  same: (x: T, y: T) => boolean,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other === undefined || !same(value, other)) return false;
  }
  return true;
}

/**
 * `next` with each half replaced by `prev`'s where nothing in it changed, so a layer that
 * compares them by identity redraws only what an edit actually moved.
 */
export function settledOwnership(prev: Ownership, next: Ownership): Ownership {
  const owners = sameMap(prev.owners, next.owners, (x, y) => x === y) ? prev.owners : next.owners;
  const table = sameMap(prev.table, next.table, sameEntry) ? prev.table : next.table;
  return owners === prev.owners && table === prev.table ? prev : { owners, table };
}
