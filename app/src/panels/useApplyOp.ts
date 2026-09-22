import { useCallback } from "react";
import type { Op } from "../generated/Op";
import { useEditorStore } from "../store/editorStore";

/** Applies an edit to the systems picked and, under symmetry, to their counterparts too. */
export function useApplySymmetricOp(): (op: Op) => void {
  return useCallback((op: Op) => void useEditorStore.getState().applySymmetric(op), []);
}

/** Applies an edit; a refused one leaves its reason on the store for the status bar to show. */
export function useApplyOp(): (op: Op) => void {
  return useCallback((op: Op) => void useEditorStore.getState().applyOp(op), []);
}
