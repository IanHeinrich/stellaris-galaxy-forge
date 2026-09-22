import type { ReactNode } from "react";
import { useToolStore, type Tool } from "../../store/toolStore";
import "./chrome.css";

/** The controls a tool shows while it is active; null for a tool with none. */
function optionsFor(tool: Tool): ReactNode {
  switch (tool) {
    case "select":
    case "paint":
    case "erase":
    case "connect":
    case "cut":
      return null;
  }
}

/** The active brush's options, floating over the map's top-left corner beside the tool rail. */
export function ToolOptions() {
  const tool = useToolStore((s) => s.tool);
  const options = optionsFor(tool);
  if (options === null) return null;
  return (
    <div className="tool-options" role="toolbar" aria-label="Brush options">
      {options}
    </div>
  );
}
