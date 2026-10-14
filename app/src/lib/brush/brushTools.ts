export type BrushTool = "paint" | "erase" | "connect" | "cut" | "height";

/** What the erase brush takes: systems with their lanes, or only lanes. */
export type EraseTarget = "systems" | "lanes";

/** What one stroke does: lays systems, removes them, adds or cuts lanes, or moves heights. */
export type StrokeKind = "paint" | "erase" | "connect" | "cut" | "height";

export interface BrushToolSpec {
  /** What a stroke of the tool does, given the erase target. */
  stroke(target: EraseTarget): StrokeKind;
  /** The tool Alt turns this one into, given the erase target; null where Alt flips the brush itself. */
  inverse(target: EraseTarget): BrushTool | null;
  /** Whether its strokes add to the galaxy, drawn in the accent rather than the refusal red. */
  adds: boolean;
}

/** Every brush, and all that differs between them (ADR 0005). */
export const BRUSH_TOOLS: Record<BrushTool, BrushToolSpec> = {
  paint: {
    stroke: () => "paint",
    inverse: () => "erase",
    adds: true,
  },
  erase: {
    stroke: (target) => (target === "lanes" ? "cut" : "erase"),
    inverse: (target) => (target === "lanes" ? "connect" : "paint"),
    adds: false,
  },
  connect: {
    stroke: () => "connect",
    inverse: () => "cut",
    adds: true,
  },
  cut: {
    stroke: () => "cut",
    inverse: () => "connect",
    adds: false,
  },
  height: {
    stroke: () => "height",
    inverse: () => null,
    adds: true,
  },
};
