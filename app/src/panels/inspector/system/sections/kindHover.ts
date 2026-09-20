import type { SpecialKind } from "../../../../generated/SpecialKind";
import type { SystemNode } from "../../../../generated/SystemNode";
import { kindTitle } from "../../../../lib/special";

/** What a chip or a line naming one of a system's kinds says on hover. */
export function kindHover(system: SystemNode, kind: SpecialKind): string {
  const behind = `${system.initializer || "no initializer"}${
    system.flags.length > 0 ? ` · flags: ${system.flags.join(", ")}` : ""
  }`;
  return `${kindTitle(kind)} — ${behind}`;
}
