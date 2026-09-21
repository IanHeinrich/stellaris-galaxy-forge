import { scenarioHeaderName } from "../../lib/paint";
import { usePaintLayer } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { usePaintModStore } from "../../store/paintModStore";
import "./chrome.css";
import { openPaintWorkshop, paintModStatusTitle } from "./paintMod";

const PROFILE_TITLE = "This scenario is set up for the Paint a Galaxy mod";

/** `title`, with the size the header names it under appended as a second line; unchanged without one. */
function withListedAs(title: string, name: string | null): string {
  return name === null ? title : `${title}\nListed in-game as ${name}`;
}

/**
 * That the open document is written for the Paint a Galaxy mod, and a warning when the launcher
 * lacks it. Not yet asked means unknown, not missing.
 */
export function PaintBadge() {
  const paint = usePaintLayer();
  const known = usePaintModStore((s) => s.known);
  const paintMod = usePaintModStore((s) => s.paintMod);
  const name = scenarioHeaderName(useGalaxyStore((s) => s.header));
  if (!paint) return null;
  if (known && paintMod === null) {
    return (
      <button
        type="button"
        className="badge warn paint-badge"
        title={withListedAs(paintModStatusTitle(paintMod), name)}
        onClick={openPaintWorkshop}
      >
        ⚠ Paint a Galaxy mod not installed
      </button>
    );
  }
  if (known && paintMod !== null && !paintMod.enabled) {
    return (
      <span
        className="badge warn paint-badge"
        title={withListedAs(paintModStatusTitle(paintMod), name)}
      >
        ⚠ Paint a Galaxy mod not enabled
      </span>
    );
  }
  return (
    <span className="badge paint-badge" title={withListedAs(PROFILE_TITLE, name)}>
      Paint a Galaxy
    </span>
  );
}
