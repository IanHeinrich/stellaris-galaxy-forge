import type { InputHTMLAttributes } from "react";
import type { LaneMode } from "../../lib/placement/lanes";
import { typedNumber } from "../../lib/text";
import { LANE_MODE_CHOICES } from "../../lib/toolCopy";
import { useToolStore } from "../../store/toolStore";
import { LaneDensitySlider } from "../LaneDensitySlider";
import { Select } from "../Select";
import { useDraft } from "../useDraft";

/** A number field that applies on Enter or when it loses focus, and drops what Escape abandons. */
export function DraftNumber({
  value,
  onApply,
  ...input
}: { value: number; onApply(value: number): void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "onBlur" | "onKeyDown"
>) {
  const { draft, inputProps } = useDraft({
    shown: String(value),
    onCommit: (text) => {
      const n = typedNumber(text);
      if (n !== null) onApply(n);
    },
  });
  return <input type="number" {...input} value={draft ?? value} {...inputProps} />;
}

/** A labelled slider over `range` and its value, typed into a field when `field` names one. */
export function SliderOption({
  label,
  range,
  value,
  onChange,
  step = 1,
  field,
  unit = "",
}: {
  label: string;
  range: { min: number; max: number };
  value: number;
  onChange(value: number): void;
  step?: number;
  field?: string;
  unit?: string;
}) {
  return (
    <label className="tool-option">
      {label}
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      {field === undefined ? (
        <span className="tool-value">{`${value}${unit}`}</span>
      ) : (
        <DraftNumber
          min={range.min}
          max={range.max}
          step={step}
          value={value}
          onApply={onChange}
          aria-label={field}
        />
      )}
    </label>
  );
}

/** The Lanes drop-down over `value`, for whichever tool's lane setting it edits. */
export function LaneModeSelect({
  value,
  onChange,
}: {
  value: LaneMode;
  onChange(mode: LaneMode): void;
}) {
  return (
    <label className="tool-option">
      Lanes
      <Select value={value} choices={LANE_MODE_CHOICES} onChange={onChange} />
    </label>
  );
}

/** Which lanes the paint brush's new systems get: none, among themselves, or also to the systems near them. */
export function LaneModeOption() {
  const laneMode = useToolStore((s) => s.laneMode);
  const setLaneMode = useToolStore((s) => s.setLaneMode);
  return <LaneModeSelect value={laneMode} onChange={setLaneMode} />;
}

/** The Lane density of the lanes a brush adds, shared with the selection's mesh. */
export function LaneDensityOption({ disabled = false }: { disabled?: boolean }) {
  return (
    <label className="tool-option">
      Lane density
      <LaneDensitySlider label="Lane density" disabled={disabled} />
    </label>
  );
}
