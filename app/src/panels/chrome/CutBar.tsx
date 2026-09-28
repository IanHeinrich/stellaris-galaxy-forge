import { shortcutLabel } from "../../lib/keys";
import { movingLabel } from "../../lib/planetMove";
import { useCut } from "../usePlanetMove";
import "./chrome.css";

/**
 * What waits for a paste, at the top centre of the map in either view until it is pasted or
 * cancelled; on a narrow map it drops below the crumb.
 */
export function CutBar() {
  const cut = useCut();
  if (cut === null) return null;
  return (
    <div className="cut-bar-lane">
      <div className="cut-bar" role="status">
        <b>{movingLabel(cut.planets, cut.from)}</b> · right-click a system to paste ·{" "}
        <kbd>{shortcutLabel("clearSelection")}</kbd> cancels
      </div>
    </div>
  );
}
