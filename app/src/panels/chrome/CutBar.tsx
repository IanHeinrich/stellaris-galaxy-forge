import { shortcutLabel } from "../../lib/keys";
import { copiedLabel, movingLabel } from "../../lib/planetMove";
import { useClipboard } from "../useCut";
import "./chrome.css";

/**
 * What waits for a paste, at the top centre of the map in either view until it is pasted or
 * cancelled; on a narrow map it drops below the crumb. A copy stays after a paste.
 */
export function CutBar() {
  const clipboard = useClipboard();
  if (clipboard === null) return null;
  const copy = clipboard.kind === "copy";
  return (
    <div className="cut-bar-lane">
      <div className="cut-bar" role="status">
        <b>
          {copy ? copiedLabel(clipboard.planets) : movingLabel(clipboard.planets, clipboard.from)}
        </b>{" "}
        · right-click a system to paste · <kbd>{shortcutLabel("clearSelection")}</kbd>{" "}
        {copy ? "clears" : "cancels"}
      </div>
    </div>
  );
}
