import { create } from "zustand";
import type { CountryNode } from "../generated/CountryNode";
import type { GalaxyDelta } from "../generated/GalaxyDelta";
import type { GalaxyView } from "../generated/GalaxyView";
import type { HeaderField } from "../generated/HeaderField";
import type { Nebula } from "../generated/Nebula";
import type { SystemNode } from "../generated/SystemNode";
import type { Wayline } from "../generated/Wayline";
import type { Waystation } from "../generated/Waystation";
import { componentCount } from "../lib/geometry/joinIslands";
import { isLClusterSystem } from "../lib/guides";
import { meshPairs, type MeshPoint } from "../lib/geometry/mesh";
import { nodeName, stripped, templateName } from "../lib/names";
import { SpatialGrid } from "../lib/spatialGrid";

export interface GalaxyState {
  galaxy: GalaxyView | null;
  /** A scenario's header keys in file order, on their own so a header edit leaves `galaxy` alone. */
  header: HeaderField[];
  /** A save's waystations, one per station, and the waylines the game derives between them. */
  waystations: Waystation[];
  waylines: Wayline[];
  /** Current nodes by id, in file order. The truth for positions after deltas. */
  systems: Map<number, SystemNode>;
  /** In file order; `SystemNode.nebula` indexes into it. The truth for nebulae after deltas. */
  nebulae: Nebula[];
  /** In file order, the same order used for the owners layer's colour palette. */
  countries: Map<number, CountryNode>;
  /** Scenario system id → the territory country that the initializer scripts give it. */
  scriptedOwners: Map<number, number>;
  /** The territories' own countries, which `countries` carries after the save's own. */
  scriptedCountries: CountryNode[];
  grid: SpatialGrid | null;
  /** Countries whose territory the map leaves unpainted; the eye in the Empires list drives it. */
  hiddenCountries: Set<number>;
  /** Bumped on every load and delta. */
  version: number;
  /** The delta behind the latest version bump, for incremental layer updates. */
  lastDelta: GalaxyDelta | null;
  load(view: GalaxyView): void;
  applyDelta(delta: GalaxyDelta): void;
  /** Takes the scripted ownership of a scenario: the systems it stamps and the countries it draws. */
  setScriptedOwners(owners: Map<number, number>, countries: readonly CountryNode[]): void;
  clear(): void;
  countryName(id: number): string;
  systemName(id: number): string;
  /** The country's most central owned system: where to go when it has no capital. */
  centralSystem(ownerId: number): number | null;
  /** Hides or shows one country's territory. */
  toggleCountryHidden(id: number): void;
}

export const useGalaxyStore = create<GalaxyState>((set, get) => ({
  galaxy: null,
  header: [],
  waystations: [],
  waylines: [],
  systems: new Map(),
  nebulae: [],
  countries: new Map(),
  scriptedOwners: new Map(),
  scriptedCountries: [],
  grid: null,
  hiddenCountries: new Set(),
  version: 0,
  lastDelta: null,

  load(view) {
    const systems = new Map<number, SystemNode>();
    for (const s of view.systems) systems.set(s.id, s);
    const grid = new SpatialGrid();
    grid.build(systems.values());
    set({
      galaxy: view,
      header: view.header,
      waystations: view.waystations,
      waylines: view.waylines,
      systems,
      nebulae: view.nebulae,
      countries: countryMap(view.countries, []),
      // A load is a new document; the scripts of the one before it own none of its systems.
      scriptedOwners: new Map(),
      scriptedCountries: [],
      grid,
      hiddenCountries: new Set(),
      lastDelta: null,
      version: get().version + 1,
    });
  },

  applyDelta(delta) {
    const { grid, version, scriptedOwners } = get();
    const systems = new Map(get().systems);
    for (const id of delta.removed ?? []) {
      systems.delete(id);
      grid?.remove(id);
    }
    for (const node of delta.systems) {
      const stampedNode = stamped(node, scriptedOwners);
      systems.set(node.id, stampedNode);
      grid?.update(stampedNode);
    }
    const nebulae = delta.nebulae ?? get().nebulae;
    const header = delta.header ?? get().header;
    const waylines = delta.waylines ?? get().waylines;
    set({ systems, nebulae, header, waylines, lastDelta: delta, version: version + 1 });
  },

  setScriptedOwners(owners, countries) {
    const { grid, scriptedOwners: previous } = get();
    const systems = new Map(get().systems);
    const restamped: SystemNode[] = [];
    for (const [id, node] of systems) {
      const owner = owners.get(id) ?? null;
      if (owner === node.owner || (owner === null && !previous.has(id))) continue;
      const stampedNode = { ...node, owner };
      systems.set(id, stampedNode);
      grid?.update(stampedNode);
      restamped.push(stampedNode);
    }
    set({
      scriptedOwners: owners,
      scriptedCountries: [...countries],
      systems,
      countries: countryMap(get().galaxy?.countries ?? [], countries),
      lastDelta: { systems: restamped },
      version: get().version + 1,
    });
  },

  clear() {
    set({
      galaxy: null,
      header: [],
      waystations: [],
      waylines: [],
      systems: new Map(),
      nebulae: [],
      countries: new Map(),
      scriptedOwners: new Map(),
      scriptedCountries: [],
      grid: null,
      hiddenCountries: new Set(),
      lastDelta: null,
      version: get().version + 1,
    });
  },

  countryName(id) {
    const country = get().countries.get(id);
    return country ? templateName(country) : `#${id}`;
  },

  systemName(id) {
    const system = get().systems.get(id);
    return system ? nodeName(system.name) : `#${id}`;
  },

  centralSystem(ownerId) {
    return centralOwnedSystem(get().systems, ownerId);
  },

  toggleCountryHidden(id) {
    const hiddenCountries = new Set(get().hiddenCountries);
    if (!hiddenCountries.delete(id)) hiddenCountries.add(id);
    set({ hiddenCountries });
  },
}));

/** A scenario node carries no owner of its own, so the scripted one is written onto it here. */
function stamped(node: SystemNode, owners: ReadonlyMap<number, number>): SystemNode {
  const owner = owners.get(node.id);
  return owner === undefined || owner === node.owner ? node : { ...node, owner };
}

/** The document's own countries first, so the owners layer's palette keeps their order. */
function countryMap(
  own: readonly CountryNode[],
  scripted: readonly CountryNode[],
): Map<number, CountryNode> {
  const countries = new Map<number, CountryNode>();
  for (const c of own) countries.set(c.id, c);
  for (const c of scripted) countries.set(c.id, c);
  return countries;
}

/** Undirected lane count: every lane is listed from both ends. */
export function laneCount(systems: Iterable<SystemNode>): number {
  let n = 0;
  for (const s of systems) n += s.lanes.length;
  return Math.ceil(n / 2);
}

export type Systems = ReadonlyMap<number, SystemNode>;

/** What `systemName` answers, from a galaxy and a localisation handed in rather than read. */
export function systemNameOf(
  systems: Systems,
  names: ReadonlyMap<string, string>,
  id: number,
): string {
  const node = systems.get(id);
  if (node === undefined) return `#${id}`;
  return node.name.literal ? node.name.key : (names.get(node.name.key) ?? stripped(node.name.key));
}

/** Every system outside the L-Cluster as a point and every lane between them as an id pair, once from each end. */
export function laneGraph(systems: Systems): {
  points: MeshPoint[];
  edges: Array<[number, number]>;
} {
  // The L-Cluster is cut off on purpose, reached by its gateway, so it is no island to join.
  const cut = new Set<number>();
  for (const s of systems.values()) if (isLClusterSystem(s)) cut.add(s.id);
  const points: MeshPoint[] = [];
  const edges: Array<[number, number]> = [];
  for (const s of systems.values()) {
    if (cut.has(s.id)) continue;
    points.push({ id: s.id, x: s.x, y: s.y });
    for (const lane of s.lanes) {
      if (lane.to !== s.id && !cut.has(lane.to)) edges.push([s.id, lane.to]);
    }
  }
  return { points, edges };
}

/** How many separate clusters of systems the lanes leave, as the galaxy stands now. */
export function islandCount(systems: Systems): number {
  const { points, edges } = laneGraph(systems);
  return componentCount(points, edges);
}

function linked(systems: Systems, a: number, b: number): boolean {
  return systems.get(a)?.lanes.some((l) => l.to === b) ?? false;
}

function pairsWithin(
  systems: Systems,
  ids: number[],
  wantLinked: boolean,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = Math.min(ids[i], ids[j]);
      const b = Math.max(ids[i], ids[j]);
      if (a !== b && linked(systems, a, b) === wantLinked) pairs.push([a, b]);
    }
  }
  return pairs;
}

/** Unordered pairs within `ids` with no lane between them, each as `[min, max]`. */
export function unlinkedPairs(systems: Systems, ids: number[]): Array<[number, number]> {
  return pairsWithin(systems, ids, false);
}

/** The β-skeleton edges over `ids` that are not yet lanes, each as `[min, max]`. */
export function meshLanes(systems: Systems, ids: number[], beta: number): Array<[number, number]> {
  const points: MeshPoint[] = [];
  for (const id of ids) {
    const s = systems.get(id);
    if (s) points.push({ id, x: s.x, y: s.y });
  }
  return meshPairs(points, beta).filter(([a, b]) => !linked(systems, a, b));
}

/** Unordered pairs within `ids` joined by a lane, each as `[min, max]`. */
export function linkedPairs(systems: Systems, ids: number[]): Array<[number, number]> {
  return pairsWithin(systems, ids, true);
}

/** The ids in `ids` (other than `target`) that have a lane to `target`. */
export function linkedTo(systems: Systems, target: number, ids: number[]): number[] {
  return ids.filter((id) => id !== target && linked(systems, target, id));
}

/** The ids in `ids` (other than `target`) with no lane to `target`. */
export function unlinkedTo(systems: Systems, target: number, ids: number[]): number[] {
  return ids.filter((id) => id !== target && !linked(systems, target, id));
}

/** The ids in `ids` that have at least one lane. */
export function linkedSystems(systems: Systems, ids: number[]): number[] {
  return ids.filter((id) => (systems.get(id)?.lanes.length ?? 0) > 0);
}

/** The system of `ownerId` nearest the centroid of everything it owns. */
export function centralOwnedSystem(systems: Systems, ownerId: number): number | null {
  const owned = [...systems.values()].filter((s) => s.owner === ownerId);
  if (owned.length === 0) return null;
  const cx = owned.reduce((total, s) => total + s.x, 0) / owned.length;
  const cy = owned.reduce((total, s) => total + s.y, 0) / owned.length;
  let nearest = owned[0];
  let best = Infinity;
  for (const s of owned) {
    const distance = Math.hypot(s.x - cx, s.y - cy);
    if (distance < best) {
      best = distance;
      nearest = s;
    }
  }
  return nearest.id;
}

/** How many distinct lanes touching one of `ids` the core marked stale. */
export function staleLaneCount(systems: Systems, ids: number[]): number {
  const seen = new Set<string>();
  for (const id of ids) {
    for (const lane of systems.get(id)?.lanes ?? []) {
      if (!lane.stale) continue;
      seen.add(`${Math.min(id, lane.to)}-${Math.max(id, lane.to)}`);
    }
  }
  return seen.size;
}
