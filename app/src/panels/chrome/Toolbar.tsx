import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import "./chrome.css";

/** Undo and redo, stacked in one column of the top bar's edit group (ADR 0003). */
export function Toolbar() {
  const status = useFileSessionStore((s) => s.status);
  const history = useEditorStore((s) => s.history);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  if (status !== "ready") return null;

  const undoEntry = history.undo[history.undo.length - 1];
  const redoEntry = history.redo[0];

  return (
    <div className="toolbar" role="group" aria-label="History">
      <button
        type="button"
        className="icon"
        disabled={history.undo.length === 0}
        aria-label="Undo"
        title={undoEntry ? `Undo ${undoEntry.description} (Ctrl+Z)` : "Undo (Ctrl+Z)"}
        onClick={() => void undo()}
      >
        ↶
      </button>
      <button
        type="button"
        className="icon"
        disabled={history.redo.length === 0}
        aria-label="Redo"
        title={redoEntry ? `Redo ${redoEntry.description} (Ctrl+Y)` : "Redo (Ctrl+Y)"}
        onClick={() => void redo()}
      >
        ↷
      </button>
    </div>
  );
}
