import type { Capabilities } from "../generated/Capabilities";
import type { GuidePlace } from "./guideLinks";
import { BRUSH_TOOLS, type BrushTool } from "./brush/brushTools";

/** What a left-drag on the map does: select and edit in place (ADR 0003), or one brush (ADR 0005). */
export type Tool = "select" | BrushTool;

export interface ToolEntry {
  id: Tool;
  /** The key that picks the tool, as `KeyboardEvent.key` gives it without Shift. */
  key: string;
  label: string;
  /** Where the tool's "?" opens the guide; null for a tool with no options row. */
  help: GuidePlace | null;
}

const ENTRIES: Record<Tool, Omit<ToolEntry, "id">> = {
  select: { key: "v", label: "Select", help: null },
  paint: { key: "b", label: "Paint systems", help: "paintBrushes" },
  erase: { key: "e", label: "Erase systems", help: "paintBrushes" },
  connect: { key: "c", label: "Connect lanes", help: "laneBrushes" },
  cut: { key: "x", label: "Cut lanes", help: "laneBrushes" },
  height: { key: "h", label: "Height brush", help: "heightBrush" },
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
  return tool === "select" ? undefined : (BRUSH_TOOLS[tool].requires ?? undefined);
}
