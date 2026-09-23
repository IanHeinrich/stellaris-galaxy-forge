import { useFileSessionStore } from "../../store/fileSessionStore";
import { Dialog } from "./Dialog";
import "./overlays.css";

/** A save whose file something else wrote since it was opened, and the three ways on from it. */
export function ChangedOnDiskDialog() {
  const answer = useFileSessionStore((s) => s.answerChangedOnDisk);

  return (
    <Dialog
      className="save-issues-dialog"
      label="The file changed on disk"
      onClose={() => answer("cancel")}
      onDismiss={() => answer("cancel")}
    >
      <h1>The file changed on disk</h1>
      <p>
        Something (probably Stellaris) wrote this file after you opened it. Overwriting keeps that
        newer version as a backup beside it.
      </p>
      <div className="save-issues-actions">
        <button type="button" autoFocus onClick={() => answer("save_as")}>
          Save As…
        </button>
        <button type="button" onClick={() => answer("overwrite")}>
          Overwrite
        </button>
        <button type="button" onClick={() => answer("cancel")}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
