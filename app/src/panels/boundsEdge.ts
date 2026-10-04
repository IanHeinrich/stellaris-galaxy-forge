import type { Bounds } from "../generated/Bounds";

/** `edge` typed into one end of `bounds`; the other end moves with it rather than crossing. */
export function withEdge(bounds: Bounds, edge: "min" | "max", typed: number): Bounds {
  return edge === "min"
    ? { min: typed, max: Math.max(typed, bounds.max) }
    : { min: Math.min(typed, bounds.min), max: typed };
}
