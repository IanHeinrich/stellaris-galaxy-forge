import { useState } from "react";
import type { SystemNode } from "../../../generated/SystemNode";
import { heightStrength, heightTint, isFlat, relativeHeight } from "../../../lib/height";
import { toCss } from "../../../lib/visual/ownerColors";
import { useEditorStore } from "../../../store/editorStore";
import { useCanEdit } from "../../../store/fileSessionStore";
import { EditNote, EditRow, TextField } from "../../EditField";

/** How far the slider reaches either side of the plane; the field takes any height. */
const SLIDER_REACH = 200;

export const HEIGHT_HINT = "0 is flat. Above 0 rises above the galaxy plane, below 0 sinks.";

/** Where the icon's plane sits, and how far its star may stand off it. */
const PLANE_Y = 12;
const MAX_LIFT = 9;

/** The six corners of a hexagon lying on the plane, seen at an angle. */
function hexagon(cx: number, cy: number, rx: number, ry: number): string {
  return [0, 60, 120, 180, 240, 300]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      return `${(cx + rx * Math.cos(a)).toFixed(2)},${(cy + ry * Math.sin(a)).toFixed(2)}`;
    })
    .join(" ");
}

/** The game's height marker: the star on a drop line over its hexagon on the plane. */
function HeightIcon({ relative }: { relative: number }) {
  const color = toCss(heightTint(relative));
  const lift = isFlat(relative)
    ? 0
    : Math.sign(relative) * (3 + (MAX_LIFT - 3) * heightStrength(relative));
  const star = PLANE_Y - lift;
  return (
    <svg className="height-icon" viewBox="0 0 16 24" width={12} height={18} aria-hidden="true">
      <polygon points={hexagon(8, PLANE_Y, 5, 2.2)} fill="none" stroke={color} strokeWidth={1} />
      {lift !== 0 && <line x1={8} y1={PLANE_Y} x2={8} y2={star} stroke={color} strokeWidth={1} />}
      <circle cx={8} cy={star} r={2.2} fill={color} />
    </svg>
  );
}

function sliderValue(relative: number): number {
  return Math.max(-SLIDER_REACH, Math.min(SLIDER_REACH, Math.round(relative)));
}

/**
 * A save system's height under its position: a slider that sends one edit when it is let go, a
 * field and a Flat button. Hidden where the document has no heights.
 */
export function HeightRow({ system }: { system: SystemNode }) {
  const editable = useCanEdit("system_heights");
  const setSystemHeight = useEditorStore((s) => s.setSystemHeight);
  const [drag, setDrag] = useState<number | null>(null);
  if (!editable) return null;
  const relative = relativeHeight(system.height);
  const shown = drag ?? relative;
  const commit = (value: number) => void setSystemHeight(system.id, value);
  const release = () => {
    if (drag === null) return;
    const value = drag;
    if (value === sliderValue(relative)) {
      setDrag(null);
      return;
    }
    void setSystemHeight(system.id, value).finally(() => setDrag((d) => (d === value ? null : d)));
  };
  return (
    <>
      <EditRow label="Height">
        <span className="ins-height">
          <HeightIcon relative={shown} />
          <input
            type="range"
            min={-SLIDER_REACH}
            max={SLIDER_REACH}
            step={1}
            aria-label="Height slider"
            value={sliderValue(shown)}
            onChange={(e) => setDrag(Number(e.target.value))}
            onPointerUp={release}
            onKeyUp={release}
          />
          <TextField
            kind="number"
            className="coord"
            label="Height"
            value={relative}
            decimals={2}
            onCommit={commit}
          />
          <button
            type="button"
            disabled={isFlat(relative)}
            title="Back to the game's default height"
            onClick={() => commit(0)}
          >
            Flat
          </button>
        </span>
      </EditRow>
      <EditNote>{HEIGHT_HINT}</EditNote>
    </>
  );
}
