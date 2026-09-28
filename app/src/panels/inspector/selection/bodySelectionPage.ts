import { useEffect, useRef } from "react";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { usePlanetMoveStore, type BodySelection } from "../../../store/planetMoveStore";
import { useSceneSystem } from "../../../store/sceneStore";

/** What the inspector's stack does to follow the body selection. */
export type SummaryStep =
  { kind: "open"; entry: Entry } | { kind: "pop" } | { kind: "clear" } | null;

/**
 * The step that keeps the summary above the shown system's page while two or more of its bodies
 * are selected, and takes it away once fewer are. Leaving the summary by its crumbs, with the
 * selection as it was `before`, clears the selection, since the summary would only come back.
 */
export function summaryStep(
  selection: BodySelection | null,
  shown: number | null,
  stack: readonly Entry[],
  before: { selection: BodySelection | null; stack: readonly Entry[] },
): SummaryStep {
  const root = stack[0].ref;
  const page = stack.length > 1 ? stack[1] : null;
  const summary = page !== null && page.ref.kind === "bodies";
  const wanted =
    selection !== null &&
    selection.ids.length > 1 &&
    selection.system === shown &&
    root.kind === "system" &&
    root.id === shown;
  if (!wanted) return summary ? { kind: "pop" } : null;
  const left =
    selection === before.selection && stack.length === 1 && before.stack[1]?.ref.kind === "bodies";
  if (left) return { kind: "clear" };
  const label = `${selection.ids.length} selected`;
  if (summary && page.label === label) return null;
  return { kind: "open", entry: { ref: { kind: "bodies", system: selection.system }, label } };
}

/** Follows the body selection with the summary page, as `summaryStep` says. */
export function useBodySelectionPage(): void {
  const selection = usePlanetMoveStore((s) => s.selection);
  const shown = useSceneSystem();
  const stack = useInspectorStore((s) => s.stack);
  const seen = useRef({ selection, stack });
  useEffect(() => {
    const step = summaryStep(selection, shown, stack, seen.current);
    seen.current = { selection, stack };
    if (step === null) return;
    if (step.kind === "open") useInspectorStore.getState().openFromMap(step.entry);
    else if (step.kind === "pop") useInspectorStore.getState().popTo(0);
    else usePlanetMoveStore.getState().clearBodies();
  }, [selection, shown, stack]);
}
