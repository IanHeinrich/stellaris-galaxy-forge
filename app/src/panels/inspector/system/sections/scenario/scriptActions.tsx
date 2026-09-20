import * as ipc from "../../../../../api/ipc";
import { fileName } from "../../../../../lib/paths";
import { useFileSessionStore } from "../../../../../store/fileSessionStore";

/** A file the install no longer holds, or that the shell refuses, says so where every other failure does. */
function report(action: Promise<unknown>): void {
  void action.catch((e) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
}

/**
 * The two ways out to a game-data file; a row whose script is not a file of its own has neither.
 * The default is cancelled as well as the bubbling: inside a `<summary>` a click would open the row.
 */
export function ScriptActions({ file }: { file: string | null }) {
  if (file === null) return null;
  const shown = fileName(file) || file;
  return (
    <span className="ins-script-actions">
      <button
        type="button"
        className="link"
        title="Open in editor"
        aria-label={`Open ${shown} in editor`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          report(ipc.openScript(file, false));
        }}
      >
        ↗
      </button>
      <button
        type="button"
        className="link"
        title="Show in Explorer"
        aria-label={`Show ${shown} in Explorer`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          report(ipc.openScript(file, true));
        }}
      >
        ▤
      </button>
    </span>
  );
}
