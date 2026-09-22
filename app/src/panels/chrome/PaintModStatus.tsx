import { PAINT_MOD_NOT_INSTALLED_LINE, paintModStatusCopy } from "../../lib/paintCopy";
import { usePaintModStore } from "../../store/paintModStore";
import "./chrome.css";
import { openPaintWorkshop } from "./paintMod";

/** The mod on this machine, in one line: what to do next, or that nothing is needed. */
export function PaintModStatus() {
  const known = usePaintModStore((s) => s.known);
  const paintMod = usePaintModStore((s) => s.paintMod);
  if (!known) return null;
  const status = paintModStatusCopy(paintMod);
  const className = status.warn ? "paint-mod-status warn" : "paint-mod-status";
  if (status.action === "subscribe") {
    const { before, link, after } = PAINT_MOD_NOT_INSTALLED_LINE;
    return (
      <span className={className}>
        {before}
        <button type="button" className="link" onClick={openPaintWorkshop}>
          {link}
        </button>
        {after}
      </span>
    );
  }
  return <span className={className}>{status.headline}</span>;
}
