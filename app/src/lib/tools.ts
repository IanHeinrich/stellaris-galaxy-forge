import type { Capabilities } from "../generated/Capabilities";
import type { GuidePlace } from "./guideLinks";
import type { BrushTool } from "./brush/brushTools";

/**
 * What a left-drag on the map does: select and edit in place (ADR 0003), one brush (ADR 0005),
 * or draw a shape.
 */
export type Tool = "select" | BrushTool | "shape";

/** Where a tool's "?" opens the guide, and whether it sits on the options' first heading rather than at the row's end. */
export interface ToolHelp {
  place: GuidePlace;
  onHeading: boolean;
}

/** A "?" at the end of the options row. */
const atEnd = (place: GuidePlace): ToolHelp => ({ place, onHeading: false });

export interface ToolEntry {
  id: Tool;
  /** The key that picks the tool, as `KeyboardEvent.key` gives it without Shift. */
  key: string;
  label: string;
  /** The tool's "?"; null for a tool with no options row. */
  help: ToolHelp | null;
  /** What the open document must support for the tool to be offered; null for every kind. */
  requires: keyof Capabilities | null;
}

const ENTRIES: Record<Tool, Omit<ToolEntry, "id">> = {
  select: { key: "v", label: "Select", help: null, requires: null },
  paint: {
    key: "b",
    label: "Paint systems",
    help: atEnd("paintBrushes"),
    requires: "create_systems",
  },
  erase: {
    key: "e",
    label: "Erase systems",
    help: atEnd("paintBrushes"),
    requires: "create_systems",
  },
  shape: {
    key: "o",
    label: "Draw shapes",
    help: { place: "shapes", onHeading: true },
    requires: "bulk_add_systems",
  },
  connect: { key: "c", label: "Connect lanes", help: atEnd("laneBrushes"), requires: null },
  cut: { key: "x", label: "Cut lanes", help: atEnd("laneBrushes"), requires: null },
  height: {
    key: "h",
    label: "Height brush",
    help: atEnd("heightBrush"),
    requires: "system_heights",
  },
  spread: { key: "r", label: "Spread systems", help: atEnd("spreadBrush"), requires: null },
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
