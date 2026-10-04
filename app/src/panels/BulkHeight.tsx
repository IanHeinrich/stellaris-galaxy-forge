import { useMemo, useState } from "react";
import { useEditorStore, type HeightChange } from "../store/editorStore";
import { heightTint, isFlat, relativeHeight } from "../lib/height";
import { useGalaxyStore } from "../store/galaxyStore";
import { toCss } from "../lib/visual/ownerColors";
import { TextField } from "./EditField";
import "./panels.css";

const HEIGHT_CHANGES: ReadonlyArray<{ change: HeightChange; label: string }> = [
  { change: "set", label: "Set to" },
  { change: "raise", label: "Raise by" },
  { change: "lower", label: "Lower by" },
];

const STRIP_WIDTH = 300;
const STRIP_HEIGHT = 34;
const STRIP_PAD = 8;
const STRIP_AXIS_Y = 13;
/** How close an end's label may come to the 0 label before it is left out. */
const STRIP_LABEL_GAP = 20;

/** Where each shown height sits on a strip from the lowest to the highest, 0 always on it. */
function stripScale(heights: readonly number[]): {
  lo: number;
  hi: number;
  x: (h: number) => number;
} {
  const lo = heights.reduce((m, h) => Math.min(m, h), 0);
  const hi = heights.reduce((m, h) => Math.max(m, h), 0);
  const x = (h: number) =>
    STRIP_PAD + (hi === lo ? 0.5 : (h - lo) / (hi - lo)) * (STRIP_WIDTH - 2 * STRIP_PAD);
  return { lo, hi, x };
}

function heightLabel(h: number): string {
  return String(Math.round(h));
}

/** The selected systems' shown heights as dots on one axis, coloured as the map tints them. */
function HeightStrip({ heights }: { heights: readonly number[] }) {
  const { lo, hi, x } = stripScale(heights);
  const zero = x(0);
  return (
    <svg
      className="height-strip"
      viewBox={`0 0 ${STRIP_WIDTH} ${STRIP_HEIGHT}`}
      role="img"
      aria-label="Heights of the selected systems"
    >
      <line
        className="height-strip-axis"
        x1={STRIP_PAD}
        x2={STRIP_WIDTH - STRIP_PAD}
        y1={STRIP_AXIS_Y}
        y2={STRIP_AXIS_Y}
      />
      <line className="height-strip-zero" x1={zero} x2={zero} y1={4} y2={STRIP_AXIS_Y + 9} />
      {heights.map((h, i) => (
        <circle
          key={i}
          className="height-dot"
          cx={x(h)}
          cy={STRIP_AXIS_Y}
          r={3}
          fill={toCss(heightTint(h))}
        />
      ))}
      {zero - x(lo) > STRIP_LABEL_GAP && (
        <text x={STRIP_PAD} y={STRIP_HEIGHT - 2} textAnchor="start">
          {heightLabel(lo)}
        </text>
      )}
      <text x={zero} y={STRIP_HEIGHT - 2} textAnchor="middle">
        0
      </text>
      {x(hi) - zero > STRIP_LABEL_GAP && (
        <text x={STRIP_WIDTH - STRIP_PAD} y={STRIP_HEIGHT - 2} textAnchor="end">
          {heightLabel(hi)}
        </text>
      )}
    </svg>
  );
}

/**
 * Several save systems selected: where their heights stand, and one edit that sets, raises or
 * lowers them all, or puts them back on the plane.
 */
export function BulkHeight({ ids }: { ids: readonly number[] }) {
  const systems = useGalaxyStore((s) => s.systems);
  const setSelectedHeights = useEditorStore((s) => s.setSelectedHeights);
  const flattenSelected = useEditorStore((s) => s.flattenSelected);
  const [change, setChange] = useState<HeightChange>("set");
  const [value, setValue] = useState(0);
  const heights = useMemo(
    () =>
      ids.flatMap((id) => {
        const system = systems.get(id);
        return system ? [relativeHeight(system.height)] : [];
      }),
    [ids, systems],
  );
  const raised = heights.filter((h) => !isFlat(h)).length;
  return (
    <div className="height-group" role="group" aria-label="Height">
      <div className="edit-block-title">Height</div>
      <HeightStrip heights={heights} />
      <div className="segmented" role="group" aria-label="Height change">
        {HEIGHT_CHANGES.map(({ change: c, label }) => (
          <button key={c} type="button" aria-pressed={change === c} onClick={() => setChange(c)}>
            {label}
          </button>
        ))}
      </div>
      <div className="height-apply">
        <TextField
          kind="number"
          className="coord"
          label="Height value"
          value={value}
          onCommit={setValue}
        />
        <button type="button" onClick={() => void setSelectedHeights(change, value)}>
          Apply
        </button>
      </div>
      <button type="button" disabled={raised === 0} onClick={() => void flattenSelected()}>
        Flatten ({raised})
      </button>
      <div className="muted height-hint">Back to the game&apos;s default height</div>
    </div>
  );
}
