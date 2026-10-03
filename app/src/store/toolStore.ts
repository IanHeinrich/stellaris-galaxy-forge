import { create } from "zustand";
import type { EraseTarget } from "../lib/brush/brushTools";
import {
  presetShape,
  type HeightBrush,
  type HeightMode,
  type RipplePreset,
  type RippleShape,
} from "../lib/brush/heightBrush";
import type { LaneMode } from "../lib/brush/lanes";
import { isSymmetry, type ActiveSymmetry, type Symmetry } from "../lib/geometry/symmetry";
import { toolRequires, type Tool } from "../lib/tools";
import { barShows, type BarMode } from "../lib/visual/barMode";
import { documentCapabilities } from "../lib/capabilities";
import { clampTilt, shownTilt } from "../lib/visual/tilt";
import { canEdit, useFileSessionStore } from "./fileSessionStore";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, isFiniteNumber, prefField, type PrefField } from "./prefs";

/** What Shift+M turns on before any symmetry has been picked. */
export const DEFAULT_SYMMETRY: ActiveSymmetry = { kind: "rotate", n: 4 };

/** Brush diameter, in world units. */
export const SIZE_RANGE = { min: 5, max: 400, fallback: 40 } as const;
/** Distance between the systems a paint stroke lays down, in world units. */
export const SPACING_RANGE = { min: 5, max: 150, fallback: 25 } as const;
/** What one `[` or `]` multiplies or divides the brush size by. */
const SIZE_STEP = 1.2;

/** The Density slider's integer steps, mapped log-in-spacing so the dense end keeps fine control. */
export const SPACING_SLIDER_MAX = 1000;
const SPACING_LOG_MIN = Math.log(SPACING_RANGE.min);
const SPACING_LOG_MAX = Math.log(SPACING_RANGE.max);
const SPACING_LOG_SPAN = SPACING_LOG_MAX - SPACING_LOG_MIN;

/** Spacing rounded to one decimal place. */
function roundSpacing(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The height brush's controls: Set's height, Raise's and Smooth's strength, and a ripple's shape. */
export const HEIGHT_SET_RANGE = { min: -200, max: 200, step: 0.5 } as const;
export const RAISE_RANGE = { min: 1, max: 50 } as const;
export const SMOOTH_RANGE = { min: 1, max: 100 } as const;
export const RIPPLE_RANGES: Record<keyof RippleShape, { min: number; max: number }> = {
  height: { min: -100, max: 100 },
  spacing: { min: 5, max: 200 },
  fade: { min: 10, max: 400 },
};

/** Whether a preset's shape follows the brush size, so a resize keeps it one hump or bowl. */
function followsSize(preset: RipplePreset | null): boolean {
  return preset === "dome" || preset === "crater";
}

/** The most systems one paint brush circle may hold, so a large brush cannot flood the map. */
export const MAX_SYSTEMS_PER_BRUSH = 60;

/** The share of an area a Poisson-disc sample at spacing `d` fills, as systems per d². */
const PACKING = 0.7;

/** The least spacing a brush of `size` may paint at, so its circle holds at most `MAX_SYSTEMS_PER_BRUSH`. */
export function minSpacingFor(size: number): number {
  const r = size / 2;
  const least = Math.sqrt((PACKING * Math.PI * r * r) / MAX_SYSTEMS_PER_BRUSH);
  return clamp(Math.ceil(least * 10) / 10, SPACING_RANGE);
}

/** The spacing a stroke paints at: the chosen one, widened when the brush is too large for it. */
export function effectiveSpacing(size: number, spacing: number): number {
  return Math.max(spacing, minSpacingFor(size));
}

/** Density slider position (0 sparse .. `SPACING_SLIDER_MAX` dense) for `spacing`, log-in-spacing. */
export function sliderOfSpacing(spacing: number): number {
  const clamped = clamp(spacing, SPACING_RANGE);
  const t = (SPACING_LOG_MAX - Math.log(clamped)) / SPACING_LOG_SPAN;
  return Math.round(clamp(t, { min: 0, max: 1 }) * SPACING_SLIDER_MAX);
}

/** The spacing, in world units, for a Density slider position in `[0, SPACING_SLIDER_MAX]`. */
export function spacingOfSlider(v: number): number {
  const t = clamp(v, { min: 0, max: SPACING_SLIDER_MAX }) / SPACING_SLIDER_MAX;
  const spacing = Math.exp(SPACING_LOG_MAX - t * SPACING_LOG_SPAN);
  return clamp(roundSpacing(spacing), SPACING_RANGE);
}

const LANE_MODES: readonly LaneMode[] = ["off", "new", "nearby"];
const ERASE_TARGETS: readonly EraseTarget[] = ["systems", "lanes"];
export const SYMMETRY_OFF: Symmetry = { kind: "off" };

export interface ToolState {
  tool: Tool;
  size: number;
  spacing: number;
  laneMode: LaneMode;
  eraseTarget: EraseTarget;
  /** Whether the erase brush takes systems that carry an initializer, a spawn or a special. */
  eraseSpecials: boolean;
  /** The global symmetry: each edit and brush stroke repeated about the galaxy's centre. */
  symmetry: Symmetry;
  /** The symmetry Shift+M turns back on: the last one picked. */
  lastSymmetry: ActiveSymmetry;
  /** The tilt view's angle in degrees, 0 for the flat map; a view setting, never saved. */
  tilt: number;
  /** Whether the rail's symmetry flyout is open. */
  symmetryMenu: boolean;
  heightMode: HeightMode;
  /** Set's height, as the editor shows it. */
  heightValue: number;
  raiseStrength: number;
  /** Smooth's strength, in percent. */
  smoothStrength: number;
  ripple: RippleShape;
  /** The preset the ripple is, or null once a slider has moved it off one. */
  ripplePreset: RipplePreset | null;
  /**
   * Switches tool, refusing one the open document cannot take; true when `tool` is now current.
   * Callers check `toolAllowed` first: this does not know which bar is shown.
   */
  setTool(tool: Tool): boolean;
  setSize(size: number): void;
  /** `[` shrinks the brush and `]` grows it, by a constant ratio. */
  stepSize(dir: -1 | 1): void;
  setSpacing(spacing: number): void;
  setLaneMode(mode: LaneMode): void;
  setEraseTarget(target: EraseTarget): void;
  setEraseSpecials(on: boolean): void;
  setSymmetry(symmetry: Symmetry): void;
  /** Shift+M: turns symmetry off, or back on as it last was. */
  toggleSymmetry(): void;
  setSymmetryMenu(open: boolean): void;
  setTilt(degrees: number): void;
  setHeightMode(mode: HeightMode): void;
  setHeightValue(value: number): void;
  setRaiseStrength(strength: number): void;
  setSmoothStrength(strength: number): void;
  /** Moves one or more of the ripple's sliders, which leaves any preset. */
  setRipple(change: Partial<RippleShape>): void;
  pickRipplePreset(preset: RipplePreset): void;
}

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}

function oneOf<T extends string>(values: readonly T[]) {
  return (value: unknown): value is T => typeof value === "string" && values.includes(value as T);
}

function isActiveSymmetry(value: unknown): value is ActiveSymmetry {
  return isSymmetry(value) && value.kind !== "off";
}

const SIZE = prefField(PREF_KEYS.brushSize, SIZE_RANGE.fallback, isFiniteNumber);
const SPACING = prefField(PREF_KEYS.brushSpacing, SPACING_RANGE.fallback, isFiniteNumber);
const LANE_MODE = prefField(PREF_KEYS.brushLaneMode, "nearby", oneOf(LANE_MODES));
const ERASE_TARGET = prefField(PREF_KEYS.eraseTarget, "systems", oneOf(ERASE_TARGETS));
const ERASE_SPECIALS = prefField(PREF_KEYS.eraseSpecials, false, isBoolean);
const SYMMETRY = prefField(PREF_KEYS.symmetry, SYMMETRY_OFF, isSymmetry);
const LAST_SYMMETRY = prefField(PREF_KEYS.symmetryLast, DEFAULT_SYMMETRY, isActiveSymmetry);

function storedLastSymmetry(): ActiveSymmetry {
  const current = SYMMETRY.read();
  return LAST_SYMMETRY.read(current.kind === "off" ? DEFAULT_SYMMETRY : current);
}

function storedNumber(
  field: PrefField<number>,
  range: { min: number; max: number; fallback: number },
): number {
  return clamp(field.read(), range);
}

/** The height brush as the options stand, `flipped` while Alt is held. */
export function heightBrush(flipped: boolean): HeightBrush {
  const t = useToolStore.getState();
  return {
    mode: t.heightMode,
    value: t.heightValue,
    raise: t.raiseStrength,
    smooth: t.smoothStrength / 100,
    ripple: t.ripple,
    flipped,
  };
}

/** Whether `tool` can be picked on the bar `mode`; where the bar hides the tools only Select works. */
export function toolAllowed(tool: Tool, mode: BarMode): boolean {
  if (tool !== "select" && !barShows(mode, "tools")) return false;
  return documentTakes(tool) && tiltTakes(tool);
}

/** The tools that edit hyperlanes, which wait while the map leans. */
const LANE_TOOLS: ReadonlySet<Tool> = new Set(["connect", "cut"]);

/** Whether the galaxy map leans now: a tilt is set, on a save. */
export function mapTilted(): boolean {
  const capabilities = documentCapabilities(useFileSessionStore.getState());
  return shownTilt(useToolStore.getState().tilt, capabilities) > 0;
}

/** Whether `tool` works on the map as it leans now: every tool but the lane tools does. */
export function tiltTakes(tool: Tool): boolean {
  return !LANE_TOOLS.has(tool) || !mapTilted();
}

/** Whether the open document can take `tool`. */
function documentTakes(tool: Tool): boolean {
  const requires = toolRequires(tool);
  if (requires === undefined) return true;
  return useFileSessionStore.getState().status === "ready" && canEdit(requires);
}

/** Whether the open document can take symmetry. */
export function symmetryAllowed(): boolean {
  return canEdit("symmetry");
}

export const useToolStore = create<ToolState>((set, get) => ({
  tool: "select",
  size: storedNumber(SIZE, SIZE_RANGE),
  spacing: storedNumber(SPACING, SPACING_RANGE),
  laneMode: LANE_MODE.read(),
  eraseTarget: ERASE_TARGET.read(),
  eraseSpecials: ERASE_SPECIALS.read(),
  symmetry: SYMMETRY.read(),
  lastSymmetry: storedLastSymmetry(),
  symmetryMenu: false,
  tilt: 0,
  heightMode: "raise",
  heightValue: 20,
  raiseStrength: 10,
  smoothStrength: 50,
  ripple: presetShape("ripples", SIZE_RANGE.fallback),
  ripplePreset: "ripples",

  setTool(tool) {
    if (!documentTakes(tool) || !tiltTakes(tool)) return false;
    if (get().tool !== tool) set({ tool });
    return true;
  },

  setSize(size) {
    const clamped = clamp(Math.round(size), SIZE_RANGE);
    set({ size: clamped });
    SIZE.save(clamped);
    const { ripplePreset } = get();
    if (ripplePreset !== null && followsSize(ripplePreset)) {
      set({ ripple: presetShape(ripplePreset, clamped) });
    }
  },

  stepSize(dir) {
    const size = get().size;
    get().setSize(dir > 0 ? size * SIZE_STEP : size / SIZE_STEP);
  },

  setSpacing(spacing) {
    const clamped = clamp(roundSpacing(spacing), SPACING_RANGE);
    set({ spacing: clamped });
    SPACING.save(clamped);
  },

  setLaneMode(laneMode) {
    set({ laneMode });
    LANE_MODE.save(laneMode);
  },

  setEraseTarget(eraseTarget) {
    set({ eraseTarget });
    ERASE_TARGET.save(eraseTarget);
  },

  setEraseSpecials(eraseSpecials) {
    set({ eraseSpecials });
    ERASE_SPECIALS.save(eraseSpecials);
  },

  setSymmetry(symmetry) {
    if (symmetry.kind !== "off" && !symmetryAllowed()) return;
    set({ symmetry });
    SYMMETRY.save(symmetry);
    if (symmetry.kind === "off") return;
    set({ lastSymmetry: symmetry });
    LAST_SYMMETRY.save(symmetry);
  },

  setSymmetryMenu(symmetryMenu) {
    if (get().symmetryMenu !== symmetryMenu) set({ symmetryMenu });
  },

  setTilt(degrees) {
    const tilt = clampTilt(degrees);
    if (get().tilt !== tilt) set({ tilt });
  },

  setHeightMode(heightMode) {
    set({ heightMode });
  },

  setHeightValue(value) {
    set({ heightValue: clamp(Math.round(value * 2) / 2, HEIGHT_SET_RANGE) });
  },

  setRaiseStrength(strength) {
    set({ raiseStrength: clamp(Math.round(strength), RAISE_RANGE) });
  },

  setSmoothStrength(strength) {
    set({ smoothStrength: clamp(Math.round(strength), SMOOTH_RANGE) });
  },

  setRipple(change) {
    const ripple = { ...get().ripple };
    for (const key of Object.keys(change) as Array<keyof RippleShape>) {
      const value = change[key];
      if (value !== undefined) ripple[key] = clamp(Math.round(value), RIPPLE_RANGES[key]);
    }
    set({ ripple, ripplePreset: null });
  },

  pickRipplePreset(preset) {
    set({ ripple: presetShape(preset, get().size), ripplePreset: preset });
  },

  toggleSymmetry() {
    const { symmetry, lastSymmetry } = get();
    get().setSymmetry(symmetry.kind === "off" ? lastSymmetry : SYMMETRY_OFF);
  },
}));
