import type { ReactNode } from "react";
import { documentCapabilities, supports } from "../../lib/capabilities";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { TOOL_REQUIRES, useToolStore, type Tool } from "../../store/toolStore";
import { SymmetryControl } from "./SymmetryControl";
import "./chrome.css";

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="rail-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

interface ToolEntry {
  id: Tool;
  label: string;
  /** The key that picks the tool, as the tooltip spells it. */
  key: string;
  icon: ReactNode;
}

const TOOLS: readonly ToolEntry[] = [
  {
    id: "select",
    label: "Select",
    key: "V",
    icon: (
      <Glyph>
        <path d="M4 2.5v10.2l2.9-2.7 2 4.2 1.8-.9-2-4.1 3.9-.3Z" fill="currentColor" />
      </Glyph>
    ),
  },
  {
    id: "paint",
    label: "Paint systems",
    key: "B",
    icon: (
      <Glyph>
        <path d="m13.5 2.5-6 6.5" />
        <path d="M7.5 9c-1.6-.5-3.2.4-3.5 2-.2 1.2-.8 2-1.5 2.5 2.4.6 5.5-.4 5.8-2.6Z" />
        <circle cx="11" cy="12.5" r=".6" fill="currentColor" />
        <circle cx="13.5" cy="10" r=".6" fill="currentColor" />
      </Glyph>
    ),
  },
  {
    id: "erase",
    label: "Erase systems",
    key: "E",
    icon: (
      <Glyph>
        <path d="M9.5 2.5 14 7l-6.5 6.5H4.5l-2-2Z" />
        <path d="m6 6 4.5 4.5" />
        <path d="M7.5 13.5h6" />
      </Glyph>
    ),
  },
  {
    id: "connect",
    label: "Connect lanes",
    key: "C",
    icon: (
      <Glyph>
        <circle cx="3.5" cy="11.5" r="1.5" />
        <circle cx="8" cy="4.5" r="1.5" />
        <circle cx="12.5" cy="11.5" r="1.5" />
        <path d="m4.3 10.2 2.9-4.4M8.8 5.8l2.9 4.4M5 11.5h6" />
      </Glyph>
    ),
  },
  {
    id: "cut",
    label: "Cut lanes",
    key: "X",
    icon: (
      <Glyph>
        <circle cx="4" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <path d="M5.2 10.6 11 2.5M10.8 10.6 5 2.5" />
      </Glyph>
    ),
  },
];

/** The map's tools down its left edge, the symmetry after them, and undo and redo at the foot (ADR 0005). */
export function ToolRail() {
  const tool = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  const capabilities = useFileSessionStore(documentCapabilities);
  const history = useEditorStore((s) => s.history);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const undoEntry = history.undo[history.undo.length - 1];
  const redoEntry = history.redo[0];

  return (
    <div className="tool-rail" role="toolbar" aria-orientation="vertical" aria-label="Map tools">
      <div className="tool-rail-group" role="group" aria-label="Tools">
        {TOOLS.filter((t) => supports(capabilities, TOOL_REQUIRES[t.id])).map((t) => (
          <button
            key={t.id}
            type="button"
            className="icon"
            aria-pressed={tool === t.id}
            aria-label={t.label}
            title={`${t.label} (${t.key})`}
            onClick={() => setTool(t.id)}
          >
            {t.icon}
          </button>
        ))}
      </div>
      <div className="tool-rail-group tool-rail-symmetry" role="group" aria-label="Symmetry">
        <SymmetryControl />
      </div>
      <div className="tool-rail-group tool-rail-foot" role="group" aria-label="History">
        <button
          type="button"
          className="icon"
          disabled={history.undo.length === 0}
          aria-label="Undo"
          title={undoEntry ? `Undo ${undoEntry.description} (Ctrl+Z)` : "Undo (Ctrl+Z)"}
          onClick={() => void undo()}
        >
          <Glyph>
            <path d="M5.5 3.5 2.5 6.5l3 3" />
            <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
          </Glyph>
        </button>
        <button
          type="button"
          className="icon"
          disabled={history.redo.length === 0}
          aria-label="Redo"
          title={redoEntry ? `Redo ${redoEntry.description} (Ctrl+Y)` : "Redo (Ctrl+Y)"}
          onClick={() => void redo()}
        >
          <Glyph>
            <path d="m10.5 3.5 3 3-3 3" />
            <path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9" />
          </Glyph>
        </button>
      </div>
    </div>
  );
}
