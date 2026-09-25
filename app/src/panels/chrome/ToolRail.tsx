import type { ReactNode } from "react";
import { documentCapabilities, supports } from "../../lib/capabilities";
import { shortcutLabel, toolAction } from "../../lib/keys";
import { TOOLS, toolRequires, type Tool } from "../../lib/tools";
import { redo, undo } from "../../store/commands";
import { nextRedo, nextUndo, useEditorStore } from "../../store/editorStore";
import { useCanEdit, useFileSessionStore } from "../../store/fileSessionStore";
import { useToolStore } from "../../store/toolStore";
import { Glyph } from "../Glyph";
import { SymmetryControl } from "./SymmetryControl";
import "./chrome.css";

function RailGlyph({ children }: { children: ReactNode }) {
  return <Glyph className="rail-icon">{children}</Glyph>;
}

const ICONS: Record<Tool, ReactNode> = {
  select: (
    <RailGlyph>
      <path d="M4 2.5v10.2l2.9-2.7 2 4.2 1.8-.9-2-4.1 3.9-.3Z" fill="currentColor" />
    </RailGlyph>
  ),
  paint: (
    <RailGlyph>
      <path d="m13.5 2.5-6 6.5" />
      <path d="M7.5 9c-1.6-.5-3.2.4-3.5 2-.2 1.2-.8 2-1.5 2.5 2.4.6 5.5-.4 5.8-2.6Z" />
      <circle cx="11" cy="12.5" r=".6" fill="currentColor" />
      <circle cx="13.5" cy="10" r=".6" fill="currentColor" />
    </RailGlyph>
  ),
  erase: (
    <RailGlyph>
      <path d="M9.5 2.5 14 7l-6.5 6.5H4.5l-2-2Z" />
      <path d="m6 6 4.5 4.5" />
      <path d="M7.5 13.5h6" />
    </RailGlyph>
  ),
  connect: (
    <RailGlyph>
      <circle cx="3.5" cy="11.5" r="1.5" />
      <circle cx="8" cy="4.5" r="1.5" />
      <circle cx="12.5" cy="11.5" r="1.5" />
      <path d="m4.3 10.2 2.9-4.4M8.8 5.8l2.9 4.4M5 11.5h6" />
    </RailGlyph>
  ),
  cut: (
    <RailGlyph>
      <circle cx="4" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <path d="M5.2 10.6 11 2.5M10.8 10.6 5 2.5" />
    </RailGlyph>
  ),
};

/** A button's tooltip: what it does, then its key. */
function titled(what: string, key: string): string {
  return `${what} (${key})`;
}

/** The map's tools down its left edge, the symmetry after them, and undo and redo at the foot (ADR 0005). */
export function ToolRail() {
  const tool = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  const capabilities = useFileSessionStore(documentCapabilities);
  const symmetryShown = useCanEdit("symmetry");
  const undoEntry = useEditorStore(nextUndo);
  const redoEntry = useEditorStore(nextRedo);

  return (
    <div className="tool-rail" role="toolbar" aria-orientation="vertical" aria-label="Map tools">
      <div className="tool-rail-group" role="group" aria-label="Tools">
        {TOOLS.filter((t) => supports(capabilities, toolRequires(t.id))).map((t) => (
          <button
            key={t.id}
            type="button"
            className="icon"
            aria-pressed={tool === t.id}
            aria-label={t.label}
            title={titled(t.label, shortcutLabel(toolAction(t.id)))}
            onClick={() => setTool(t.id)}
          >
            {ICONS[t.id]}
          </button>
        ))}
      </div>
      {symmetryShown && (
        <div className="tool-rail-group tool-rail-symmetry" role="group" aria-label="Symmetry">
          <SymmetryControl />
        </div>
      )}
      <div className="tool-rail-group tool-rail-foot" role="group" aria-label="History">
        <button
          type="button"
          className="icon"
          disabled={!undoEntry}
          aria-label="Undo"
          title={titled(
            undoEntry ? `Undo ${undoEntry.description}` : "Undo",
            shortcutLabel("undo"),
          )}
          onClick={undo}
        >
          <RailGlyph>
            <path d="M5.5 3.5 2.5 6.5l3 3" />
            <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
          </RailGlyph>
        </button>
        <button
          type="button"
          className="icon"
          disabled={!redoEntry}
          aria-label="Redo"
          title={titled(
            redoEntry ? `Redo ${redoEntry.description}` : "Redo",
            shortcutLabel("redo"),
          )}
          onClick={redo}
        >
          <RailGlyph>
            <path d="m10.5 3.5 3 3-3 3" />
            <path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9" />
          </RailGlyph>
        </button>
      </div>
    </div>
  );
}
