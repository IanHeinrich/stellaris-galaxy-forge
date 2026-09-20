import type { Op } from "../../../generated/Op";

/** Renames a system: the head's field writes the name the document states, key or literal. */
export function renameSystemOp(id: number, name: string): Op {
  return { type: "SetSystemName", id, name };
}
