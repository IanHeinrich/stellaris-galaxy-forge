import type { Capabilities } from "../generated/Capabilities";
import { BRUSH_TOOLS, type BrushTool } from "./brush/brushTools";

/** What a left-drag on the map does: select and edit in place (ADR 0003), or one brush (ADR 0005). */
export type Tool = "select" | BrushTool;

export interface ToolEntry {
  id: Tool;
  /** The key that picks the tool, as `KeyboardEvent.key` gives it without Shift. */
  key: string;
  label: string;
}

const ENTRIES: Record<Tool, Omit<ToolEntry, "id">> = {
  select: { key: "v", label: "Select" },
  paint: { key: "b", label: "Paint systems" },
  erase: { key: "e", label: "Erase systems" },
  connect: { key: "c", label: "Connect lanes" },
  cut: { key: "x", label: "Cut lanes" },
};

/** The tools in the rail's order. */
export const TOOLS: readonly ToolEntry[] = (Object.keys(ENTRIES) as Tool[]).map((id) => ({
  id,
  ...ENTRIES[id],
}));

/** What the open document must support for `tool`; undefined when it works on every kind. */
export function toolRequires(tool: Tool): keyof Capabilities | undefined {
  return tool === "select" ? undefined : (BRUSH_TOOLS[tool].requires ?? undefined);
}
