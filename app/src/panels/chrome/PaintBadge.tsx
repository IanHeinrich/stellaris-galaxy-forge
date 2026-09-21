import { usePaintLayer } from "../../store/fileSessionStore";
import { usePaintModStore } from "../../store/paintModStore";
import "./chrome.css";
import { openPaintWorkshop, paintModStatusTitle } from "./paintMod";

const PROFILE_TITLE = "Spawn points are written for the Paint a Galaxy mod";

/**
 * That the open document is written for the Paint a Galaxy mod, and a warning when the launcher
 * lacks it. Not yet asked means unknown, not missing.
 */
export function PaintBadge() {
  const paint = usePaintLayer();
  const known = usePaintModStore((s) => s.known);
  const paintMod = usePaintModStore((s) => s.paintMod);
  if (!paint) return null;
  if (known && paintMod === null) {
    return (
      <button
        type="button"
        className="badge warn paint-badge"
        title={paintModStatusTitle(paintMod)}
        onClick={openPaintWorkshop}
      >
        ⚠ Paint a Galaxy mod not installed
      </button>
    );
  }
  if (known && paintMod !== null && !paintMod.enabled) {
    return (
      <span className="badge warn paint-badge" title={paintModStatusTitle(paintMod)}>
        ⚠ Paint a Galaxy mod not enabled
      </span>
    );
  }
  return (
    <span className="badge paint-badge" title={PROFILE_TITLE}>
      Paint a Galaxy
    </span>
  );
}
