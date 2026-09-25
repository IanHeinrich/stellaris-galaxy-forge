import { useFileSessionStore } from "../../store/fileSessionStore";
import { Dialog } from "../Dialog";
import "./overlays.css";

/** What a save found wrong with the map, and the three ways on from it. */
export function SaveIssuesDialog() {
  const prompt = useFileSessionStore((s) => s.saveIssuesPrompt);
  const answer = useFileSessionStore((s) => s.answerSaveIssues);
  const count = prompt?.count ?? 0;

  return (
    <Dialog
      className="save-issues-dialog"
      label="Save this map?"
      onClose={() => answer("cancel")}
      onDismiss={() => answer("cancel")}
    >
      <h1>Save this map?</h1>
      <p>
        This map has {count === 1 ? "1 issue" : `${count} issues`} that may change how it plays.
      </p>
      <div className="save-issues-actions">
        <button type="button" autoFocus onClick={() => answer("review")}>
          View issues
        </button>
        <button type="button" onClick={() => answer("save")}>
          Save anyway
        </button>
        <button type="button" onClick={() => answer("cancel")}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
