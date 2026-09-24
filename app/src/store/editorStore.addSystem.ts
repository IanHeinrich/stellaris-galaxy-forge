import { confirm } from "@tauri-apps/plugin-dialog";
import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import { addSystemRefusal, addedAmong, newSeed, type AddRefusal } from "../lib/addSystem";
import { counted } from "../lib/text";
import { distinctLanes } from "./editorStore.brush";
import {
  nearestSystem,
  refuseOr,
  systems,
  withTrackedSystem,
  withTrackedSystems,
  type RunEdit,
  type TrackedSystem,
} from "./editorEdits";
import type { EditorState } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";

type AddSystemActions = Pick<
  EditorState,
  "addRandomSystemAt" | "rerollSystem" | "renameAddedSystem" | "removeAddedSystems"
>;

/** Why a rolled system cannot go at a world point of the open save, or null when it can. */
export function addSystemRefusalAt(x: number, y: number): AddRefusal | null {
  const { meta } = useFileSessionStore.getState();
  const galaxy = useGalaxyStore.getState();
  const near = nearestSystem({ x, y });
  return addSystemRefusal({
    meta,
    gameData: useGameDataStore.getState().status === "ready",
    radius: galaxy.galaxy?.galaxy_radius ?? 0,
    x,
    y,
    nearest: near && {
      name: galaxy.systemName(near.id),
      distance: Math.hypot(near.x - x, near.y - y),
    },
  });
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
  return {
    addRandomSystemAt(x, y, starClass = null) {
      return refuseOr(addSystemRefusalAt(x, y)?.reason ?? null, async () => {
        const result = await runEdit(() => ipc.addRandomSystem(newSeed(), x, y, starClass));
        if (result === null) return false;
        const added = result.delta.systems
          .filter((s) => s.added)
          .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
        if (added) await get().select(added.id);
        return true;
      });
    },

    rerollSystem(id, starClass) {
      return withTrackedSystem(id, async (tracked) => {
        const result = await runEdit(async () => {
          const system = addedNow(tracked);
          if (!system) return null;
          const star = starClass === undefined ? system.star_class : starClass;
          return ipc.rerollSystem(system.id, newSeed(), star);
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

    async removeAddedSystems(ids) {
      const chosen = addedAmong(systems(), ids);
      if (chosen.length === 0) return false;
      return withTrackedSystems(chosen, async (tracked) => {
        const what = counted(chosen.length, "added system");
        const lanes = distinctLanes(chosen);
        const question =
          lanes === 0 ? `Delete ${what}?` : `Delete ${what} and their ${counted(lanes, "lane")}?`;
        const title = "Delete added systems";
        if (!(await confirm(question, { title, kind: "warning" }))) return false;
        const result = await runEdit(async () => {
          const now = tracked.flatMap((t) => addedNow(t)?.id ?? []);
          return now.length === 0 ? null : ipc.removeAddedSystems(now);
        });
        return result !== null;
      });
    },
  };
}
