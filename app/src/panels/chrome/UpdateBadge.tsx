import { releaseHeadline } from "../../lib/releaseNotes";
import { updateReady, useUpdateStore } from "../../store/updateStore";
import "./chrome.css";

/** The only nudge a found update gets in the top bar; the dialog behind it has the rest. */
export function UpdateBadge() {
  const ready = useUpdateStore(updateReady);
  const update = useUpdateStore((s) => s.update);
  const showDialog = useUpdateStore((s) => s.showDialog);
  if (!ready || update === null) return null;

  const headline = releaseHeadline(update.notes);
  return (
    <button
      type="button"
      className="badge update-badge"
      title={headline || undefined}
      onClick={showDialog}
    >
      Update {update.version}
    </button>
  );
}
