/**
 * Deleting a whole system: the action's name, and the op that deletes one a save held when it
 * was opened.
 */
import type { Op } from "../../generated/Op";

export const DELETE_SYSTEM = "Delete system";

export function deleteSystemOp(system: number): Op {
  return { type: "DeleteSystem", system };
}

/** The confirm question for the description the core gives a delete ("Deleted X and 2 lanes, with ..."). */
export function deleteQuestion(description: string): string | null {
  const done = "Deleted ";
  return description.startsWith(done) ? `Delete ${description.slice(done.length)}?` : null;
}
