import { create } from "zustand";
import type { CountryNode } from "../generated/CountryNode";
import type { GalaxyDelta } from "../generated/GalaxyDelta";
import type { GalaxyView } from "../generated/GalaxyView";
import type { HeaderField } from "../generated/HeaderField";
import type { LGate } from "../generated/LGate";
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
  /** A save's L-Gate outcome as it now reads, on its own so an edit of it leaves `galaxy` alone. */
  lgate: LGate | null;
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
  lgate: null,
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
      lgate: view.lgate,
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
    const previous = get().systems;
    const systems = new Map(previous);
    let rewired = false;
    for (const id of delta.removed ?? []) {
      rewired ||= systems.has(id);
      systems.delete(id);
      grid?.remove(id);
    }
    for (const node of delta.systems) {
      const stampedNode = stamped(node, scriptedOwners);
      rewired ||= rewires(previous.get(node.id), stampedNode);
      systems.set(node.id, stampedNode);
      grid?.update(stampedNode);
    }
    if (!rewired) sameTopology(previous, systems);
    const nebulae = delta.nebulae ?? get().nebulae;
    const header = delta.header ?? get().header;
    const waylines = delta.waylines ?? get().waylines;
    const lgate = delta.lgate ?? get().lgate;
    set({ systems, nebulae, header, waylines, lgate, lastDelta: delta, version: version + 1 });
  },

  setScriptedOwners(owners, countries) {
    const { grid, scriptedOwners: previous } = get();
    const systems = new Map(get().systems);
    sameTopology(get().systems, systems);
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
      lgate: null,
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

/** What a galaxy's lanes and L-Cluster decide, shared by every galaxy an edit left them alone in. */
interface Topology {
  lanes?: number;
  islands?: number;
  selections?: WeakMap<readonly number[], SelectionLanes>;
}

const topologies = new WeakMap<Systems, Topology>();

function topologyOf(systems: Systems): Topology {
  let topology = topologies.get(systems);
  if (topology === undefined) {
    topology = {};
    topologies.set(systems, topology);
  }
  return topology;
}

/** Records that `next` has the lanes and L-Cluster of `previous`, so what they decide carries over. */
function sameTopology(previous: Systems, next: Systems): void {
  topologies.set(next, topologyOf(previous));
}

/** Whether replacing `before` with `after` can change a lane or the L-Cluster. */
function rewires(before: SystemNode | undefined, after: SystemNode): boolean {
  if (before === undefined || isLClusterSystem(before) !== isLClusterSystem(after)) return true;
  if (before.lanes.length !== after.lanes.length) return true;
  return before.lanes.some((lane, i) => lane.to !== after.lanes[i].to);
}

/** `laneCount` of a galaxy, counted again only after an edit that changes its lanes. */
export function galaxyLaneCount(systems: Systems): number {
  const topology = topologyOf(systems);
  topology.lanes ??= laneCount(systems.values());
  return topology.lanes;
}

/** `islandCount` of a galaxy, counted again only after an edit that changes its lanes. */
export function galaxyIslandCount(systems: Systems): number {
  const topology = topologyOf(systems);
  topology.islands ??= islandCount(systems);
  return topology.islands;
}

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

/** The lanes among a set of systems. */
export interface SelectionLanes {
  /** Each lane between two of them as `[min, max]`, in the order the pairs appear in the ids. */
  linked: Array<[number, number]>;
  /** How many unordered pairs of them have no lane between them. */
  unlinked: number;
}

/**
 * The lanes among `ids` (distinct), found from each one's own lanes rather than pair by pair,
 * and kept for the same ids until an edit changes the galaxy's lanes.
 */
export function selectionLanes(systems: Systems, ids: readonly number[]): SelectionLanes {
  const topology = topologyOf(systems);
  topology.selections ??= new WeakMap();
  let found = topology.selections.get(ids);
  if (found === undefined) {
    found = lanesAmong(systems, ids);
    topology.selections.set(ids, found);
  }
  return found;
}

function lanesAmong(systems: Systems, ids: readonly number[]): SelectionLanes {
  const position = new Map<number, number>();
  ids.forEach((id, i) => position.set(id, i));
  const found: Array<{ first: number; second: number; pair: [number, number] }> = [];
  for (const [i, id] of ids.entries()) {
    const partners = new Set<number>();
    for (const { to } of systems.get(id)?.lanes ?? []) {
      const j = position.get(to);
      // A pair is linked by the lanes of its lower id, as `linked` reads it.
      if (j === undefined || to <= id || partners.has(to)) continue;
      partners.add(to);
      found.push({ first: Math.min(i, j), second: Math.max(i, j), pair: [id, to] });
    }
  }
  found.sort((p, q) => p.first - q.first || p.second - q.second);
  const k = ids.length;
  return { linked: found.map((f) => f.pair), unlinked: (k * (k - 1)) / 2 - found.length };
}

/** Unordered pairs within `ids` with no lane between them, each as `[min, max]`. */
export function unlinkedPairs(systems: Systems, ids: number[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = Math.min(ids[i], ids[j]);
      const b = Math.max(ids[i], ids[j]);
      if (a !== b && !linked(systems, a, b)) pairs.push([a, b]);
    }
  }
  return pairs;
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
  return selectionLanes(systems, ids).linked;
}

/** The ids in `ids` (other than `target`) that have a lane to `target`. */
export function linkedTo(systems: Systems, target: number, ids: number[]): number[] {
  return ids.filter((id) => id !== target && linked(systems, target, id));
}

/** The ids in `ids` (other than `target`) with no lane to `target`. */
export function unlinkedTo(systems: Systems, target: number, ids: number[]): number[] {
  return ids.filter((id) => id !== target && !linked(systems, target, id));
}

/** Whether the scenario keeps a lane from between `a` and `b`, which either end may name. */
export function isPrevented(systems: Systems, a: number, b: number): boolean {
  return !!systems.get(a)?.prevented.includes(b) || !!systems.get(b)?.prevented.includes(a);
}

/** The ids in `ids` (other than `target`) the scenario does not yet keep from a lane to `target`. */
export function unpreventedTo(systems: Systems, target: number, ids: number[]): number[] {
  return ids.filter((id) => id !== target && !isPrevented(systems, target, id));
}

/** The ids in `ids` (other than `target`) the scenario keeps from a lane to `target`. */
export function preventedTo(systems: Systems, target: number, ids: number[]): number[] {
  return ids.filter((id) => id !== target && isPrevented(systems, target, id));
}

/** The ids in `ids` that have at least one lane. */
export function linkedSystems(systems: Systems, ids: number[]): number[] {
  return ids.filter((id) => (systems.get(id)?.lanes.length ?? 0) > 0);
}

/** The system of `ownerId` nearest the centroid of everything it owns. */
export function centralOwnedSystem(systems: Systems, ownerId: number): number | null {
  return centralOf([...systems.values()].filter((s) => s.owner === ownerId));
}

/** `centralOwnedSystem` of every owner at once, in one pass over the galaxy. */
export function centralOwnedSystems(systems: Systems): Map<number, number> {
  const byOwner = new Map<number, SystemNode[]>();
  for (const s of systems.values()) {
    if (s.owner === null) continue;
    const owned = byOwner.get(s.owner);
    if (owned) owned.push(s);
    else byOwner.set(s.owner, [s]);
  }
  const central = new Map<number, number>();
  for (const [owner, owned] of byOwner) central.set(owner, centralOf(owned)!);
  return central;
}

function centralOf(owned: readonly SystemNode[]): number | null {
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
