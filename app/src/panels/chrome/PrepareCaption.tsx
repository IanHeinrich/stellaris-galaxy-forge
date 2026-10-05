import { cutOffRingedLine, PREPARE_COPY, ringedLine } from "../../lib/prepareCopy";
import { usePaintLayer } from "../../store/fileSessionStore";
import { ringedSystems, rowSystems, usePrepareStore } from "../../store/prepareStore";
import "./chrome.css";

/**
 * What the map rings while a Prepare row is hovered, at the map's bottom left: how many systems
 * and which row, the systems taking wormhole pairs out cuts off, and what leaving a kept row out
 * would do. It goes with the rings.
 */
export function PrepareCaption() {
  const row = usePrepareStore((s) => s.hovered);
  const ringed = usePrepareStore((s) => ringedSystems(s).length);
  const inRow = usePrepareStore((s) =>
    s.hovered === null ? 0 : rowSystems(s.preview, s.hovered).length,
  );
  const kept = usePrepareStore((s) => s.hovered !== null && s.choices[s.hovered] === "keep");
  const profile = usePrepareStore((s) => s.preview?.profile ?? null);
  const paint = usePaintLayer();
  if (row === null || ringed === 0) return null;
  const copy = PREPARE_COPY[profile ?? (paint ? "paint_a_galaxy" : "plain")][row];
  return (
    <div className="prepare-caption" role="status">
      <div>{ringedLine(copy, inRow)}</div>
      {ringed > inRow && <div className="muted">{cutOffRingedLine(ringed - inRow)}</div>}
      {kept && <div className="muted">{copy.ifLeftOut}</div>}
    </div>
  );
}
