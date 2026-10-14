import type { Capabilities } from "../generated/Capabilities";
import type { GuidePlace } from "./guideLinks";
import type { BrushTool } from "./brush/brushTools";

/**
 * What a left-drag on the map does: select and edit in place (ADR 0003), one brush (ADR 0005),
 * or draw a shape.
 */
export type Tool = "select" | BrushTool | "shape";

export interface ToolEntry {
  id: Tool;
  /** The key that picks the tool, as `KeyboardEvent.key` gives it without Shift. */
  key: string;
  label: string;
  /** Where the tool's "?" opens the guide; null for a tool with no options row. */
  help: GuidePlace | null;
  /** What the open document must support for the tool to be offered; null for every kind. */
  requires: keyof Capabilities | null;
}

const ENTRIES: Record<Tool, Omit<ToolEntry, "id">> = {
  select: { key: "v", label: "Select", help: null, requires: null },
  paint: { key: "b", label: "Paint systems", help: "paintBrushes", requires: "create_systems" },
  erase: { key: "e", label: "Erase systems", help: "paintBrushes", requires: "create_systems" },
  shape: { key: "o", label: "Draw shapes", help: "shapes", requires: "create_systems" },
  connect: { key: "c", label: "Connect lanes", help: "laneBrushes", requires: null },
  cut: { key: "x", label: "Cut lanes", help: "laneBrushes", requires: null },
  height: { key: "h", label: "Height brush", help: "heightBrush", requires: "system_heights" },
};

/** The tools in the rail's order. */
export const TOOLS: readonly ToolEntry[] = (Object.keys(ENTRIES) as Tool[]).map((id) => ({
  id,
  ...ENTRIES[id],
}));

/** A tool's row in `TOOLS`. */
export const TOOL_ENTRY: Record<Tool, ToolEntry> = Object.fromEntries(
  TOOLS.map((t) => [t.id, t]),
) as Record<Tool, ToolEntry>;

/** What the open document must support for `tool`; undefined when it works on every kind. */
export function toolRequires(tool: Tool): keyof Capabilities | undefined {
  return ENTRIES[tool].requires ?? undefined;
}
