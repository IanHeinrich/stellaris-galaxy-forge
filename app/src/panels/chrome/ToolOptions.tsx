import type { ComponentType, CSSProperties } from "react";
import {
  HEIGHT_MODES,
  RIPPLE_PRESETS,
  rippleAt,
  rippleEnvelope,
  type RippleShape,
} from "../../lib/brush/heightBrush";
import { heightTint } from "../../lib/height";
import { TOOL_ENTRY, type Tool } from "../../lib/tools";
import {
  densityLimit,
  ERASE_TARGET_CHOICES,
  HEIGHT_MODE_ROWS,
  RIPPLE_PRESET_ROWS,
  SPREAD_HINT,
  TOOL_OPTIONS,
} from "../../lib/toolCopy";
import { toCss } from "../../lib/visual/color";
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
  SPREAD_RANGE,
  sliderOfSpacing,
  spacingOfSlider,
  useToolStore,
} from "../../store/toolStore";
import { HelpLink } from "../HelpLink";
import { Select } from "../Select";
import { ShapeOptions } from "./ShapeOptions";
import {
  CheckOption,
  DraftNumber,
  LaneDensityOption,
  LaneIslandsOption,
  LaneModeOption,
  SliderOption,
} from "./toolFields";
import "./chrome.css";
import "../panels.css";

/** The brush diameter as a slider and a number. */
function SizeOption() {
  const size = useToolStore((s) => s.size);
  const setSize = useToolStore((s) => s.setSize);
  const { label, hint } = TOOL_OPTIONS.size;
  return (
    <label className="tool-option" title={hint}>
      {label}
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
        aria-label="Brush size in game units"
      />
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
  const why = densityLimit(MAX_SYSTEMS_PER_BRUSH, least);
  const setSpacing = useToolStore((s) => s.setSpacing);
  const laneMode = useToolStore((s) => s.laneMode);
  const { label, hint } = TOOL_OPTIONS.density;
  return (
    <>
      <SizeOption />
      <label className="tool-option" title={hint}>
        {label}
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
          aria-label="Spacing between painted systems in game units"
          title="Distance between painted systems, in game units"
        />
        {limited && (
          <span className="density-limit" title={why}>
            limited by brush size
          </span>
        )}
      </label>
      <LaneModeOption />
      <LaneDensityOption disabled={laneMode === "off"} />
      {laneMode !== "off" && <LaneIslandsOption />}
    </>
  );
}

function EraseOptions() {
  const eraseTarget = useToolStore((s) => s.eraseTarget);
  const setEraseTarget = useToolStore((s) => s.setEraseTarget);
  const eraseSpecials = useToolStore((s) => s.eraseSpecials);
  const setEraseSpecials = useToolStore((s) => s.setEraseSpecials);
  const target = TOOL_OPTIONS.eraseTarget;
  return (
    <>
      <SizeOption />
      <label className="tool-option" title={target.hint}>
        {target.label}
        <Select value={eraseTarget} choices={ERASE_TARGET_CHOICES} onChange={setEraseTarget} />
      </label>
      <CheckOption
        copy={TOOL_OPTIONS.eraseSpecials}
        checked={eraseSpecials}
        disabled={eraseTarget === "lanes"}
        onChange={setEraseSpecials}
      />
    </>
  );
}

function ConnectOptions() {
  return (
    <>
      <SizeOption />
      <LaneDensityOption />
      <LaneIslandsOption />
    </>
  );
}

function HeightModeOption() {
  const mode = useToolStore((s) => s.heightMode);
  const setMode = useToolStore((s) => s.setHeightMode);
  return (
    <div className="segmented" role="radiogroup" aria-label="Height brush mode">
      {HEIGHT_MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          title={HEIGHT_MODE_ROWS[m].title}
          onClick={() => setMode(m)}
        >
          {HEIGHT_MODE_ROWS[m].label}
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
      <div className="segmented" role="group" aria-label="Ripple presets">
        {RIPPLE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={preset === p}
            title={RIPPLE_PRESET_ROWS[p].title}
            onClick={() => pick(p)}
          >
            {RIPPLE_PRESET_ROWS[p].label}
          </button>
        ))}
      </div>
      <RippleProfile shape={shape} r={size / 2} />
      <SliderOption
        {...TOOL_OPTIONS.rippleHeight}
        range={RIPPLE_RANGES.height}
        value={shape.height}
        onChange={(height) => setRipple({ height })}
      />
      <SliderOption
        {...TOOL_OPTIONS.waveSpacing}
        range={RIPPLE_RANGES.spacing}
        value={shape.spacing}
        onChange={(spacing) => setRipple({ spacing })}
      />
      <SliderOption
        {...TOOL_OPTIONS.fade}
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
          {...TOOL_OPTIONS.height}
          range={HEIGHT_SET_RANGE}
          step={HEIGHT_SET_RANGE.step}
          value={value}
          onChange={setValue}
          field="Height to set, 0 on the game's default plane"
        />
      )}
      {mode === "raise" && (
        <SliderOption
          {...TOOL_OPTIONS.raise}
          range={RAISE_RANGE}
          value={raise}
          onChange={setRaise}
        />
      )}
      {mode === "ripple" && <RippleOptions />}
      {mode === "smooth" && (
        <SliderOption
          {...TOOL_OPTIONS.smooth}
          range={SMOOTH_RANGE}
          value={smooth}
          onChange={setSmooth}
          unit="%"
        />
      )}
      <span className="tool-hint muted">{HEIGHT_MODE_ROWS[mode].hint}</span>
    </>
  );
}

/** The spread brush: its size, how far each pass moves a system, and whether special and home systems move. */
function SpreadOptions() {
  const strength = useToolStore((s) => s.spreadStrength);
  const setStrength = useToolStore((s) => s.setSpreadStrength);
  const specials = useToolStore((s) => s.spreadSpecials);
  const setSpecials = useToolStore((s) => s.setSpreadSpecials);
  return (
    <>
      <SizeOption />
      <SliderOption
        {...TOOL_OPTIONS.spread}
        range={SPREAD_RANGE}
        value={strength}
        onChange={setStrength}
        unit="%"
      />
      <CheckOption copy={TOOL_OPTIONS.spreadSpecials} checked={specials} onChange={setSpecials} />
      <span className="tool-hint muted">{SPREAD_HINT}</span>
    </>
  );
}

/** The controls a tool shows while active; null for none. */
const OPTIONS: Record<Tool, ComponentType | null> = {
  select: null,
  paint: PaintOptions,
  erase: EraseOptions,
  shape: ShapeOptions,
  connect: ConnectOptions,
  cut: SizeOption,
  height: HeightOptions,
  spread: SpreadOptions,
};

/** The active brush's options, floating over the map's top-left corner beside the tool rail. */
export function ToolOptions() {
  const tool = useToolStore((s) => s.tool);
  const Options = OPTIONS[tool];
  const { help, label } = TOOL_ENTRY[tool];
  if (Options === null) return null;
  return (
    <div className="tool-options pop-surface" role="toolbar" aria-label="Brush options">
      <Options />
      {help !== null && !help.onHeading && <HelpLink place={help.place} topic={label} />}
    </div>
  );
}
