/**
 * Deleting a whole system: the action's name, and the op that deletes one a save held when it
 * was opened.
 */
import type { Op } from "../../generated/Op";

export const DELETE_SYSTEM = "Delete system";

export function deleteSystemOp(system: number): Op {
  return { type: "DeleteSystem", system };
}
