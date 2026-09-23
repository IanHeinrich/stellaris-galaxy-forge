import type { Capabilities } from "../../generated/Capabilities";

export type BrushTool = "paint" | "erase" | "connect" | "cut";

/** What the erase brush takes: systems with their lanes, or only lanes. */
export type EraseTarget = "systems" | "lanes";

/** What one stroke does: lays systems, removes them, or adds or cuts lanes. */
export type StrokeKind = "paint" | "erase" | "connect" | "cut";

export interface BrushToolSpec {
  /** What a stroke of the tool does, given the erase target. */
  stroke(target: EraseTarget): StrokeKind;
  /** The tool Alt turns this one into, given the erase target. */
  inverse(target: EraseTarget): BrushTool;
  /** Whether its strokes add to the galaxy, drawn in the accent rather than the refusal red. */
  adds: boolean;
  /** What the open document must support for the tool to be offered. */
  requires: keyof Capabilities | null;
}

/** Every brush, and all that differs between them (ADR 0005). */
export const BRUSH_TOOLS: Record<BrushTool, BrushToolSpec> = {
  paint: {
    stroke: () => "paint",
    inverse: () => "erase",
    adds: true,
    requires: "create_systems",
  },
  erase: {
    stroke: (target) => (target === "lanes" ? "cut" : "erase"),
    inverse: (target) => (target === "lanes" ? "connect" : "paint"),
    adds: false,
    requires: "create_systems",
  },
  connect: {
    stroke: () => "connect",
    inverse: () => "cut",
    adds: true,
    requires: null,
  },
  cut: {
    stroke: () => "cut",
    inverse: () => "connect",
    adds: false,
    requires: null,
  },
};
