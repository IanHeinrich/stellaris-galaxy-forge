import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import type { EditResult } from "../generated/EditResult";
import type { GalaxyDelta } from "../generated/GalaxyDelta";
import type { SearchHit } from "../generated/SearchHit";
import type { SystemNode } from "../generated/SystemNode";
import { renumberedId, renumberedIds, type Renumbering } from "../lib/renumber";
import { useDetailsStore } from "./detailsStore";
import type { EditorState, LaneRef } from "./editorStore";
import { useEntityStore } from "./entityStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore, type EntityRef } from "./inspectorStore";
import { useScriptsStore } from "./scriptsStore";
import { symmetricOp, symmetricSeat } from "./symmetricEdits";
import { useWatchlistStore } from "./watchlistStore";

/**
 * Runs one edit command through the queue and applies its result, resolving to it; null when
 * the edit was refused or sent nothing. An edit that reads the session to build its op reads it
 * inside `edit`, after every edit queued before it; one that answers null sent nothing.
 */
export type RunEdit = (edit: () => Promise<EditResult | null>) => Promise<EditResult | null>;

type EditActions = Pick<
  EditorState,
  "applyOp" | "applySymmetric" | "setSeat" | "undo" | "redo" | "undoTo" | "redoTo"
>;

export interface EditPipeline {
  actions: EditActions;
  runEdit: RunEdit;
  /** Leaves every late answer to the document that was open before to nobody. */
  newSession(): void;
}

/**
 * Every edit's one way onto the stores: ops queue one at a time, their results land on the
 * galaxy, the session and the editor, and a run of them reclassifies once. `reselect` re-reads
 * a selection an edit left stale, without moving the dock.
 */
export function editPipeline(
  set: StoreApi<EditorState>["setState"],
  get: StoreApi<EditorState>["getState"],
  reselect: (ids: number[]) => Promise<void>,
): EditPipeline {
  /** The session a late answer still belongs to; a document closing or opening leaves it to nobody. */
  let session = 0;

  function applyEdit(result: EditResult): void {
    useGalaxyStore.getState().applyDelta(result.delta);
    useFileSessionStore.getState().noteEdit({ issues: result.issues, dirty: result.dirty });
    set({ history: result.history });
    const touched = touchedSystems(result);
    useScriptsStore.getState().invalidate([...touched]);
    useEntityStore.getState().noteEdit(result);
    const before = get().selection;
    const pairs = renumbering(result.delta);
    if (pairs.length > 0) followRenumbering(pairs);
    const { selection, selectedLane } = get();
    const kept = selection.filter((id) => systems().has(id));
    // Only a single selection re-reads anything; a lane or the galaxy follows galaxyStore's version.
    const stale =
      selection !== before ||
      kept.length !== selection.length ||
      (kept.length === 1 && (touched.has(kept[0]) || showsTouched(touched, result.details_stale)));
    if (result.details_stale.length > 0) {
      useDetailsStore.getState().invalidate(result.details_stale);
      const mine = session;
      // The details projection, and the planet and fleet search index over it, are rebuilt lazily.
      void ipc.warmDetails().catch((e: unknown) => {
        if (mine === session) useFileSessionStore.getState().setError(ipc.errorMessage(e));
      });
    }
    if (stale) void reselect(kept);
    if (selectedLane && !laneExists(selectedLane)) set({ selectedLane: null });
    const { selectedNebula } = get();
    if (selectedNebula !== null && selectedNebula >= useGalaxyStore.getState().nebulae.length) {
      set({ selectedNebula: null });
    }
    const { hover } = get();
    if (hover !== null && !systems().has(hover)) set({ hover: null });
  }

  /**
   * Moves every system id the stores hold as the edit renumbered them; a removed system goes, with
   * the pages on its planets. The hover goes too: the pointer is on what the map drew before.
   */
  function followRenumbering(pairs: Renumbering): void {
    const { selection, selectedLane, searchRings, recentHits } = get();
    const lane = selectedLane && {
      a: renumberedId(pairs, selectedLane.a),
      b: renumberedId(pairs, selectedLane.b),
    };
    set({
      selection: renumberedIds(pairs, selection),
      hover: null,
      selectedLane:
        lane === null
          ? null
          : lane.a === null || lane.b === null
            ? null
            : { a: Math.min(lane.a, lane.b), b: Math.max(lane.a, lane.b) },
      searchRings: renumberedIds(pairs, searchRings),
      recentHits: renumberedHits(pairs, recentHits),
    });
    for (const tracked of trackers)
      tracked.id = tracked.id === null ? null : renumberedId(pairs, tracked.id);
    useInspectorStore.getState().renumber(pairs, planetsOf(removedBy(pairs)));
    useWatchlistStore.getState().renumber(pairs);
  }

  const runEdit: RunEdit = async (edit) => {
    const result = await enqueue(async () => {
      try {
        const answer = await edit();
        if (answer !== null) applyEdit(answer);
        return answer;
      } catch (e) {
        useFileSessionStore.getState().setError(ipc.errorMessage(e));
        return null;
      }
    });
    if (result?.reclassifies) await reclassify();
    return result;
  };

  /** Applies one history step, answering whether it re-classifies; a step with nothing left to do leaves the session alone. */
  async function stepEdit(step: () => Promise<EditResult | null>): Promise<boolean> {
    try {
      const result = await step();
      if (!result) return false;
      const held = new Set(systems().keys());
      applyEdit(result);
      // An undone removal or a redone add brings its system back selected.
      const back = cameBack(result.delta, held);
      if (back !== null) void reselect([back]);
      return result.reclassifies;
    } catch (e) {
      useFileSessionStore.getState().setError(ipc.errorMessage(e));
      return false;
    }
  }

  /** Repeats `step` until `done`, or until a step leaves the history unchanged; the run re-classifies once. */
  async function stepHistory(
    step: () => Promise<EditResult | null>,
    done: () => boolean,
  ): Promise<void> {
    let reclassifies = false;
    while (!done()) {
      const before = get().history;
      if (await enqueue(() => stepEdit(step))) reclassifies = true;
      if (get().history === before) break;
    }
    if (reclassifies) await reclassify();
  }

  const actions: EditActions = {
    async applyOp(op) {
      return (await runEdit(() => ipc.applyOp(op))) !== null;
    },

    applySymmetric(op) {
      return get().applyOp(symmetricOp(op));
    },

    async setSeat(id, seat) {
      const system = systems().get(id);
      const op = system && symmetricSeat(system, seat);
      return op ? get().applyOp(op) : false;
    },

    async undo() {
      if (await enqueue(() => stepEdit(ipc.undo))) await reclassify();
    },

    async redo() {
      if (await enqueue(() => stepEdit(ipc.redo))) await reclassify();
    },

    async undoTo(seq) {
      await stepHistory(ipc.undo, () => get().history.undo.length <= seq);
    },

    async redoTo(seq) {
      await stepHistory(ipc.redo, () => get().history.undo.length >= seq);
    },
  };

  return {
    actions,
    runEdit,
    newSession() {
      session += 1;
    },
  };
}

/** A system id held across queued edits: the renumberings that land before it runs move it. */
export interface TrackedSystem {
  /** The id the system has now; null once an edit removed it. */
  id: number | null;
}

const trackers = new Set<TrackedSystem>();

/** Follows `id` through every edit until `run` settles, handing `run` the id it has by then. */
export function withTrackedSystem<T>(
  id: number,
  run: (tracked: TrackedSystem) => Promise<T>,
): Promise<T> {
  return withTrackedSystems([id], ([tracked]) => run(tracked));
}

/** As `withTrackedSystem`, for each of `ids`. */
export async function withTrackedSystems<T>(
  ids: readonly number[],
  run: (tracked: TrackedSystem[]) => Promise<T>,
): Promise<T> {
  const tracked = ids.map((id): TrackedSystem => ({ id }));
  for (const t of tracked) trackers.add(t);
  try {
    return await run(tracked);
  } finally {
    for (const t of tracked) trackers.delete(t);
  }
}

/** The edit's renumbering; an edit that only removed systems reports each as gone. */
function renumbering(delta: GalaxyDelta): Renumbering {
  const pairs = delta.renumbered ?? [];
  if (pairs.length > 0) return pairs;
  return (delta.removed ?? []).map((id) => [id, null] as const);
}

function removedBy(pairs: Renumbering): number[] {
  return pairs.flatMap(([before, after]) => (after === null ? [before] : []));
}

/** The planets of `ids` as their cached details list them, read before the edit stales them. */
function planetsOf(ids: readonly number[]): Set<number> {
  const planets = new Set<number>();
  const { details } = useDetailsStore.getState();
  for (const id of ids) for (const p of details.get(id)?.planets ?? []) planets.add(p.id);
  return planets;
}

/** Hits as the edit left them: one on a removed system, or in one, goes. */
function renumberedHits(pairs: Renumbering, hits: SearchHit[]): SearchHit[] {
  let moved = false;
  const next: SearchHit[] = [];
  for (const hit of hits) {
    const id = hit.kind === "system" ? renumberedId(pairs, hit.id) : hit.id;
    const system = hit.system_id === null ? null : renumberedId(pairs, hit.system_id);
    if (id === null || (hit.system_id !== null && system === null)) {
      moved = true;
      continue;
    }
    if (id === hit.id && system === hit.system_id) {
      next.push(hit);
      continue;
    }
    moved = true;
    next.push({ ...hit, id, system_id: system });
  }
  return moved ? next : hits;
}

/** The added save system a history step brought back, which the galaxy did not hold before it. */
function cameBack(delta: GalaxyDelta, held: ReadonlySet<number>): number | null {
  const pairs = delta.renumbered ?? [];
  const before = new Set<number>();
  for (const id of held) {
    const after = renumberedId(pairs, id);
    if (after !== null) before.add(after);
  }
  const back = delta.systems.find((s) => s.added && !before.has(s.id));
  return back?.id ?? null;
}

export function systems() {
  return useGalaxyStore.getState().systems;
}

/** Reports `refusal` and resolves false, or runs `apply` when there is none. */
export function refuseOr(refusal: string | null, apply: () => Promise<boolean>): Promise<boolean> {
  if (refusal === null) return apply();
  useFileSessionStore.getState().setError(refusal);
  return Promise.resolve(false);
}

/** The system nearest a world point, wherever it is; null for a galaxy with none. */
export function nearestSystem(
  point: { x: number; y: number },
  among: Iterable<SystemNode> = systems().values(),
): SystemNode | null {
  let best: SystemNode | null = null;
  let bestD2 = Infinity;
  for (const s of among) {
    const d2 = (s.x - point.x) ** 2 + (s.y - point.y) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = s;
    }
  }
  return best;
}

let edits: Promise<unknown> = Promise.resolve();

/** Runs edits one at a time, so their results apply in the order they were asked for. */
function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const next = edits.then(run, run);
  edits = next.catch(() => undefined);
  return next;
}

/** The reclassification that still counts; a later edit's takes it over. */
let reclassification = 0;

/** What an initializer change moves: how a system is classified, and who its scripts give it to. */
async function reclassify(): Promise<void> {
  const mine = ++reclassification;
  // It reads the whole galaxy, so it waits outside the queue and a run of edits reclassifies once.
  await edits;
  const alive = () => mine === reclassification;
  if (!alive()) return;
  const data = useGameDataStore.getState();
  await data.refreshSpecial(alive);
  if (!alive()) return;
  await data.refreshScenarioOwners(alive);
}

/** What an edit touched: the systems it re-projected and the details it staled. */
function touchedSystems(result: EditResult): Set<number> {
  const touched = new Set<number>(result.details_stale);
  for (const node of result.delta.systems) touched.add(node.id);
  return touched;
}

/** The entities the inspector reaches through a system's details. */
type DetailRef = Extract<EntityRef, { kind: "planet" | "fleet" | "megastructure" }>;

/** True when what the inspector is looking at lives in a system the edit touched. */
function showsTouched(touched: Set<number>, detailsStale: number[]): boolean {
  const { stack } = useInspectorStore.getState();
  const ref = stack[stack.length - 1].ref;
  switch (ref.kind) {
    case "system":
      return touched.has(ref.id);
    case "starbase":
      return touched.has(ref.system);
    case "lane":
      return touched.has(ref.a) || touched.has(ref.b);
    case "planet":
    case "fleet":
    case "megastructure": {
      const owner = owningSystem(ref);
      return owner === null ? detailsStale.length > 0 : detailsStale.includes(owner);
    }
    default:
      return false;
  }
}

/** The system whose cached details list `ref`, or null while they are not cached. */
function owningSystem(ref: DetailRef): number | null {
  for (const details of useDetailsStore.getState().details.values()) {
    const members =
      ref.kind === "planet"
        ? details.planets
        : ref.kind === "fleet"
          ? details.fleets_present
          : details.megastructures;
    if (members.some((m) => m.id === ref.id)) return details.id;
  }
  return null;
}

function laneExists({ a, b }: LaneRef): boolean {
  return (
    useGalaxyStore
      .getState()
      .systems.get(a)
      ?.lanes.some((l) => l.to === b) ?? false
  );
}
