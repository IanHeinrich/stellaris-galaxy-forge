import type { CountryNode } from "../generated/CountryNode";
import type { PreparedMap } from "../generated/PreparedMap";
import type { ScenarioBypasses } from "../generated/ScenarioBypasses";
import type { ScenarioOwners } from "../generated/ScenarioOwners";
import type { SpecialSystem } from "../generated/SpecialSystem";
import type { SystemDetails } from "../generated/SystemDetails";
import type { SystemNode } from "../generated/SystemNode";
import { templateName } from "../lib/names";
import { composeOwnership, settledOwnership, type Ownership } from "../lib/ownership";
import { composePrecursors, type PrecursorRegions } from "../lib/precursors";
import { useDetailsStore } from "./detailsStore";
import { useFileSessionStore } from "./fileSessionStore";
import { countryMap, stampOwners, useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { ownerMap } from "./gameDataStore.document";
import { currentOwnership } from "./ownership";
import { currentPrecursors } from "./precursors";
import { shownProjection, usePrepareStore } from "./prepareStore";

/**
 * What the map draws from: the document as the stores hold it, or, while Prepare shows its
 * outcome, the map as the choices would leave it. Panels keep reading the stores.
 */
export interface MapInputs {
  readonly systems: ReadonlyMap<number, SystemNode>;
  readonly countries: ReadonlyMap<number, CountryNode>;
  readonly special: ReadonlyMap<number, SpecialSystem>;
  readonly placed: ScenarioBypasses | null;
  readonly owners: ScenarioOwners | null;
  /** The systems the choices rewrite; empty while the map shows the document. */
  readonly changed: ReadonlySet<number>;
}

const NONE: ReadonlySet<number> = new Set<number>();

/** `compute`'s last answer, computed again, from the answer before, when a value in `from` changes. */
function memo<T>(): (from: readonly unknown[], compute: (previous: T | null) => T) => T {
  let last: readonly unknown[] | null = null;
  let value: T | null = null;
  return (from, compute) => {
    if (value === null || last === null || from.some((v, i) => v !== last?.[i])) {
      last = from;
      value = compute(value);
    }
    return value;
  };
}

/** The map's inputs as the stores stand. */
export function mapInputs(): MapInputs {
  return projectedInputs() ?? stored();
}

const projectedMemo = memo<MapInputs>();

/** The map as Prepare's choices would leave it while it shows them, one object per change; else null. */
function projectedInputs(): MapInputs | null {
  const projection = shownProjection(usePrepareStore.getState());
  if (projection === null) return null;
  const galaxy = useGalaxyStore.getState();
  const from = [projection, galaxy.systems, galaxy.scriptedOwners, galaxy.galaxy];
  return projectedMemo(from, () => projected(projection));
}

function stored(): MapInputs {
  const galaxy = useGalaxyStore.getState();
  const data = useGameDataStore.getState();
  return {
    systems: galaxy.systems,
    countries: galaxy.countries,
    special: data.special,
    placed: data.scenarioBypasses,
    owners: data.scenarioOwners,
    changed: NONE,
  };
}

/** The stores' map with `projection`'s systems, owners, special systems and bypasses in. */
function projected(projection: PreparedMap): MapInputs {
  const { systems: own, scriptedOwners, galaxy } = useGalaxyStore.getState();
  const systems = new Map(own);
  for (const node of projection.systems) systems.set(node.id, node);
  const owners = projection.owners ?? null;
  stampOwners(systems, ownerMap(owners), scriptedOwners);
  return {
    systems,
    countries: countryMap(galaxy?.countries ?? [], owners?.territories.map((t) => t.country) ?? []),
    special: new Map(projection.special.map((s) => [s.id, s])),
    placed: projection.bypasses,
    owners,
    changed: new Set(projection.systems.map((s) => s.id)),
  };
}

const ownershipMemo = memo<Ownership>();

/** Who owns what on the map: `currentOwnership`, or composed from the projection's inputs. */
export function mapOwnership(): Ownership {
  const shown = projectedInputs();
  if (shown === null) return currentOwnership();
  const data = useGameDataStore.getState();
  const kind = useFileSessionStore.getState().kind;
  const from = [shown, kind, data.countryTypes, data.mapColors, data.names];
  return ownershipMemo(from, (previous) => {
    const next = composeOwnership({
      kind,
      systems: shown.systems,
      countries: shown.countries,
      countryTypes: data.countryTypes,
      mapColors: data.mapColors,
      countryName: templateName,
    });
    return previous === null ? next : settledOwnership(previous, next);
  });
}

const precursorsMemo = memo<PrecursorRegions>();

/** Each system's precursors on the map: `currentPrecursors`, or read from the projection's systems. */
export function mapPrecursors(): PrecursorRegions {
  const shown = projectedInputs();
  if (shown === null) return currentPrecursors();
  const { precursors } = useGameDataStore.getState();
  return precursorsMemo([shown, precursors], () => composePrecursors(shown.systems, precursors));
}

export interface MapDetails {
  readonly details: ReadonlyMap<number, SystemDetails>;
  readonly version: number;
}

const detailsMemo = memo<MapDetails>();
let projectedVersion = -1;

/**
 * The details the map shows: the stores', less the systems the choices rewrite, whose details
 * are the document's. Each projection's details take a version of their own below zero.
 */
export function mapDetails(): MapDetails {
  const shown = projectedInputs();
  const { details, version } = useDetailsStore.getState();
  if (shown === null) return { details, version };
  return detailsMemo([shown, details], () => ({
    details: new Map([...details].filter(([id]) => !shown.changed.has(id))),
    version: --projectedVersion,
  }));
}
