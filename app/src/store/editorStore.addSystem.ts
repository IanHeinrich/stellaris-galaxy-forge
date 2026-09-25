import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import type { EditResult } from "../generated/EditResult";
import type { SaveMeta } from "../generated/SaveMeta";
import { addSystemRefusal, type AddRefusal } from "../lib/addSystem";
import { newSeed } from "../lib/random";
import {
  nearestSystem,
  refuseOr,
  runAdd,
  systems,
  withTrackedSystem,
  type RunEdit,
  type TrackedSystem,
} from "./editorEdits";
import type { EditorState } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { systemNameOf, useGalaxyStore, type Systems } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";

type AddSystemActions = Pick<
  EditorState,
  "addRandomSystemAt" | "addSpecialSystemAt" | "rerollSystem" | "renameAddedSystem"
>;

/** What a refusal at a spot reads: the open save, whether game data is loaded and the galaxy. */
interface RefusalSources {
  meta: SaveMeta | null;
  gameData: boolean;
  systems: Systems;
  names: ReadonlyMap<string, string>;
  radius: number;
}

function refusalFrom(from: RefusalSources, x: number, y: number): AddRefusal | null {
  const near = nearestSystem({ x, y }, from.systems.values());
  return addSystemRefusal({
    meta: from.meta,
    gameData: from.gameData,
    radius: from.radius,
    x,
    y,
    nearest: near && {
      name: systemNameOf(from.systems, from.names, near.id),
      distance: Math.hypot(near.x - x, near.y - y),
    },
  });
}

/** Why a rolled system cannot go at a world point of the open save, or null when it can. */
export function addSystemRefusalAt(x: number, y: number): AddRefusal | null {
  const galaxy = useGalaxyStore.getState();
  const data = useGameDataStore.getState();
  return refusalFrom(
    {
      meta: useFileSessionStore.getState().meta,
      gameData: data.status === "ready",
      systems: galaxy.systems,
      names: data.names,
      radius: galaxy.galaxy?.galaxy_radius ?? 0,
    },
    x,
    y,
  );
}

/** `addSystemRefusalAt`, re-rendered whenever what it reads changes. */
export function useAddSystemRefusal(x: number, y: number): AddRefusal | null {
  const meta = useFileSessionStore((s) => s.meta);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const names = useGameDataStore((s) => s.names);
  const systems = useGalaxyStore((s) => s.systems);
  const radius = useGalaxyStore((s) => s.galaxy?.galaxy_radius ?? 0);
  return refusalFrom({ meta, gameData, systems, names, radius }, x, y);
}

/** The system a queued edit was asked about, as it stands when the edit runs, if it is still an added one. */
function addedNow(tracked: TrackedSystem) {
  const system = tracked.id === null ? undefined : systems().get(tracked.id);
  return system?.added ? system : undefined;
}

export function addSystemActions(
  _set: StoreApi<EditorState>["setState"],
  get: StoreApi<EditorState>["getState"],
  runEdit: RunEdit,
): AddSystemActions {
  /** Adds the system `edit` asks the core for at the spot, and selects it, unless the spot is refused. */
  function addAt(x: number, y: number, edit: () => Promise<EditResult>): Promise<boolean> {
    return refuseOr(addSystemRefusalAt(x, y)?.reason ?? null, async () => {
      const outcome = await runAdd(runEdit, x, y, edit);
      if (outcome === null) return false;
      if (outcome.added) await get().select(outcome.added.id);
      return true;
    });
  }

  return {
    addRandomSystemAt(x, y, starClass = null) {
      return addAt(x, y, () => ipc.addRandomSystem(newSeed(), x, y, starClass));
    },

    addSpecialSystemAt(x, y, layout) {
      return addAt(x, y, () => ipc.addSpecialSystem(newSeed(), x, y, layout));
    },

    rerollSystem(id, starClass) {
      return withTrackedSystem(id, async (tracked) => {
        const result = await runEdit(async () => {
          const system = addedNow(tracked);
          if (!system) return null;
          const same = starClass === undefined;
          const star = same ? system.star_class : starClass;
          return ipc.rerollSystem(system.id, newSeed(), star, same);
        });
        return result !== null;
      });
    },

    async renameAddedSystem(id, name) {
      const text = name.trim();
      if (text === "") return false;
      return withTrackedSystem(id, async (tracked) => {
        const result = await runEdit(async () => {
          const system = addedNow(tracked);
          if (!system) return null;
          return ipc.applyOp({ type: "RenameSaveSystem", system: system.id, name: text });
        });
        return result !== null;
      });
    },
  };
}
