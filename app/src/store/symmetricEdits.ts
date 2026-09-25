/** Single edits under the global symmetry: each op widened to every copy, as one edit. */
import type { LanePair } from "../generated/LanePair";
import type { NewSystem } from "../generated/NewSystem";
import type { Op } from "../generated/Op";
import type { SpawnScript } from "../generated/SpawnScript";
import type { SystemMove } from "../generated/SystemMove";
import type { SystemNode } from "../generated/SystemNode";
import { pairOf, PairMap, type Pair } from "../lib/geometry/pairs";
import {
  copies,
  COUNTERPART_REACH,
  counterpartAt,
  images,
  imageOf,
  type Symmetry,
} from "../lib/geometry/symmetry";
import { enabledScriptFor, nextSystemId } from "../lib/paint";
import { counted } from "../lib/text";
import { isPrevented, linked, useGalaxyStore } from "./galaxyStore";
import { useToolStore } from "./toolStore";

function symmetry(): Symmetry {
  return useToolStore.getState().symmetry;
}

/** The system at image `k` of system `id`, which may be `id` itself; null where there is none. */
function imageId(id: number, k: number): number | null {
  const { systems, grid } = useGalaxyStore.getState();
  const s = systems.get(id);
  return s && grid ? counterpartAt(grid, s, symmetry(), k) : null;
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

/** `lanes` and each one's images between the ends' counterparts that `wanted` takes, each once. */
function counterpartLanes(
  lanes: readonly LanePair[],
  wanted: (a: number, b: number) => boolean,
): LanePair[] {
  const out = new PairMap<LanePair>();
  for (const l of lanes) out.set(l.a, l.b, l);
  for (const l of lanes) {
    for (let k = 1; k < copies(symmetry()); k++) {
      const a = imageId(l.a, k);
      const b = imageId(l.b, k);
      if (a === null || b === null || a === b || out.has(a, b) || !wanted(a, b)) continue;
      out.set(a, b, { a, b, bridge: l.bridge });
    }
  }
  return [...out.values()];
}

function joined(a: number, b: number): boolean {
  return linked(useGalaxyStore.getState().systems, a, b);
}

function barred(a: number, b: number): boolean {
  return isPrevented(useGalaxyStore.getState().systems, a, b);
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
    const apart = kept.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= COUNTERPART_REACH);
    if (apart && !grid?.nearestSystem(p.x, p.y, COUNTERPART_REACH)) kept.push(p);
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
  const all = counterpartLanes(lanes, (a, b) => !joined(a, b) && !barred(a, b));
  const wide: Op = { type: "AddLanePairs", lanes: all };
  return widened(op, all.length > lanes.length, wide, `Added ${counted(all.length, "lane")}`);
}

function cutLanes(op: Op, pairs: readonly Pair[]): Op {
  const lanes = pairs.map(([a, b]) => ({ a, b, bridge: false }));
  const all = counterpartLanes(lanes, joined).map(({ a, b }) => pairOf(a, b));
  const wide: Op = { type: "RemoveLanePairs", lanes: all };
  return widened(op, all.length > pairs.length, wide, `Cut ${counted(all.length, "lane")}`);
}

/** `pairs` and each one's images between the ends' counterparts that `wanted` takes, each once. */
function counterpartPairs(
  pairs: readonly Pair[],
  wanted: (a: number, b: number) => boolean,
): Pair[] {
  const lanes = pairs.map(([a, b]) => ({ a, b, bridge: false }));
  return counterpartLanes(lanes, wanted).map(({ a, b }): Pair => [a, b]);
}

/** `ops` as one edit named `description`: the op itself when there is one, null when none. */
function oneEdit(ops: Op[], description: string): Op | null {
  if (ops.length <= 1) return ops[0] ?? null;
  return { type: "Batch", description, ops };
}

/**
 * Prevents a lane between each of `pairs` and, under the global symmetry, each counterpart pair
 * not prevented yet, as one edit; null when there is nothing to do. With `cutting` a lane
 * standing between any of them is cut first, even where the pair is already prevented. Without
 * it a pair joined by a lane is left out, as the core refuses to prevent it.
 */
export function preventOp(pairs: readonly Pair[], cutting: boolean): Op | null {
  const cuts = (a: number, b: number) => cutting && joined(a, b);
  const prevents = (a: number, b: number) => !barred(a, b) && (cutting || !joined(a, b));
  const wanted = (a: number, b: number) => cuts(a, b) || prevents(a, b);
  const all = counterpartPairs(pairs, wanted).filter(([a, b]) => wanted(a, b));
  const cut = all.filter(([a, b]) => cuts(a, b));
  const prevent = all.filter(([a, b]) => prevents(a, b));
  const ops: Op[] = [];
  if (cut.length === 1) ops.push({ type: "RemoveLane", a: cut[0][0], b: cut[0][1] });
  else if (cut.length > 1) ops.push({ type: "RemoveLanePairs", lanes: cut });
  for (const [a, b] of prevent) ops.push({ type: "PreventLane", a, b });
  return oneEdit(ops, preventDescription(prevent, cut.length));
}

function preventDescription(prevent: readonly Pair[], cut: number): string {
  if (cut === 0) return `Prevented ${counted(prevent.length, "lane")}`;
  if (prevent.length === 0) return `Cut ${counted(cut, "lane")}`;
  if (prevent.length === 1 && cut === 1) {
    return `Cut and prevented lane ${prevent[0][0]} <-> ${prevent[0][1]}`;
  }
  return `Cut ${counted(cut, "lane")} and prevented ${counted(prevent.length, "lane")}`;
}

/**
 * Allows a lane again between each of `pairs` and, under the global symmetry, each counterpart
 * pair the scenario prevents, as one edit; null for no pairs.
 */
export function allowOp(pairs: readonly Pair[]): Op | null {
  const all = counterpartPairs(pairs, barred).filter(([a, b]) => barred(a, b));
  const ops = all.map(([a, b]): Op => ({ type: "UnpreventLane", a, b }));
  return oneEdit(ops, `Allowed ${counted(all.length, "lane")}`);
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

type Widen<T extends Op["type"]> = (op: Extract<Op, { type: T }>) => Op;

/**
 * How the global symmetry widens each kind of op: adding, moving, deleting or isolating
 * systems, adding, cutting, preventing or allowing lanes and setting an initializer or spawn
 * reach every counterpart too, the system at each image of the one edited. Null for an op
 * symmetry leaves as it is.
 */
const WIDEN: { [T in Op["type"]]: Widen<T> | null } = {
  AddSystem: addSystems,
  MoveSystem: (op) => plannedMoveOp(movePlan(movedIds(op)), op),
  MoveSystems: (op) => plannedMoveOp(movePlan(movedIds(op)), op),
  AddLane: (op) => addLanes(op, [{ a: op.a, b: op.b, bridge: op.bridge }]),
  AddLanes: (op) =>
    addLanes(
      op,
      op.to.map(([to, bridge]) => ({ a: op.from, b: to, bridge })),
    ),
  AddLanePairs: (op) => addLanes(op, op.lanes),
  RemoveLane: (op) => cutLanes(op, [[op.a, op.b]]),
  RemoveLanes: (op) =>
    cutLanes(
      op,
      op.to.map((to): Pair => [op.from, to]),
    ),
  RemoveLanePairs: (op) => cutLanes(op, op.lanes),
  IsolateSystem: (op) => isolate(op, [op.id]),
  IsolateSystems: (op) => isolate(op, op.ids),
  RemoveSystem: (op) => remove(op, [op.id]),
  RemoveSystems: (op) => remove(op, op.ids),
  SetInitializer: (op) => entriesOp(op, [[op.id, op.initializer]], initializers, "initializer"),
  SetInitializers: (op) =>
    entriesOp(
      op,
      op.entries.map((e) => [e.id, e.initializer] as const),
      initializers,
      "initializer",
    ),
  SetSpawnWeight: (op) => entriesOp(op, [[op.id, op.base]], weights, "spawn weight"),
  SetSpawnWeights: (op) => entriesOp(op, op.entries, weights, "spawn weight"),
  SetSpawnScript: (op) => entriesOp(op, [[op.id, op.script]], scripts, "seat", sameSeat),
  SetSpawnScripts: (op) => entriesOp(op, op.entries, scripts, "seat", sameSeat),
  SetLaneLength: null,
  SetLaneLengths: null,
  NormaliseLaneLength: null,
  NormaliseLaneLengths: null,
  MoveNebula: null,
  AddNebula: null,
  RemoveNebula: null,
  SetNebulaRadius: null,
  SetNebulaName: null,
  AddSystems: null,
  SetSystemName: null,
  SetHeaderField: null,
  SetHeaderKeys: null,
  SetHeaderList: null,
  SetFeZone: null,
  SetFeZones: null,
  SetWormholePair: null,
  SetWormholeEnds: null,
  SetFeLinks: null,
  SetFeLinkFlags: null,
  PreventLane: (op) => preventOp([[op.a, op.b]], false) ?? op,
  UnpreventLane: (op) => allowOp([[op.a, op.b]]) ?? op,
  SetLGateOutcome: null,
  SetStarClass: null,
  SetPlanetSize: null,
  SetEmpireMapColors: null,
  AddSaveSystem: null,
  AddSaveDeposit: null,
  RemoveSaveDeposit: null,
  ReplaceSaveSystem: null,
  RenameSaveSystem: null,
  SetNebulaTurbulent: null,
  SetNebulaFootprints: null,
  Batch: null,
};

/** `op` as the global symmetry makes it; an op symmetry adds nothing to is returned as it is. */
export function symmetricOp(op: Op): Op {
  const widen = WIDEN[op.type] as ((op: Op) => Op) | null;
  return widen && copies(symmetry()) > 1 ? widen(op) : op;
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
  if (copies(symmetry()) === 1 || reservedSeat(script)) return op;
  return entriesOp(op, [[system.id, script]], scripts, "seat", (_, counterpart) =>
    seat(counterpart),
  );
}
