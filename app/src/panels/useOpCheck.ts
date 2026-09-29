import type { Op } from "../generated/Op";
import { useEditorStore } from "../store/editorStore";
import { useOpCheckStore } from "../store/opCheckStore";

/**
 * Why `op` would be refused: a reason, null when it would apply, or undefined until the core has
 * answered. An answer from before the last edit, undo or redo is asked again. It asks from the
 * render rather than an effect, so a menu drawn once still asks.
 */
export function useOpCheck(op: Op): string | null | undefined {
  const key = JSON.stringify(op);
  const history = useEditorStore((s) => s.history);
  const check = useOpCheckStore((s) => s.answers.get(key));
  if (check?.history === history) return check.refusal;
  useOpCheckStore.getState().ask(key, history);
  return undefined;
}
