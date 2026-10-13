import { diskChangeLine } from "../../lib/documentKinds";
import type { DocumentKind } from "../../generated/DocumentKind";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { diskChangeShown } from "../../store/fileSessionStore.refresh";
import "./chrome.css";

const DROPS_EDITS = "Reloading drops your unsaved changes and their undo history.";

/** What the banner says about the file, and what Reload costs, before the buttons. */
function diskChangeText(kind: DocumentKind | null, path: string | null, dirty: boolean): string {
  const what = diskChangeLine(kind, path);
  return dirty ? `${what} ${DROPS_EDITS}` : what;
}

/** One row under the top bar while the open file has changed on disk and the user hasn't said what to do. */
export function DiskChangeNotice() {
  const shown = useFileSessionStore(diskChangeShown);
  const kind = useFileSessionStore((s) => s.kind);
  const path = useFileSessionStore((s) => s.path);
  const dirty = useFileSessionStore((s) => s.dirty);
  const answer = useFileSessionStore((s) => s.answerDiskChange);
  if (shown !== "banner") return null;

  return (
    <div className="paint-notice disk-change-notice" role="alert">
      <span>{diskChangeText(kind, path, dirty)}</span>
      <span className="spacer" />
      <button type="button" onClick={() => void answer("reload")}>
        Reload
      </button>
      <button type="button" className="link" onClick={() => void answer("keep")}>
        {dirty ? "Keep my changes" : "Not now"}
      </button>
    </div>
  );
}
