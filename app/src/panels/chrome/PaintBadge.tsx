import { scenarioHeaderName } from "../../lib/paint";
import { PAINT_MOD_STATUS, PAINT_PROFILE_TITLE, paintModStatusCopy } from "../../lib/paintCopy";
import { usePaintLayer } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { usePaintModStore } from "../../store/paintModStore";
import "./chrome.css";
import { openPaintWorkshop } from "./paintMod";

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
  const status = known ? paintModStatusCopy(paintMod) : PAINT_MOD_STATUS.enabled;
  const title = withListedAs(status.warn ? status.headline : PAINT_PROFILE_TITLE, name);
  if (status.action === "subscribe") {
    return (
      <button
        type="button"
        className="badge warn paint-badge"
        title={title}
        onClick={openPaintWorkshop}
      >
        {status.badge}
      </button>
    );
  }
  if (status.warn) {
    return (
      <span className="badge warn paint-badge" title={title}>
        {status.badge}
      </span>
    );
  }
  return (
    <span className="badge paint-badge" title={title}>
      {status.badge}
    </span>
  );
}
