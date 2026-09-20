import type { HistoryEntry } from "../../generated/HistoryEntry";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { ENTER, SPACE } from "../keys";
import "./browser.css";

/** The change log: applied ops oldest first, then the undone ones greyed; clicking jumps there. */
export function HistoryPanel() {
  const status = useFileSessionStore((s) => s.status);
  const history = useEditorStore((s) => s.history);
  const undoTo = useEditorStore((s) => s.undoTo);
  const redoTo = useEditorStore((s) => s.redoTo);

  if (status !== "ready") return null;
  const current = history.undo[history.undo.length - 1];
  const row = (entry: HistoryEntry, applied: boolean) => {
    const go = () => void (applied ? undoTo(entry.seq) : redoTo(entry.seq));
    return (
      <li
        key={entry.seq}
        role="button"
        tabIndex={0}
        className={applied ? (entry === current ? "current" : undefined) : "undone"}
        title={`${entry.description}
${applied ? "Undo back to" : "Redo forward to"} #${entry.seq}`}
        onClick={go}
        onKeyDown={(e) => {
          if (e.key !== ENTER && e.key !== SPACE) return;
          e.preventDefault();
          go();
        }}
      >
        <span className="muted">#{entry.seq}</span>
        <span className="history-label">{entry.description}</span>
      </li>
    );
  };
  return (
    <div className="history">
      <h3>Changes</h3>
      {history.undo.length === 0 && history.redo.length === 0 ? (
        <div className="muted">No changes yet.</div>
      ) : (
        <ul className="history-list">
          {history.undo.map((entry) => row(entry, true))}
          {history.redo.map((entry) => row(entry, false))}
        </ul>
      )}
    </div>
  );
}
