import { useState, type ComponentType, type CSSProperties, type InputHTMLAttributes } from "react";
import type { EraseTarget } from "../../lib/brush/brushTools";
import type { LaneMode } from "../../lib/brush/lanes";
import { typedNumber } from "../../lib/text";
import type { Tool } from "../../lib/tools";
import {
  effectiveSpacing,
  MAX_SYSTEMS_PER_BRUSH,
  minSpacingFor,
  SIZE_RANGE,
  SPACING_RANGE,
  SPACING_SLIDER_MAX,
  sliderOfSpacing,
  spacingOfSlider,
  useToolStore,
} from "../../store/toolStore";
import { ENTER } from "../keys";
import { LaneDensitySlider } from "../LaneDensitySlider";
import "./chrome.css";

/** A number field that applies on Enter or when it loses focus; text that is no number is dropped. */
function DraftNumber({
  value,
  onApply,
  ...input
}: { value: number; onApply(value: number): void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "onBlur" | "onKeyDown"
>) {
  const [draft, setDraft] = useState<string | null>(null);
  const apply = () => {
    const n = draft === null ? null : typedNumber(draft);
    if (n !== null) onApply(n);
    setDraft(null);
  };
  return (
    <input
      type="number"
      {...input}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === ENTER) apply();
      }}
    />
  );
}

/** The brush diameter as a slider and a number. */
function SizeOption() {
  const size = useToolStore((s) => s.size);
  const setSize = useToolStore((s) => s.setSize);
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
      <DraftNumber
        min={SIZE_RANGE.min}
        max={SIZE_RANGE.max}
        value={size}
        onApply={setSize}
        aria-label="Brush size in world units"
      />
    </label>
  );
}

/** The β of the lanes a brush adds, shared with the selection's mesh. */
function LaneDensityOption({ disabled = false }: { disabled?: boolean }) {
  return (
    <label className="tool-option">
      Lane density
      <LaneDensitySlider label="Lane density" disabled={disabled} />
    </label>
  );
}

function PaintOptions() {
  const size = useToolStore((s) => s.size);
  const chosen = useToolStore((s) => s.spacing);
  const spacing = effectiveSpacing(size, chosen);
  const limited = spacing > chosen;
  const least = minSpacingFor(size);
  const reach = sliderOfSpacing(least) / SPACING_SLIDER_MAX;
  const why = `A brush this size paints at most ${MAX_SYSTEMS_PER_BRUSH} systems per circle, so the spacing is at least ${least}. Make the brush smaller to paint denser.`;
  const setSpacing = useToolStore((s) => s.setSpacing);
  const laneMode = useToolStore((s) => s.laneMode);
  const setLaneMode = useToolStore((s) => s.setLaneMode);
  return (
    <>
      <SizeOption />
      <label className="tool-option">
        Density
        <span className="muted">sparse</span>
        <span className="density-track" style={{ "--reach": `${reach * 100}%` } as CSSProperties}>
          <input
            type="range"
            min={0}
            max={SPACING_SLIDER_MAX}
            value={sliderOfSpacing(spacing)}
            onChange={(e) => setSpacing(spacingOfSlider(Number(e.target.value)))}
            aria-label="Density"
          />
          {reach < 1 && <span className="density-blocked" title={why} aria-hidden="true" />}
        </span>
        <span className="muted">dense</span>
        <DraftNumber
          min={SPACING_RANGE.min}
          max={SPACING_RANGE.max}
          step={0.1}
          value={spacing}
          onApply={setSpacing}
          aria-label="Spacing between painted systems in world units"
          title="Distance between painted systems, in world units"
        />
        {limited && (
          <span className="density-limit" title={why}>
            limited by brush size
          </span>
        )}
      </label>
      <label className="tool-option">
        Lanes
        <select value={laneMode} onChange={(e) => setLaneMode(e.target.value as LaneMode)}>
          <option value="off">Off</option>
          <option value="new">Among new</option>
          <option value="nearby">New and nearby</option>
        </select>
      </label>
      <LaneDensityOption disabled={laneMode === "off"} />
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

function ConnectOptions() {
  return (
    <>
      <SizeOption />
      <LaneDensityOption />
    </>
  );
}

/** The controls a tool shows while it is active; null for a tool with none. */
const OPTIONS: Record<Tool, ComponentType | null> = {
  select: null,
  paint: PaintOptions,
  erase: EraseOptions,
  connect: ConnectOptions,
  cut: SizeOption,
};

/** The active brush's options, floating over the map's top-left corner beside the tool rail. */
export function ToolOptions() {
  const Options = OPTIONS[useToolStore((s) => s.tool)];
  if (Options === null) return null;
  return (
    <div className="tool-options" role="toolbar" aria-label="Brush options">
      <Options />
    </div>
  );
}
