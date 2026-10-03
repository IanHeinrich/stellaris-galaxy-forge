import { useState, type ComponentType, type CSSProperties, type InputHTMLAttributes } from "react";
import type { EraseTarget } from "../../lib/brush/brushTools";
import {
  HEIGHT_MODES,
  RIPPLE_PRESETS,
  rippleAt,
  rippleEnvelope,
  type HeightMode,
  type RipplePreset,
  type RippleShape,
} from "../../lib/brush/heightBrush";
import type { LaneMode } from "../../lib/brush/lanes";
import { heightTint } from "../../lib/height";
import { typedNumber } from "../../lib/text";
import type { Tool } from "../../lib/tools";
import { toCss } from "../../lib/visual/ownerColors";
import {
  effectiveSpacing,
  HEIGHT_SET_RANGE,
  MAX_SYSTEMS_PER_BRUSH,
  minSpacingFor,
  RAISE_RANGE,
  RIPPLE_RANGES,
  SIZE_RANGE,
  SMOOTH_RANGE,
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

const MODE_LABELS: Record<HeightMode, string> = {
  set: "Set",
  raise: "Raise",
  ripple: "Ripple",
  smooth: "Smooth",
};

const MODE_HINTS: Record<HeightMode, string> = {
  set: "Click or drag to set every star under the brush to this height.",
  raise: "Click or drag to lift stars, most at the centre. Alt lowers.",
  ripple:
    "Click to drop a ripple. Rings preview on the map before you click. Alt flips crests and troughs.",
  smooth: "Drag to even out bumps between neighbours.",
};

const PRESET_LABELS: Record<RipplePreset, string> = {
  ripples: "Ripples",
  waves: "Waves",
  dome: "Dome",
  crater: "Crater",
};

/** A labelled slider over `range` and its value, typed into a field when `field` names one. */
function SliderOption({
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

function HeightModeOption() {
  const mode = useToolStore((s) => s.heightMode);
  const setMode = useToolStore((s) => s.setHeightMode);
  return (
    <div className="tool-segmented" role="radiogroup" aria-label="Height brush mode">
      {HEIGHT_MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => setMode(m)}
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

const PROFILE = { width: 160, height: 48, samples: 64, margin: 3 } as const;

/** An SVG path through `ys`, sampled evenly from the centre to the brush edge, `top` at the margin. */
function profilePath(ys: readonly number[], top: number): string {
  const { width, height, samples, margin } = PROFILE;
  const mid = height / 2;
  const scale = (mid - margin) / top;
  return ys
    .map((y, i) => {
      const x = (i / samples) * width;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${(mid - y * scale).toFixed(1)}`;
    })
    .join("");
}

/** The ripple's height from its centre (left) to the brush edge (right), inside its fade. */
function RippleProfile({ shape, r }: { shape: RippleShape; r: number }) {
  const { width, height, samples } = PROFILE;
  const along = Array.from({ length: samples + 1 }, (_, i) => (i / samples) * r);
  const top = Math.max(1, Math.abs(shape.height));
  const fade = along.map((d) => rippleEnvelope(d, r, shape));
  const curve = along.map((d) => rippleAt(d, r, shape));
  return (
    <svg
      className="ripple-profile"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="Ripple height from the centre to the brush edge"
    >
      <path className="ripple-axis" d={`M0 ${height / 2}H${width}`} />
      <path className="ripple-fade" d={profilePath(fade, top)} />
      <path
        className="ripple-fade"
        d={profilePath(
          fade.map((e) => -e),
          top,
        )}
      />
      <path className="ripple-curve" d={profilePath(curve, top)} stroke={toCss(heightTint(-1))} />
    </svg>
  );
}

function RippleOptions() {
  const shape = useToolStore((s) => s.ripple);
  const preset = useToolStore((s) => s.ripplePreset);
  const size = useToolStore((s) => s.size);
  const setRipple = useToolStore((s) => s.setRipple);
  const pick = useToolStore((s) => s.pickRipplePreset);
  return (
    <>
      <div className="tool-chips" role="group" aria-label="Ripple presets">
        {RIPPLE_PRESETS.map((p) => (
          <button key={p} type="button" aria-pressed={preset === p} onClick={() => pick(p)}>
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      <RippleProfile shape={shape} r={size / 2} />
      <SliderOption
        label="Height"
        range={RIPPLE_RANGES.height}
        value={shape.height}
        onChange={(height) => setRipple({ height })}
      />
      <SliderOption
        label="Wave spacing"
        range={RIPPLE_RANGES.spacing}
        value={shape.spacing}
        onChange={(spacing) => setRipple({ spacing })}
      />
      <SliderOption
        label="Fade out"
        range={RIPPLE_RANGES.fade}
        value={shape.fade}
        onChange={(fade) => setRipple({ fade })}
      />
    </>
  );
}

/** The height brush: its mode, its size, the mode's own controls and a line on how to use it. */
function HeightOptions() {
  const mode = useToolStore((s) => s.heightMode);
  const value = useToolStore((s) => s.heightValue);
  const setValue = useToolStore((s) => s.setHeightValue);
  const raise = useToolStore((s) => s.raiseStrength);
  const setRaise = useToolStore((s) => s.setRaiseStrength);
  const smooth = useToolStore((s) => s.smoothStrength);
  const setSmooth = useToolStore((s) => s.setSmoothStrength);
  return (
    <>
      <HeightModeOption />
      <SizeOption />
      {mode === "set" && (
        <SliderOption
          label="Height"
          range={HEIGHT_SET_RANGE}
          step={HEIGHT_SET_RANGE.step}
          value={value}
          onChange={setValue}
          field="Height to set, 0 on the game's default plane"
        />
      )}
      {mode === "raise" && (
        <SliderOption label="Strength" range={RAISE_RANGE} value={raise} onChange={setRaise} />
      )}
      {mode === "ripple" && <RippleOptions />}
      {mode === "smooth" && (
        <SliderOption
          label="Strength"
          range={SMOOTH_RANGE}
          value={smooth}
          onChange={setSmooth}
          unit="%"
        />
      )}
      <span className="tool-hint muted">{MODE_HINTS[mode]}</span>
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
  height: HeightOptions,
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
