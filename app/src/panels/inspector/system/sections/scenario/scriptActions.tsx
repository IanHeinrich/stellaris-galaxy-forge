import type { MouseEvent } from "react";
import type { ScriptRef } from "../../../../../generated/ScriptRef";
import { fileName } from "../../../../../lib/paths";
import { useFileSessionStore } from "../../../../../store/fileSessionStore";
import { OpenButton } from "../../../../OpenButton";
import { showInFolder } from "../../../../openGameFile";

/** Inside a `<summary>` a click would open the row, so a click on the buttons goes no further. */
function keepRowShut(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

/**
 * The ways out to the line a script is written on: the Open button, and Show in Explorer for a
 * game-data file. A line of the scenario itself opens in the open document.
 */
export function ScriptActions({ location }: { location: ScriptRef }) {
  const document = useFileSessionStore((s) => s.path);
  const file = location.file ?? document;
  if (file === null) return null;
  const own = location.file;
  return (
    <span className="ins-script-actions" onClick={keepRowShut}>
      <OpenButton className="ins-script-open" target={{ file, line: location.line }} />
      {own !== null && (
        <button
          type="button"
          className="link"
          title="Show in Explorer"
          aria-label={`Show ${fileName(own) || own} in Explorer`}
          onClick={() => showInFolder(own)}
        >
          ▤
        </button>
      )}
    </span>
  );
}
