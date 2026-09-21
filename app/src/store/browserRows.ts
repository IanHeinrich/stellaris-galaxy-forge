import { useMemo } from "react";
import type { CountryNode } from "../generated/CountryNode";
import type { SpecialSystem } from "../generated/SpecialSystem";
import * as rows from "../lib/browserRows";
import type { CountryTypes } from "../lib/countryKinds";
import { templateName } from "../lib/names";
import { centralOwnedSystem, systemNameOf, useGalaxyStore, type Systems } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { currentOwnership, useOwnership } from "./ownership";

export {
  EMPIRE_GROUPS,
  POINT_KINDS,
  empireGroup,
  issueGroups,
  issueTitle,
  specialSystemOfCountry,
} from "../lib/browserRows";
export type {
  EmpireGroup,
  EmpireGroupKey,
  EmpireRow,
  IssueGroup,
  IssueRow,
  PointGroup,
  PointKind,
  PointRow,
  RowLookups,
} from "../lib/browserRows";

/** What the browser rows look up, from a galaxy and a localisation handed in. */
export function rowLookups(systems: Systems, names: ReadonlyMap<string, string>): rows.RowLookups {
  return {
    countryName: templateName,
    systemName: (id) => systemNameOf(systems, names, id),
    centralSystem: (ownerId) => centralOwnedSystem(systems, ownerId),
  };
}

/** A system's name, re-rendered when the node or the localisation behind it changes. */
export function useSystemName(id: number): string {
  const systems = useGalaxyStore((s) => s.systems);
  const names = useGameDataStore((s) => s.names);
  return systemNameOf(systems, names, id);
}

/** Several system names, in the order they were asked for, on the same terms as `useSystemName`. */
export function useSystemNames(ids: readonly number[]): string[] {
  const systems = useGalaxyStore((s) => s.systems);
  const names = useGameDataStore((s) => s.names);
  return ids.map((id) => systemNameOf(systems, names, id));
}

/** A country's name, re-rendered when the countries behind it change; `null` for no country. */
export function useCountryName(id: number | null): string | null {
  const countries = useGalaxyStore((s) => s.countries);
  if (id === null) return null;
  const country = countries.get(id);
  return country ? templateName(country) : `#${id}`;
}

/** What a panel that mirrors the whole galaxy reads: every load and every delta bumps it. */
export function useGalaxyVersion(): number {
  return useGalaxyStore((s) => s.version);
}

/** The same lookups, answered from the stores as they stand. */
function currentLookups(): rows.RowLookups {
  return rowLookups(useGalaxyStore.getState().systems, useGameDataStore.getState().names);
}

export function empireGroups(
  countries: ReadonlyMap<number, CountryNode>,
  types: CountryTypes,
): rows.EmpireGroup[] {
  return rows.empireGroups(countries, types, currentLookups(), currentOwnership());
}

export function pointGroups(
  special: ReadonlyMap<number, SpecialSystem>,
  withGameData: boolean,
  names: ReadonlyMap<string, string>,
): rows.PointGroup[] {
  return rows.pointGroups(special, withGameData, names, currentLookups().systemName);
}

/** How many empires the Empires tab lists, recomputed only when what it reads changes. */
export function useEmpireCount(): number {
  const countries = useGalaxyStore((s) => s.countries);
  const systems = useGalaxyStore((s) => s.systems);
  const types = useGameDataStore((s) => s.countryTypes);
  const names = useGameDataStore((s) => s.names);
  const ownership = useOwnership();
  return useMemo(
    () =>
      rows
        .empireGroups(countries, types, rowLookups(systems, names), ownership)
        .reduce((n, g) => n + g.rows.length, 0),
    [countries, systems, types, names, ownership],
  );
}

/** How many points of interest the tab lists, recomputed only when what it reads changes. */
export function usePointCount(): number {
  const systems = useGalaxyStore((s) => s.systems);
  const special = useGameDataStore((s) => s.special);
  const withGameData = useGameDataStore((s) => s.specialWithGameData);
  const names = useGameDataStore((s) => s.names);
  return useMemo(
    () =>
      rows
        .pointGroups(special, withGameData, names, (id) => systemNameOf(systems, names, id))
        .reduce((n, g) => n + g.count, 0),
    [systems, special, withGameData, names],
  );
}
