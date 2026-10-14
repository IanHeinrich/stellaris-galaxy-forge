import type { StoreApi } from "zustand";
import type { RunEdit } from "./editorEdits";
import type { EditorState } from "./editorStore";

type ShapeActions = Pick<EditorState, "placePendingShape">;

export function shapeActions(
  _set: StoreApi<EditorState>["setState"],
  _get: StoreApi<EditorState>["getState"],
  runEdit: RunEdit,
): ShapeActions {
  return {
    async placePendingShape() {
      // stub: W2 fills this; the edit sends nothing
      const placed = await runEdit(async () => null);
      return placed !== null;
    },
  };
}
