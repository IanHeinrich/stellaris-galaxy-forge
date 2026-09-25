import { confirm } from "@tauri-apps/plugin-dialog";
import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import type { Capabilities } from "../generated/Capabilities";
import type { Op } from "../generated/Op";
import type { SystemNode } from "../generated/SystemNode";
import { addedAmong } from "../lib/addSystem";
import { documentCapabilities } from "../lib/capabilities";
import { PairSet } from "../lib/geometry/pairs";
import { counted } from "../lib/text";
import { systems, withTrackedSystems, type RunEdit } from "./editorEdits";
import type { Deletable, EditorState } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { symmetricIds } from "./symmetricEdits";

type RemoveActions = Pick<EditorState, "removeSystem" | "removeSystems" | "removeAddedSystems">;

export function removeActions(
  _set: StoreApi<EditorState>["setState"],
  get: StoreApi<EditorState>["getState"],
  runEdit: RunEdit,
): RemoveActions {
  return {
    async removeSystem(id) {
      await get().removeSystems([id]);
    },

    async removeSystems(ids) {
      const target = deletableSystems(ids.filter((id) => systems().has(id)));
      if (target === null || (target.kind !== "systems" && target.kind !== "added")) return false;
      const save = target.kind === "added";
      const chosen = save ? target.ids : symmetricIds(target.ids);
      const one = ids.length === 1 && chosen.length === 1;
      return withTrackedSystems(chosen, async (tracked) => {
        if (!(await confirm(...question(chosen, save, one)))) return false;
        const description = `Deleted ${counted(chosen.length, "system")}`;
        const result = await runEdit(async () => {
          const now = tracked.flatMap((t) => t.id ?? []);
          if (now.length === 0) return null;
          if (one) return ipc.applyOp({ type: "RemoveSystem", id: now[0] });
          return save ? ipc.removeAddedSystems(now) : ipc.applyOp(removeAll(now, description));
        });
        return result !== null;
      });
    },

    removeAddedSystems(ids) {
      return get().removeSystems([...ids]);
    },
  };
}

/**
 * Which of `ids` Delete would remove, or null for none: all of them where the document makes
 * and deletes systems, the ones added this session on a document that adds them.
 */
export function deletableSystems(
  ids: readonly number[],
  capabilities: Capabilities = documentCapabilities(useFileSessionStore.getState()),
  held: ReadonlyMap<number, SystemNode> = systems(),
): Deletable | null {
  if (ids.length === 0) return null;
  if (capabilities.create_systems) return { kind: "systems", ids: [...ids] };
  if (!capabilities.added_systems) return null;
  const added = addedAmong(held, ids);
  return added.length === 0 ? null : { kind: "added", ids: added };
}

/**
 * What Delete would remove, or null for nothing: the selected nebula or lane, or what
 * `deletableSystems` takes of the selection. The Edit menu and the key both ask it.
 */
export function deletableSelection(
  state: Pick<EditorState, "selection" | "selectedLane" | "selectedNebula">,
  capabilities?: Capabilities,
  held?: ReadonlyMap<number, SystemNode>,
): Deletable | null {
  const { selection, selectedLane, selectedNebula } = state;
  if (selectedNebula !== null) return { kind: "nebula", index: selectedNebula };
  if (selectedLane !== null) return { kind: "lane", lane: selectedLane };
  return deletableSystems(selection, capabilities, held);
}

export function canDelete(
  state: EditorState,
  capabilities?: Capabilities,
  held?: ReadonlyMap<number, SystemNode>,
): boolean {
  return deletableSelection(state, capabilities, held) !== null;
}

/**
 * The confirm dialog's question and options for deleting `ids`, the added systems of a save when
 * `save`; `one` names the one system asked about.
 */
function question(
  ids: readonly number[],
  save: boolean,
  one: boolean,
): [string, { title: string; kind: "warning" }] {
  const lanes = distinctLanes(ids);
  if (one) {
    const name = useGalaxyStore.getState().systemName(ids[0]);
    const what = lanes === 0 ? name : `${name} and its ${counted(lanes, "lane")}`;
    return [`Delete ${what}?`, { title: name, kind: "warning" }];
  }
  const what = counted(ids.length, save ? "added system" : "system");
  const text =
    lanes === 0 ? `Delete ${what}?` : `Delete ${what} and their ${counted(lanes, "lane")}?`;
  return [text, { title: save ? "Delete added systems" : "Delete systems", kind: "warning" }];
}

export function removeAll(ids: readonly number[], description: string): Op {
  return {
    type: "Batch",
    description,
    ops: [{ type: "RemoveSystems", ids: [...ids] }],
  };
}

/** How many lanes touch at least one of `ids`, each counted once. */
function distinctLanes(ids: readonly number[]): number {
  const lanes = new PairSet();
  for (const id of ids) {
    for (const lane of systems().get(id)?.lanes ?? []) lanes.add(id, lane.to);
  }
  return lanes.size;
}
