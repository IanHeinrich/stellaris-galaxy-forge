import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import { shapePlacement } from "../lib/shapes/placement";
import { placeLead } from "../lib/shapes/shapeCopy";
import type { RunEdit } from "./editorEdits";
import type { EditorState } from "./editorStore";
import { placeSystems } from "./placeSystems";
import { shapeGround, shapePreview } from "./shapePreview";
import { useToolStore } from "./toolStore";

type ShapeActions = Pick<EditorState, "placePendingShape">;

export function shapeActions(
  _set: StoreApi<EditorState>["setState"],
  _get: StoreApi<EditorState>["getState"],
  runEdit: RunEdit,
): ShapeActions {
  return {
    async placePendingShape() {
      const pending = useToolStore.getState().pendingShape;
      const shown = shapePreview();
      if (pending === null || shown === null || shown.points.length === 0) return false;
      // Laid out again in the queue under the same seed, so an edit queued ahead is built on.
      const applied = runEdit(async () => {
        const ground = shapeGround();
        const placement = ground && shapePlacement(pending, ground);
        if (!placement || placement.points.length === 0) return null;
        return ipc.applyOp(placeSystems(placement, placeLead(pending)));
      }).then((result) => result !== null);
      useToolStore.setState({ pendingShape: null, placingShape: shown });
      try {
        return await applied;
      } finally {
        if (useToolStore.getState().placingShape === shown) {
          useToolStore.setState({ placingShape: null });
        }
      }
    },
  };
}
