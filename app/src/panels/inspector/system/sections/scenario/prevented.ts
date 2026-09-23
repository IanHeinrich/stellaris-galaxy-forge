import type { Op } from "../../../../../generated/Op";

/** Lifts one `prevent_hyperlane` pair, leaving every other statement alone. */
export function unpreventLaneOp(system: number, other: number): Op {
  return { type: "UnpreventLane", a: system, b: other };
}
