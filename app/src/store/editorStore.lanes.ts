import type { StoreApi } from "zustand";
import { pairOf } from "../lib/geometry/pairs";
import { systems } from "./editorEdits";
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
  return {
    async connectSelected() {
      const { selection } = get();
      if (selection.length > CONNECT_ALL_MAX) return;
      const lanes = unlinkedPairs(systems(), selection).map(([a, b]) => ({ a, b, bridge: false }));
      if (lanes.length > 0) await get().applySymmetric({ type: "AddLanePairs", lanes });
    },

    async connectSelectedMesh() {
      const chrome = useMapChromeStore.getState();
      const lanes = meshLanes(systems(), get().selection, chrome.meshBeta).map(([a, b]) => ({
        a,
        b,
        bridge: false,
      }));
      if (lanes.length > 0) await get().applySymmetric({ type: "AddLanePairs", lanes });
      chrome.setLanePreview(null);
    },

    async connectSelectedTo(target) {
      const to = unlinkedTo(systems(), target, get().selection).map((id): [number, boolean] => [
        id,
        false,
      ]);
      if (to.length > 0) await get().applySymmetric({ type: "AddLanes", from: target, to });
    },

    async cutLanesBetweenSelected() {
      const lanes = linkedPairs(systems(), get().selection);
      if (lanes.length > 0) await get().applySymmetric({ type: "RemoveLanePairs", lanes });
    },

    async cutLanesToSelected(target) {
      const to = linkedTo(systems(), target, get().selection);
      if (to.length > 0) await get().applySymmetric({ type: "RemoveLanes", from: target, to });
    },

    async preventLanes(pairs) {
      const op = preventOp(pairs, true);
      return op !== null && get().applyOp(op);
    },

    async preventLanesToSelected(target) {
      const to = unpreventedTo(systems(), target, get().selection);
      await get().preventLanes(to.map((id) => pairOf(target, id)));
    },

    async allowLanesToSelected(target) {
      const to = preventedTo(systems(), target, get().selection);
      const op = allowOp(to.map((id) => pairOf(target, id)));
      if (op !== null) await get().applyOp(op);
    },

    async isolateSelected() {
      const ids = linkedSystems(systems(), get().selection);
      if (ids.length > 0) await get().applySymmetric({ type: "IsolateSystems", ids });
    },

    async resetSelectedLaneLengths() {
      if (!canEdit("lane_lengths")) return;
      const ids = get().selection;
      if (staleLaneCount(systems(), ids) > 0) {
        await get().applyOp({ type: "NormaliseLaneLengths", systems: ids });
      }
    },
  };
}
