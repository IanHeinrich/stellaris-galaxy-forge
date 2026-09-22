import { create } from "zustand";
import type { Capabilities } from "../generated/Capabilities";
import { documentCapabilities, supports } from "../lib/capabilities";
import { useFileSessionStore } from "./fileSessionStore";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, isFiniteNumber, readPref, writePref } from "./prefs";

/** What a left-drag on the map does: select and edit in place (ADR 0003), or one brush (ADR 0005). */
export type Tool = "select" | "paint" | "erase" | "connect" | "cut";

/** How the paint brush joins the systems it lays down: not at all, among themselves, or to neighbours too. */
export type LaneMode = "off" | "new" | "nearby";

export type EraseTarget = "systems" | "lanes";

export type SymmetryAxis = "x" | "y";

export type RotationOrder = 2 | 3 | 4 | 6 | 8;

/** The global symmetry: each edit and brush stroke repeated about the galaxy's centre. */
export type Symmetry =
  { kind: "off" } | { kind: "mirror"; axis: SymmetryAxis } | { kind: "rotate"; n: RotationOrder };

/** A symmetry that makes copies, as M turns back on. */
export type ActiveSymmetry = Exclude<Symmetry, { kind: "off" }>;

/** What M turns on before any symmetry has been picked. */
export const DEFAULT_SYMMETRY: ActiveSymmetry = { kind: "rotate", n: 4 };

/** What each tool needs of the open document; a tool absent here works on every kind. */
export const TOOL_REQUIRES: Partial<Record<Tool, keyof Capabilities>> = {
  paint: "create_systems",
  erase: "create_systems",
};

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
const ROTATION_ORDERS: readonly number[] = [2, 3, 4, 6, 8];
const SYMMETRY_OFF: Symmetry = { kind: "off" };

export interface ToolState {
  tool: Tool;
  size: number;
  spacing: number;
  laneMode: LaneMode;
  eraseTarget: EraseTarget;
  /** Whether the erase brush takes systems that carry an initializer, a spawn or a special. */
  eraseSpecials: boolean;
  symmetry: Symmetry;
  /** The symmetry M turns back on: the last one picked. */
  lastSymmetry: ActiveSymmetry;
  /** Whether the rail's symmetry flyout is open. */
  symmetryMenu: boolean;
  /** Switches tool, refusing one the open document cannot take; true when `tool` is now current. */
  setTool(tool: Tool): boolean;
  setSize(size: number): void;
  /** `[` shrinks the brush and `]` grows it, by a constant ratio. */
  stepSize(dir: -1 | 1): void;
  setSpacing(spacing: number): void;
  setLaneMode(mode: LaneMode): void;
  setEraseTarget(target: EraseTarget): void;
  setEraseSpecials(on: boolean): void;
  setSymmetry(symmetry: Symmetry): void;
  /** M: turns symmetry off, or back on as it last was. */
  toggleSymmetry(): void;
  setSymmetryMenu(open: boolean): void;
}

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}

function oneOf<T extends string>(values: readonly T[]) {
  return (value: unknown): value is T => typeof value === "string" && values.includes(value as T);
}

function isSymmetry(value: unknown): value is Symmetry {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (s.kind === "off") return true;
  if (s.kind === "mirror") return s.axis === "x" || s.axis === "y";
  return s.kind === "rotate" && typeof s.n === "number" && ROTATION_ORDERS.includes(s.n);
}

function isActiveSymmetry(value: unknown): value is ActiveSymmetry {
  return isSymmetry(value) && value.kind !== "off";
}

function storedLastSymmetry(): ActiveSymmetry {
  const current = readPref(PREF_KEYS.symmetry, SYMMETRY_OFF, isSymmetry);
  return readPref(
    PREF_KEYS.symmetryLast,
    current.kind === "off" ? DEFAULT_SYMMETRY : current,
    isActiveSymmetry,
  );
}

function storedNumber(key: string, range: { min: number; max: number; fallback: number }): number {
  return clamp(readPref(key, range.fallback, isFiniteNumber), range);
}

/** Whether the open document can take `tool`. */
export function toolAllowed(tool: Tool): boolean {
  const session = useFileSessionStore.getState();
  const requires = TOOL_REQUIRES[tool];
  if (requires === undefined) return true;
  return session.status === "ready" && supports(documentCapabilities(session), requires);
}

export const useToolStore = create<ToolState>((set, get) => ({
  tool: "select",
  size: storedNumber(PREF_KEYS.brushSize, SIZE_RANGE),
  spacing: storedNumber(PREF_KEYS.brushSpacing, SPACING_RANGE),
  laneMode: readPref(PREF_KEYS.brushLaneMode, "nearby", oneOf(LANE_MODES)),
  eraseTarget: readPref(PREF_KEYS.eraseTarget, "systems", oneOf(ERASE_TARGETS)),
  eraseSpecials: readPref(PREF_KEYS.eraseSpecials, false, isBoolean),
  symmetry: readPref(PREF_KEYS.symmetry, SYMMETRY_OFF, isSymmetry),
  lastSymmetry: storedLastSymmetry(),
  symmetryMenu: false,

  setTool(tool) {
    if (!toolAllowed(tool)) return false;
    if (get().tool !== tool) set({ tool });
    return true;
  },

  setSize(size) {
    const clamped = clamp(Math.round(size), SIZE_RANGE);
    set({ size: clamped });
    writePref(PREF_KEYS.brushSize, clamped);
  },

  stepSize(dir) {
    const size = get().size;
    get().setSize(dir > 0 ? size * SIZE_STEP : size / SIZE_STEP);
  },

  setSpacing(spacing) {
    const clamped = clamp(roundSpacing(spacing), SPACING_RANGE);
    set({ spacing: clamped });
    writePref(PREF_KEYS.brushSpacing, clamped);
  },

  setLaneMode(laneMode) {
    set({ laneMode });
    writePref(PREF_KEYS.brushLaneMode, laneMode);
  },

  setEraseTarget(eraseTarget) {
    set({ eraseTarget });
    writePref(PREF_KEYS.eraseTarget, eraseTarget);
  },

  setEraseSpecials(eraseSpecials) {
    set({ eraseSpecials });
    writePref(PREF_KEYS.eraseSpecials, eraseSpecials);
  },

  setSymmetry(symmetry) {
    set({ symmetry });
    writePref(PREF_KEYS.symmetry, symmetry);
    if (symmetry.kind === "off") return;
    set({ lastSymmetry: symmetry });
    writePref(PREF_KEYS.symmetryLast, symmetry);
  },

  setSymmetryMenu(symmetryMenu) {
    if (get().symmetryMenu !== symmetryMenu) set({ symmetryMenu });
  },

  toggleSymmetry() {
    const { symmetry, lastSymmetry } = get();
    get().setSymmetry(symmetry.kind === "off" ? lastSymmetry : SYMMETRY_OFF);
  },
}));
