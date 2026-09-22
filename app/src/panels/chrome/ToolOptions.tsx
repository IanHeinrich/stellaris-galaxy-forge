import { useState, type ReactNode } from "react";
import { betaOfSlider, sliderOfBeta } from "../../lib/geometry/mesh";
import { useMapChromeStore } from "../../store/mapChromeStore";
import {
  SIZE_RANGE,
  SPACING_RANGE,
  useToolStore,
  type EraseTarget,
  type LaneMode,
  type Tool,
} from "../../store/toolStore";
import "./chrome.css";

/** The brush diameter as a slider and a number; the number applies on Enter or when it loses focus. */
function SizeOption() {
  const size = useToolStore((s) => s.size);
  const setSize = useToolStore((s) => s.setSize);
  const [draft, setDraft] = useState<string | null>(null);
  const apply = () => {
    if (draft !== null && Number.isFinite(Number(draft)) && draft.trim() !== "") {
      setSize(Number(draft));
    }
    setDraft(null);
  };
  return (
    <label className="tool-option">
      Size
      <input
        type="range"
        min={SIZE_RANGE.min}
        max={SIZE_RANGE.max}
        value={size}
        onChange={(e) => setSize(Number(e.target.value))}
        aria-label="Brush size"
      />
      <input
        type="number"
        min={SIZE_RANGE.min}
        max={SIZE_RANGE.max}
        value={draft ?? size}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
        aria-label="Brush size in world units"
      />
    </label>
  );
}

function PaintOptions() {
  const spacing = useToolStore((s) => s.spacing);
  const setSpacing = useToolStore((s) => s.setSpacing);
  const laneMode = useToolStore((s) => s.laneMode);
  const setLaneMode = useToolStore((s) => s.setLaneMode);
  const meshBeta = useMapChromeStore((s) => s.meshBeta);
  const setMeshBeta = useMapChromeStore((s) => s.setMeshBeta);
  // Dense means close together, so the slider runs against the spacing.
  const flip = (v: number) => SPACING_RANGE.min + SPACING_RANGE.max - v;
  return (
    <>
      <SizeOption />
      <label className="tool-option">
        Density
        <span className="muted">sparse</span>
        <input
          type="range"
          min={SPACING_RANGE.min}
          max={SPACING_RANGE.max}
          value={flip(spacing)}
          onChange={(e) => setSpacing(flip(Number(e.target.value)))}
          aria-label="Density"
        />
        <span className="muted">dense</span>
      </label>
      <label className="tool-option">
        Lanes
        <select value={laneMode} onChange={(e) => setLaneMode(e.target.value as LaneMode)}>
          <option value="off">Off</option>
          <option value="new">Among new</option>
          <option value="nearby">New and nearby</option>
        </select>
      </label>
      <label className="tool-option">
        Lane density
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sliderOfBeta(meshBeta)}
          disabled={laneMode === "off"}
          onChange={(e) => setMeshBeta(betaOfSlider(Number(e.target.value)))}
          aria-label="Lane density"
        />
      </label>
    </>
  );
}

function EraseOptions() {
  const eraseTarget = useToolStore((s) => s.eraseTarget);
  const setEraseTarget = useToolStore((s) => s.setEraseTarget);
  const eraseSpecials = useToolStore((s) => s.eraseSpecials);
  const setEraseSpecials = useToolStore((s) => s.setEraseSpecials);
  return (
    <>
      <SizeOption />
      <label className="tool-option">
        Target
        <select value={eraseTarget} onChange={(e) => setEraseTarget(e.target.value as EraseTarget)}>
          <option value="systems">Systems</option>
          <option value="lanes">Lanes only</option>
        </select>
      </label>
      <label className="tool-option">
        <input
          type="checkbox"
          checked={eraseSpecials}
          disabled={eraseTarget === "lanes"}
          onChange={(e) => setEraseSpecials(e.target.checked)}
        />
        Also erase special systems
      </label>
    </>
  );
}

/** The controls a tool shows while it is active; null for a tool with none. */
function optionsFor(tool: Tool): ReactNode {
  switch (tool) {
    case "paint":
      return <PaintOptions />;
    case "erase":
      return <EraseOptions />;
    case "select":
    case "connect":
    case "cut":
      return null;
  }
}

/** The active brush's options, floating over the map's top-left corner beside the tool rail. */
export function ToolOptions() {
  const tool = useToolStore((s) => s.tool);
  const options = optionsFor(tool);
  if (options === null) return null;
  return (
    <div className="tool-options" role="toolbar" aria-label="Brush options">
      {options}
    </div>
  );
}
