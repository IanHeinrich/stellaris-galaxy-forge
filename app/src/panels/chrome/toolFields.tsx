import { useRef, type CSSProperties, type InputHTMLAttributes } from "react";
import type { LaneMode } from "../../lib/placement/lanes";
import { typedNumber } from "../../lib/text";
import { LANE_MODE_CHOICES, TOOL_OPTIONS, type OptionCopy } from "../../lib/toolCopy";
import { useToolStore } from "../../store/toolStore";
import { ENTER } from "../keys";
import { LaneDensitySlider, LaneIslandsCheckbox } from "../LaneDensitySlider";
import { Select } from "../Select";
import { useDraft } from "../useDraft";

/** The decimals a field shows for `step`: one, or two where the step is finer. */
function decimalsFor(step: number): number {
  const finer = String(step).split(".")[1]?.length ?? 0;
  return Math.min(2, Math.max(1, finer));
}

/** `value` as a field shows it, to `decimals` places with trailing zeros dropped: 101.3, 0, -1234.5. */
function shownNumber(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

/** How many characters the widest value between `min` and `max` takes; an open end leaves room for -1234. */
function widestChars(min: number | undefined, max: number | undefined, decimals: number): number {
  const digits = (v: number | undefined) =>
    v === undefined ? 4 : String(Math.trunc(Math.abs(v))).length;
  const sign = min === undefined || min < 0 ? 1 : 0;
  return sign + Math.max(digits(min), digits(max)) + 1 + decimals;
}

function numberOr(v: number | string | undefined): number | undefined {
  return v === undefined ? undefined : Number(v);
}

/**
 * A number field that applies on Enter or when it loses focus, and drops what Escape abandons.
 * It shows its value to a decimal place, two for a finer `step`, and is wide enough for any
 * value between `min` and `max`; what is typed applies as typed, on Enter even when it reads
 * as the value shown.
 */
export function DraftNumber({
  value,
  onApply,
  ...input
}: { value: number; onApply(value: number): void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "onBlur" | "onKeyDown"
>) {
  const decimals = decimalsFor(numberOr(input.step) ?? 1);
  const shown = shownNumber(value, decimals);
  const typed = useRef(false);
  const apply = (text: string) => {
    const n = typedNumber(text);
    if (n !== null) onApply(n);
  };
  const { draft, inputProps } = useDraft({ shown, onCommit: apply });
  const chars = widestChars(numberOr(input.min), numberOr(input.max), decimals);
  return (
    <input
      type="number"
      {...input}
      style={{ "--chars": chars } as CSSProperties}
      value={draft ?? shown}
      {...inputProps}
      onChange={(e) => {
        typed.current = true;
        inputProps.onChange(e);
      }}
      onBlur={() => {
        typed.current = false;
        inputProps.onBlur();
      }}
      onKeyDown={(e) => {
        // The draft only commits when it differs from the shown text, which is rounded: 0 typed over 0.04 must still apply.
        if (e.key === ENTER && typed.current && e.currentTarget.value === shown) {
          apply(e.currentTarget.value);
        }
        inputProps.onKeyDown(e);
      }}
    />
  );
}

/** A labelled slider over `range` and its value, typed into a field when `field` names one; `hint` is its tooltip. */
export function SliderOption({
  label,
  hint,
  range,
  value,
  onChange,
  step = 1,
  field,
  unit = "",
}: {
  label: string;
  hint: string;
  range: { min: number; max: number };
  value: number;
  onChange(value: number): void;
  step?: number;
  field?: string;
  unit?: string;
}) {
  return (
    <label className="tool-option" title={hint}>
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
  const { label, hint } = TOOL_OPTIONS.lanes;
  return (
    <label className="tool-option" title={hint}>
      {label}
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
  const { label, hint } = TOOL_OPTIONS.laneDensity;
  return (
    <label className="tool-option" title={hint}>
      {label}
      <LaneDensitySlider label={label} disabled={disabled} />
    </label>
  );
}

/** Whether the lanes a brush adds are grouped into islands as the game does, shared with the selection's mesh. */
export function LaneIslandsOption() {
  return <LaneIslandsCheckbox className="tool-option" />;
}

/** A tool's checkbox with its label and tooltip. */
export function CheckOption({
  copy: { label, hint },
  checked,
  onChange,
  disabled = false,
}: {
  copy: OptionCopy;
  checked: boolean;
  onChange(on: boolean): void;
  disabled?: boolean;
}) {
  return (
    <label className="tool-option" title={hint}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
