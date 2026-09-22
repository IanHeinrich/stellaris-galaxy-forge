import { confirm } from "@tauri-apps/plugin-dialog";
import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import type { Op } from "../generated/Op";
import type { Pair } from "../lib/brush/lanes";
import type { Pt } from "../lib/geometry/pt";
import { nextSystemId } from "../lib/paint";
import { counted } from "../lib/text";
import { runEdit, systems, type EditorState } from "./editorStore";

type BrushActions = Pick<EditorState, "paintStroke" | "eraseStroke" | "cutLanes" | "removeSystems">;

export function brushActions(
  _set: StoreApi<EditorState>["setState"],
  get: StoreApi<EditorState>["getState"],
): BrushActions {
  return {
    async paintStroke(points, pairs) {
      if (points.length === 0) return false;
      // Numbered in the queue, once any stroke sent before it has landed and taken its ids.
      return runEdit(() => ipc.applyOp(paintOp(points, pairs)));
    },

    async eraseStroke(ids) {
      if (ids.length === 0) return false;
      return get().applyOp(removeAll(ids, `Erased ${counted(ids.length, "system")}`));
    },

    async cutLanes(pairs) {
      if (pairs.length === 0) return false;
      return get().applyOp({
        type: "Batch",
        description: `Cut ${counted(pairs.length, "lane")}`,
        ops: [{ type: "RemoveLanePairs", lanes: pairs }],
      });
    },

    async removeSystems(ids) {
      const present = ids.filter((id) => systems().has(id));
      if (present.length === 0) return false;
      const lanes = distinctLanes(present);
      const what = counted(present.length, "system");
      const question =
        lanes === 0 ? `Delete ${what}?` : `Delete ${what} and their ${counted(lanes, "lane")}?`;
      if (!(await confirm(question, { title: "Delete systems", kind: "warning" }))) return false;
      return get().applyOp(removeAll(present, `Deleted ${what}`));
    },
  };
}

function paintOp(points: readonly Pt[], pairs: readonly Pair[]): Op {
  const first = nextSystemId(systems().values());
  const real = (id: number) => (id < 0 ? first - id - 1 : id);
  const ops: Op[] = points.map((p, i) => addSystem(first + i, p));
  if (pairs.length > 0) {
    ops.push({
      type: "AddLanePairs",
      lanes: pairs.map(([a, b]) => ({ a: real(a), b: real(b), bridge: false })),
    });
  }
  const lanes = pairs.length > 0 ? ` and ${counted(pairs.length, "lane")}` : "";
  return { type: "Batch", description: `Painted ${counted(points.length, "system")}${lanes}`, ops };
}

function addSystem(id: number, p: Pt): Op {
  return {
    type: "AddSystem",
    id,
    x: p.x,
    y: p.y,
    name: null,
    initializer: null,
    spawn_weight: null,
    spawn_script: null,
  };
}

function removeAll(ids: readonly number[], description: string): Op {
  return {
    type: "Batch",
    description,
    ops: ids.map((id): Op => ({ type: "RemoveSystem", id })),
  };
}

/** How many lanes touch at least one of `ids`, each counted once. */
function distinctLanes(ids: readonly number[]): number {
  const lanes = new Set<string>();
  for (const id of ids) {
    for (const lane of systems().get(id)?.lanes ?? []) {
      const [a, b]: Pair = id < lane.to ? [id, lane.to] : [lane.to, id];
      lanes.add(`${a},${b}`);
    }
  }
  return lanes.size;
}
