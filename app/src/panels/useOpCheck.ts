import type { Op } from "../generated/Op";
import { useOpCheckStore } from "../store/opCheckStore";

/**
 * Why `op`, about a body of `system`, would be refused: a reason, null when it would apply,
 * or undefined until the core has answered. It is asked again once an edit, undo or redo
 * stales that system's details. It asks from the render rather than an effect, so a menu
 * drawn once still asks.
 */
export function useOpCheck(op: Op, system: number | null): string | null | undefined {
  const key = JSON.stringify(op);
  const generation = useOpCheckStore((s) =>
    system === null ? 0 : (s.generations.get(system) ?? 0),
  );
  const check = useOpCheckStore((s) => s.answers.get(key));
  if (check?.generation === generation) return check.refusal;
  useOpCheckStore.getState().ask(key, generation);
  return undefined;
}
