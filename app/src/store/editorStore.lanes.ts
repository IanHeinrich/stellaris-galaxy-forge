import type { StoreApi } from "zustand";
import type { Op } from "../generated/Op";
import { pairOf } from "../lib/geometry/pairs";
import { systems, withTrackedSystem } from "./editorEdits";
import type { EditorState } from "./editorStore";
import { canEdit } from "./fileSessionStore";
import {
  linkedPairs,
  linkedSystems,
  linkedTo,
  meshLanes,
  preventedTo,
  staleLaneCount,
  unlinkedPairs,
  unlinkedTo,
  unpreventedTo,
} from "./galaxyStore";
import { useMapChromeStore } from "./mapChromeStore";
import { allowOp, preventOp } from "./symmetricEdits";

/** Above this many selected systems "connect to each other" gives way to the mesh. */
export const CONNECT_ALL_MAX = 5;

type LaneActions = Pick<
  EditorState,
  | "connectSelected"
  | "connectSelectedMesh"
  | "connectSelectedTo"
  | "cutLanesBetweenSelected"
  | "cutLanesToSelected"
  | "preventLanes"
  | "preventLanesToSelected"
  | "allowLanesToSelected"
  | "isolateSelected"
  | "resetSelectedLaneLengths"
>;

export function laneActions(
  _set: StoreApi<EditorState>["setState"],
  get: StoreApi<EditorState>["getState"],
): LaneActions {
  /**
   * Applies what `build` makes of the selection and of `target` as both stand once the edits
   * queued before it have landed, widened under the global symmetry when `symmetric`.
   */
  function toTarget(
    target: number,
    build: (target: number, selection: number[]) => Op | null,
    symmetric = true,
  ): Promise<boolean> {
    return withTrackedSystem(target, (tracked) => {
      const op = () => (tracked.id === null ? null : build(tracked.id, get().selection));
      return symmetric ? get().applySymmetric(op) : get().applyOp(op);
    });
  }

  return {
    async connectSelected() {
      if (get().selection.length > CONNECT_ALL_MAX) return;
      await get().applySymmetric(() => {
        const { selection } = get();
        if (selection.length > CONNECT_ALL_MAX) return null;
        const lanes = unlinkedPairs(systems(), selection).map(([a, b]) => ({
          a,
          b,
          bridge: false,
        }));
        return lanes.length === 0 ? null : { type: "AddLanePairs", lanes };
      });
    },

    async connectSelectedMesh() {
      const chrome = useMapChromeStore.getState();
      const beta = chrome.meshBeta;
      await get().applySymmetric(() => {
        const lanes = meshLanes(systems(), get().selection, beta).map(([a, b]) => ({
          a,
          b,
          bridge: false,
        }));
        return lanes.length === 0 ? null : { type: "AddLanePairs", lanes };
      });
      chrome.setLanePreview(null);
    },

    async connectSelectedTo(target) {
      await toTarget(target, (from, selection) => {
        const to = unlinkedTo(systems(), from, selection).map((id): [number, boolean] => [
          id,
          false,
        ]);
        return to.length === 0 ? null : { type: "AddLanes", from, to };
      });
    },

    async cutLanesBetweenSelected() {
      await get().applySymmetric(() => {
        const lanes = linkedPairs(systems(), get().selection);
        return lanes.length === 0 ? null : { type: "RemoveLanePairs", lanes };
      });
    },

    async cutLanesToSelected(target) {
      await toTarget(target, (from, selection) => {
        const to = linkedTo(systems(), from, selection);
        return to.length === 0 ? null : { type: "RemoveLanes", from, to };
      });
    },

    preventLanes(pairs) {
      return get().applyOp(() => preventOp(pairs, true));
    },

    async preventLanesToSelected(target) {
      await toTarget(
        target,
        (from, selection) =>
          preventOp(
            unpreventedTo(systems(), from, selection).map((id) => pairOf(from, id)),
            true,
          ),
        false,
      );
    },

    async allowLanesToSelected(target) {
      await toTarget(
        target,
        (from, selection) =>
          allowOp(preventedTo(systems(), from, selection).map((id) => pairOf(from, id))),
        false,
      );
    },

    async isolateSelected() {
      await get().applySymmetric(() => {
        const ids = linkedSystems(systems(), get().selection);
        return ids.length === 0 ? null : { type: "IsolateSystems", ids };
      });
    },

    async resetSelectedLaneLengths() {
      if (!canEdit("lane_lengths")) return;
      await get().applyOp(() => {
        const ids = get().selection;
        return staleLaneCount(systems(), ids) === 0
          ? null
          : { type: "NormaliseLaneLengths", systems: ids };
      });
    },
  };
}
