import type { StoreApi } from "zustand";
import type { Op } from "../generated/Op";
import { absoluteHeight, isFlat, relativeHeight } from "../lib/height";
import { systems } from "./editorEdits";
import type { EditorState } from "./editorStore";

/** What a bulk height edit does with its value: sets it, or moves each system's height by it. */
export type HeightChange = "set" | "raise" | "lower";

type HeightActions = Pick<
  EditorState,
  "setSystemHeight" | "setSelectedHeights" | "flattenSelected"
>;

/**
 * One op setting each of `ids` to the shown height `to` makes of its own, null when none of them
 * would move. Heights are written absolute; a system with no height stands on the plane.
 */
function heightsOp(ids: readonly number[], to: (relative: number) => number): Op | null {
  const heights = ids.flatMap((id) => {
    const system = systems().get(id);
    if (!system) return [];
    const from = relativeHeight(system.height);
    const next = to(from);
    return isFlat(next - from) ? [] : [{ id, height: absoluteHeight(next) }];
  });
  return heights.length === 0 ? null : { type: "SetSystemHeights", heights };
}

function changed(change: HeightChange, value: number): (relative: number) => number {
  switch (change) {
    case "set":
      return () => value;
    case "raise":
      return (relative) => relative + value;
    case "lower":
      return (relative) => relative - value;
  }
}

export function heightActions(get: StoreApi<EditorState>["getState"]): HeightActions {
  return {
    setSystemHeight(id, relative) {
      return get().applyOp(() => heightsOp([id], () => relative));
    },

    setSelectedHeights(change, value) {
      return get().applyOp(() => heightsOp(get().selection, changed(change, value)));
    },

    flattenSelected() {
      return get().applyOp(() => heightsOp(get().selection, () => 0));
    },
  };
}
