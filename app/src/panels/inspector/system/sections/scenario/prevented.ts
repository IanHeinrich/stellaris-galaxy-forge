import type { Op } from "../../../../../generated/Op";

/** Forbids the generator a lane between the two systems; the statement is mirrored on both ends. */
export function preventLaneOp(system: number, other: number): Op {
  return { type: "PreventLane", a: system, b: other };
}

/** Lifts one `prevent_hyperlane` pair, leaving every other statement alone. */
export function unpreventLaneOp(system: number, other: number): Op {
  return { type: "UnpreventLane", a: system, b: other };
}

/** The id the field names, or null while it names no whole number. */
export function preventTarget(text: string): number | null {
  const id = Number(text);
  return text.trim() === "" || !Number.isInteger(id) ? null : id;
}
