import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import type { EditResult } from "../generated/EditResult";
import { shapePlacement } from "../lib/shapes/placement";
import { shapePath } from "../lib/placement/rules";
import { arrangeDescription, placeLead } from "../lib/shapes/shapeCopy";
import type { PendingShape } from "../lib/shapes/types";
import { refuseOr, type RunEdit } from "./editorEdits";
import type { EditorState } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { arrangeSystems, placeDescription, placeSystems, rolledArgs } from "./placeSystems";
import { placementNow, shapeGround, shapePreview, shapeRefusal } from "./shapePreview";
import { useToolStore } from "./toolStore";

type ShapeActions = Pick<EditorState, "placePendingShape">;

/** How the open document takes a shape's systems. */
function pathNow() {
  return shapePath(useFileSessionStore.getState().capabilities);
}

/** Arranges `pending`'s selection again on the galaxy as it is now, as one Batch; refused as the preview would be. */
async function sendArrange(pending: PendingShape): Promise<EditResult | null> {
  const arranged = placementNow(pending)?.arranged;
  if (!arranged) return null;
  if (arranged.refusal !== null) throw new Error(arranged.refusal);
  return ipc.applyOp(arrangeSystems(arranged, arrangeDescription(pending, arranged.count)));
}

/** Lays `pending` out again on the galaxy as it is now and sends it the way the document takes it. */
async function sendShape(pending: PendingShape): Promise<EditResult | null> {
  if (pending.purpose.kind === "arrange") return sendArrange(pending);
  const ground = shapeGround(pending);
  const placement = ground && shapePlacement(pending, ground);
  if (!placement || placement.points.length === 0) return null;
  const lead = placeLead(pending);
  const path = pathNow();
  switch (path) {
    case null:
      return null;
    case "statements":
      return ipc.applyOp(placeSystems(placement, lead));
    case "rolled": {
      const refusal = shapeRefusal(placement, path);
      if (refusal !== null) throw new Error(refusal);
      const description = placeDescription(lead, placement.points, placement.pairs);
      const rolled = { ...placement, classes: placement.classes! };
      return ipc.addRandomSystems(rolledArgs(rolled, pending.seed, description));
    }
  }
}

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
      return refuseOr(shapeRefusal(shown, pathNow()), async () => {
        // Laid out again in the queue under the same seed, so an edit queued ahead is built on.
        const applied = runEdit(() => sendShape(pending)).then((result) => result !== null);
        useToolStore.setState({ pendingShape: null, placingShape: shown });
        let placed = false;
        try {
          placed = await applied;
          if (placed && pending.purpose.kind === "arrange") useToolStore.getState().leaveArrange();
          return placed;
        } finally {
          const tools = useToolStore.getState();
          if (tools.placingShape === shown) useToolStore.setState({ placingShape: null });
          // A refused or failed edit gives the shape back, unless the player has drawn another.
          if (!placed && tools.tool === "shape" && tools.pendingShape === null) {
            useToolStore.setState({ pendingShape: pending });
          }
        }
      });
    },
  };
}
