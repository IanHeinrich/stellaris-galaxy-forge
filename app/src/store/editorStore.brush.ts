import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import type { Op } from "../generated/Op";
import { joinIslands as lanesJoining } from "../lib/geometry/joinIslands";
import type { Pair } from "../lib/geometry/pairs";
import { counted } from "../lib/text";
import { systems, type RunEdit } from "./editorEdits";
import type { EditorState } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { islandCount, laneGraph } from "./galaxyStore";
import { removeAll } from "./editorStore.remove";
import { placeSystems } from "./placeSystems";

type BrushActions = Pick<
  EditorState,
  "paintStroke" | "eraseStroke" | "cutLanes" | "connectStroke" | "joinIslands"
>;

export function brushActions(
  _set: StoreApi<EditorState>["setState"],
  get: StoreApi<EditorState>["getState"],
  runEdit: RunEdit,
): BrushActions {
  return {
    async paintStroke(points, pairs) {
      if (points.length === 0) return false;
      // Numbered in the queue, once any stroke sent before it has landed and taken its ids.
      const painted = await runEdit(() => ipc.applyOp(placeSystems({ points, pairs }, "Painted")));
      return painted !== null;
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

    async connectStroke(pairs) {
      if (pairs.length === 0) return false;
      return get().applyOp(addLanes(pairs, `Connected ${counted(pairs.length, "lane")}`));
    },

    async joinIslands() {
      if (islandCount(systems()) <= 1) return false;
      const session = useFileSessionStore.getState();
      let left = 0;
      const joined = await get().applyOp(() => {
        const galaxy = systems();
        const before = islandCount(galaxy);
        if (before <= 1) return null;
        const { points, edges } = laneGraph(galaxy);
        const pairs = lanesJoining(points, edges);
        if (pairs.length === 0) {
          session.setError(`No hyperlane can join the ${before} islands without crossing another.`);
          return null;
        }
        left = before - pairs.length;
        const description =
          left === 1
            ? `Joined ${counted(before, "island")}`
            : `Joined islands with ${counted(pairs.length, "lane")}`;
        return addLanes(pairs, description);
      });
      if (joined && left > 1) {
        session.setNotice(
          `${counted(left, "island")} remain: no more hyperlanes can join them without crossing another.`,
        );
      }
      return joined;
    },
  };
}

function addLanes(pairs: readonly Pair[], description: string): Op {
  return {
    type: "Batch",
    description,
    ops: [{ type: "AddLanePairs", lanes: pairs.map(([a, b]) => ({ a, b, bridge: false })) }],
  };
}
