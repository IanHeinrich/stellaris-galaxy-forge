import { fileName } from "../../../../../lib/paths";
import { openGameFile } from "../../../../openGameFile";

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
          openGameFile(file, false);
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
          openGameFile(file, true);
        }}
      >
        ▤
      </button>
    </span>
  );
}
