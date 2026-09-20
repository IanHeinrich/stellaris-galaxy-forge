import { useLayoutEffect, useRef, useState } from "react";
import { getTextureUrl } from "../../lib/visual/textures";
import {
  useMapChromeStore,
  type MapTooltipLine,
  type MapTooltipText,
} from "../../store/mapChromeStore";
import "./overlays.css";

const OFFSET_PX = 14;
const EDGE_PX = 8;

function text(value: MapTooltipText) {
  if (typeof value === "string") return value;
  return value.map((piece, i) =>
    typeof piece === "string" ? (
      piece
    ) : (
      <img key={i} className="map-tooltip-icon" src={getTextureUrl(piece.icon)} alt="" />
    ),
  );
}

/** A line's key: what it is called, with its place for the lines that carry no name. */
function lineKey(line: MapTooltipLine, i: number): string {
  if (typeof line === "string") return `${line}-${i}`;
  if ("heading" in line) return `${line.heading}-${i}`;
  return `${typeof line.label === "string" ? line.label : "line"}-${i}`;
}

/** The pointer's tooltip, flipped left or up when it would run past the map area's edge. */
export function MapTooltip() {
  const tip = useMapChromeStore((s) => s.tooltip);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return;
    const area = el.parentElement?.getBoundingClientRect();
    const maxX = (area?.width ?? window.innerWidth) - EDGE_PX;
    const maxY = (area?.height ?? window.innerHeight) - EDGE_PX;
    let left = tip.x + OFFSET_PX;
    let top = tip.y + OFFSET_PX;
    if (left + el.offsetWidth > maxX) left = Math.max(EDGE_PX, tip.x - OFFSET_PX - el.offsetWidth);
    if (top + el.offsetHeight > maxY) top = Math.max(EDGE_PX, tip.y - OFFSET_PX - el.offsetHeight);
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={ref} className="map-tooltip" style={pos}>
      <div className="map-tooltip-title">{tip.title}</div>
      {tip.lines.map((line, i) =>
        typeof line === "string" ? (
          <div key={lineKey(line, i)} className="map-tooltip-line">
            {line}
          </div>
        ) : "heading" in line ? (
          <div key={lineKey(line, i)} className="map-tooltip-row map-tooltip-heading">
            <span className="map-tooltip-label">{line.heading}</span>
            <span className="map-tooltip-value">{line.value ?? ""}</span>
          </div>
        ) : (
          <div
            key={lineKey(line, i)}
            className={`map-tooltip-row${line.indent ? " map-tooltip-indent" : ""}${line.stacked ? " map-tooltip-stacked" : ""}`}
          >
            <span className="map-tooltip-label">{text(line.label)}</span>
            <span className="map-tooltip-value">{text(line.value)}</span>
          </div>
        ),
      )}
    </div>
  );
}
