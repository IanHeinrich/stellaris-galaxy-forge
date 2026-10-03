import { create } from "zustand";
import type { EraseTarget } from "../lib/brush/brushTools";
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

  setTool(tool) {
    if (!documentTakes(tool) || !tiltTakes(tool)) return false;
    if (get().tool !== tool) set({ tool });
    return true;
  },

  setSize(size) {
    const clamped = clamp(Math.round(size), SIZE_RANGE);
    set({ size: clamped });
    SIZE.save(clamped);
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

  toggleSymmetry() {
    const { symmetry, lastSymmetry } = get();
    get().setSymmetry(symmetry.kind === "off" ? lastSymmetry : SYMMETRY_OFF);
  },
}));
