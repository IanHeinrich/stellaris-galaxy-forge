import { usePaintModStore } from "../../store/paintModStore";
import "./chrome.css";
import { PAINT_MOD_ENABLED, PAINT_MOD_NOT_ENABLED, openPaintWorkshop } from "./paintMod";

/** The mod on this machine, in one line: what to do next, or that nothing is needed. */
export function PaintModStatus() {
  const known = usePaintModStore((s) => s.known);
  const paintMod = usePaintModStore((s) => s.paintMod);
  if (!known) return null;
  if (paintMod === null) {
    return (
      <span className="paint-mod-status warn">
        Subscribe to the{" "}
        <button type="button" className="link" onClick={openPaintWorkshop}>
          Paint a Galaxy mod on the Steam Workshop ↗
        </button>{" "}
        then enable it in your playset.
      </span>
    );
  }
  if (!paintMod.enabled) {
    return <span className="paint-mod-status warn">{PAINT_MOD_NOT_ENABLED}</span>;
  }
  return <span className="paint-mod-status">{PAINT_MOD_ENABLED}</span>;
}
