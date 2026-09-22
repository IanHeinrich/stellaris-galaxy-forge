/** Single edits under the global symmetry: each op widened to every copy, as one edit. */
import type { LanePair } from "../generated/LanePair";
import type { NewSystem } from "../generated/NewSystem";
import type { Op } from "../generated/Op";
import type { SpawnScript } from "../generated/SpawnScript";
import type { SystemMove } from "../generated/SystemMove";
import type { SystemNode } from "../generated/SystemNode";
import type { Pair } from "../lib/brush/lanes";
import {
  copies,
  COUNTERPART_REACH,
  images,
  imageOf,
  type Symmetry,
} from "../lib/geometry/symmetry";
import { enabledScriptFor, nextSystemId } from "../lib/paint";
import { counted } from "../lib/text";
import { useGalaxyStore } from "./galaxyStore";
import { useToolStore } from "./toolStore";

/** Images of a new system closer than this to the original or to each other are one system. */
const COINCIDENT = 0.5;

function symmetry(): Symmetry {
  return useToolStore.getState().symmetry;
}

/** The system at image `k` of system `id`, which may be `id` itself; null where there is none. */
function imageId(id: number, k: number): number | null {
  const { systems, grid } = useGalaxyStore.getState();
  const s = systems.get(id);
  if (!s || !grid) return null;
  const p = imageOf(s, symmetry(), k);
  return grid.nearestSystem(p.x, p.y, COUNTERPART_REACH)?.id ?? null;
}

/** `ids` and every counterpart of them, each once, `ids` first. */
export function symmetricIds(ids: readonly number[]): number[] {
  const out = new Set(ids);
  const n = copies(symmetry());
  for (const id of ids) {
    for (let k = 1; k < n; k++) {
      const c = imageId(id, k);
      if (c !== null) out.add(c);
    }
  }
  return [...out];
}

interface OrbitMember {
  id: number;
  x: number;
  y: number;
  /** The copy this member is of its orbit's lead. */
  k: number;
}

/** A moved system and its counterparts, where they stood when the move began. */
interface Orbit {
  lead: OrbitMember;
  members: OrbitMember[];
}

/** Which systems a move carries, and by which image of whose displacement. */
export interface MovePlan {
  readonly symmetry: Symmetry;
  readonly orbits: readonly Orbit[];
}

/**
 * The systems in `ids` grouped with their counterparts, one orbit each. An orbit is led by the
 * first of its systems in `ids`, and every member takes its own copy's image of the lead's move.
 */
export function movePlan(ids: readonly number[]): MovePlan {
  const sym = symmetry();
  const all = useGalaxyStore.getState().systems;
  const placed = new Set<number>();
  const orbits: Orbit[] = [];
  for (const id of ids) {
    const s = all.get(id);
    if (!s || placed.has(id)) continue;
    const lead = { id, x: s.x, y: s.y, k: 0 };
    const members = [lead];
    placed.add(id);
    for (let k = 1; k < copies(sym); k++) {
      const c = imageId(id, k);
      if (c === null || placed.has(c)) continue;
      const at = all.get(c)!;
      members.push({ id: c, x: at.x, y: at.y, k });
      placed.add(c);
    }
    orbits.push({ lead, members });
  }
  return { symmetry: sym, orbits };
}

/** Every system `plan` carries, each moved by its copy's image of its lead's move in `moves`. */
export function plannedMoves(plan: MovePlan, moves: readonly SystemMove[]): SystemMove[] {
  const byId = new Map(moves.map((m) => [m.id, m]));
  return plan.orbits.flatMap(({ lead, members }) => {
    const to = byId.get(lead.id);
    if (!to) return [];
    const d = { x: to.x - lead.x, y: to.y - lead.y };
    return members.map((m) => {
      if (m === lead) return { id: m.id, x: to.x, y: to.y };
      const e = imageOf(d, plan.symmetry, m.k);
      return { id: m.id, x: m.x + e.x, y: m.y + e.y };
    });
  });
}

function key(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/** `lanes` and each one's images between the ends' counterparts that `wanted` takes, each once. */
function symmetricLanes(
  lanes: readonly LanePair[],
  wanted: (a: number, b: number) => boolean,
): LanePair[] {
  const out = new Map(lanes.map((l) => [key(l.a, l.b), l]));
  for (const l of lanes) {
    for (let k = 1; k < copies(symmetry()); k++) {
      const a = imageId(l.a, k);
      const b = imageId(l.b, k);
      if (a === null || b === null || a === b || out.has(key(a, b)) || !wanted(a, b)) continue;
      out.set(key(a, b), { a, b, bridge: l.bridge });
    }
  }
  return [...out.values()];
}

function linked(a: number, b: number): boolean {
  return (
    useGalaxyStore
      .getState()
      .systems.get(a)
      ?.lanes.some((l) => l.to === b) ?? false
  );
}

function barred(a: number, b: number): boolean {
  const all = useGalaxyStore.getState().systems;
  return !!all.get(a)?.prevented.includes(b) || !!all.get(b)?.prevented.includes(a);
}

/**
 * `entries` and, for every counterpart of their systems not already among them, the value
 * `counterpartValue` gives it, if any.
 */
function symmetricEntries<T>(
  entries: ReadonlyArray<readonly [number, T]>,
  counterpartValue: (value: T, counterpart: SystemNode) => T | undefined = (value) => value,
): Array<[number, T]> {
  const all = useGalaxyStore.getState().systems;
  const out = new Map<number, T>(entries);
  for (const [id, value] of entries) {
    for (const c of symmetricIds([id])) {
      const counterpart = all.get(c);
      if (out.has(c) || !counterpart) continue;
      const v = counterpartValue(value, counterpart);
      if (v !== undefined) out.set(c, v);
    }
  }
  return [...out];
}

/** A seat only one system can hold, Sol or one reserved for an empire: it stays where it was set. */
function reservedSeat(script: SpawnScript | null): boolean {
  const kind = script?.paint_a_galaxy.kind;
  return kind === "sol" || typeof kind === "object";
}

/** `script`'s seat on a counterpart, with the counterpart's own random value. */
function sameSeat(
  script: SpawnScript | null,
  counterpart: SystemNode,
): SpawnScript | null | undefined {
  if (script === null) return null;
  if (reservedSeat(script)) return undefined;
  const own = counterpart.spawn_script?.paint_a_galaxy.random_value ?? counterpart.id % 10;
  return { paint_a_galaxy: { ...script.paint_a_galaxy, random_value: own } };
}

const initializers = (all: Array<[number, string | null]>): Op => ({
  type: "SetInitializers",
  entries: all.map(([id, initializer]) => ({ id, initializer })),
});
const weights = (all: Array<[number, number | null]>): Op => ({
  type: "SetSpawnWeights",
  entries: all,
});
const scripts = (all: Array<[number, SpawnScript | null]>): Op => ({
  type: "SetSpawnScripts",
  entries: all,
});

/** `op` widened alone, or as one Batch named `description` when symmetry adds to it. */
function widened(op: Op, grew: boolean, wide: Op, description: string): Op {
  return grew ? { type: "Batch", description, ops: [wide] } : op;
}

function addSystems(op: Extract<Op, { type: "AddSystem" }>): Op {
  const { systems: all, grid } = useGalaxyStore.getState();
  const [origin, ...others] = images(op, symmetry());
  const kept = [origin];
  for (const p of others) {
    const apart = kept.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= COINCIDENT);
    if (apart && !grid?.nearestSystem(p.x, p.y, COINCIDENT)) kept.push(p);
  }
  if (kept.length === 1) return op;
  const first = op.id ?? nextSystemId(all.values());
  const { name, initializer, spawn_weight, spawn_script } = op;
  const systems = kept.map((p, i): NewSystem => ({
    id: first + i,
    x: p.x,
    y: p.y,
    name,
    initializer,
    spawn_weight,
    spawn_script: i === 0 || spawn_script === null ? spawn_script : enabledScriptFor(first + i),
  }));
  return {
    type: "Batch",
    description: `Added ${counted(systems.length, "system")}`,
    ops: [{ type: "AddSystems", systems }],
  };
}

export type MoveOp = Extract<Op, { type: "MoveSystem" | "MoveSystems" }>;

function movesOf(op: MoveOp): SystemMove[] {
  return op.type === "MoveSystem" ? [{ id: op.id, x: op.x, y: op.y }] : op.moves;
}

/** The ids `op` moves, in its order: the first of each orbit leads it. */
export function movedIds(op: MoveOp): number[] {
  return movesOf(op).map((m) => m.id);
}

/** `op` with the moves `plan` makes of it, as one Batch when that carries more systems. */
export function plannedMoveOp(plan: MovePlan, op: MoveOp): Op {
  const moves = movesOf(op);
  const all = plannedMoves(plan, moves);
  const wide: Op = { type: "MoveSystems", moves: all };
  if (all.length > moves.length) {
    return widened(op, true, wide, `Moved ${counted(all.length, "system")}`);
  }
  return op.type === "MoveSystem" ? op : wide;
}

function addLanes(op: Op, lanes: readonly LanePair[]): Op {
  const all = symmetricLanes(lanes, (a, b) => !linked(a, b) && !barred(a, b));
  const wide: Op = { type: "AddLanePairs", lanes: all };
  return widened(op, all.length > lanes.length, wide, `Added ${counted(all.length, "lane")}`);
}

function cutLanes(op: Op, pairs: readonly Pair[]): Op {
  const lanes = pairs.map(([a, b]) => ({ a, b, bridge: false }));
  const all = symmetricLanes(lanes, linked).map(({ a, b }): Pair => (a < b ? [a, b] : [b, a]));
  const wide: Op = { type: "RemoveLanePairs", lanes: all };
  return widened(op, all.length > pairs.length, wide, `Cut ${counted(all.length, "lane")}`);
}

function isolate(op: Op, ids: readonly number[]): Op {
  const asked = new Set(ids);
  const all = symmetricIds(ids).filter(
    (id) => asked.has(id) || (useGalaxyStore.getState().systems.get(id)?.lanes.length ?? 0) > 0,
  );
  const wide: Op = { type: "IsolateSystems", ids: all };
  return widened(op, all.length > ids.length, wide, `Isolated ${counted(all.length, "system")}`);
}

function remove(op: Op, ids: readonly number[]): Op {
  const all = symmetricIds(ids);
  const wide: Op = { type: "RemoveSystems", ids: all };
  return widened(op, all.length > ids.length, wide, `Deleted ${counted(all.length, "system")}`);
}

function entriesOp<T>(
  op: Op,
  entries: ReadonlyArray<readonly [number, T]>,
  build: (all: Array<[number, T]>) => Op,
  what: string,
  counterpartValue?: (value: T, counterpart: SystemNode) => T | undefined,
): Op {
  const all = symmetricEntries(entries, counterpartValue);
  return widened(
    op,
    all.length > entries.length,
    build(all),
    `Set the ${what} of ${counted(all.length, "system")}`,
  );
}

/**
 * `op` as the global symmetry makes it: adding, moving, deleting or isolating systems, adding or
 * cutting lanes and setting an initializer or spawn reach every counterpart too, the system
 * at each image of the one edited. An op symmetry adds nothing to is returned as it is.
 */
export function symmetricOp(op: Op): Op {
  if (symmetry().kind === "off") return op;
  switch (op.type) {
    case "AddSystem":
      return addSystems(op);
    case "MoveSystem":
    case "MoveSystems":
      return plannedMoveOp(movePlan(movedIds(op)), op);
    case "AddLane":
      return addLanes(op, [{ a: op.a, b: op.b, bridge: op.bridge }]);
    case "AddLanes":
      return addLanes(
        op,
        op.to.map(([to, bridge]) => ({ a: op.from, b: to, bridge })),
      );
    case "AddLanePairs":
      return addLanes(op, op.lanes);
    case "RemoveLane":
      return cutLanes(op, [[op.a, op.b]]);
    case "RemoveLanes":
      return cutLanes(
        op,
        op.to.map((to): Pair => [op.from, to]),
      );
    case "RemoveLanePairs":
      return cutLanes(op, op.lanes);
    case "IsolateSystem":
      return isolate(op, [op.id]);
    case "IsolateSystems":
      return isolate(op, op.ids);
    case "RemoveSystem":
      return remove(op, [op.id]);
    case "RemoveSystems":
      return remove(op, op.ids);
    case "SetInitializer":
      return entriesOp(op, [[op.id, op.initializer]], initializers, "initializer");
    case "SetInitializers":
      return entriesOp(
        op,
        op.entries.map((e) => [e.id, e.initializer] as const),
        initializers,
        "initializer",
      );
    case "SetSpawnWeight":
      return entriesOp(op, [[op.id, op.base]], weights, "spawn weight");
    case "SetSpawnWeights":
      return entriesOp(op, op.entries, weights, "spawn weight");
    case "SetSpawnScript":
      return entriesOp(op, [[op.id, op.script]], scripts, "seat", sameSeat);
    case "SetSpawnScripts":
      return entriesOp(op, op.entries, scripts, "seat", sameSeat);
    default:
      return op;
  }
}

/**
 * The seat `seat` makes of `system` and, under the global symmetry, the one it makes of each
 * counterpart, as one edit; null when it makes none of `system`. `seat` leaves a system it
 * returns undefined for as it is, and a seat reserved for one empire is set on `system` alone.
 */
export function symmetricSeat(
  system: SystemNode,
  seat: (system: SystemNode) => SpawnScript | null | undefined,
): Op | null {
  const script = seat(system);
  if (script === undefined) return null;
  const op: Op = { type: "SetSpawnScript", id: system.id, script };
  if (symmetry().kind === "off" || reservedSeat(script)) return op;
  return entriesOp(op, [[system.id, script]], scripts, "seat", (_, counterpart) =>
    seat(counterpart),
  );
}
