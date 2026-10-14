import type { StoreApi } from "zustand";
import { SAMPLE_CAP } from "../lib/brush/sample";
import type { Pt } from "../lib/geometry/pt";
import { mapExtent, type MapExtent } from "../lib/guides";
import type { LaneMode } from "../lib/placement/lanes";
import { newSeed } from "../lib/random";
import { galaxyFrame } from "../lib/shapes/drag";
import { FILL_KIND_LABELS, LATTICE_LABELS, SHAPE_KIND_LABELS } from "../lib/shapes/shapeCopy";
import { SHAPE_SPECS, specFor, specOf } from "../lib/shapes/specs";
import type {
  Fill,
  PendingShape,
  Shape,
  ShapeDragMods,
  ShapeFieldKey,
  ShapeHandleId,
  ShapeKind,
  ShapeLanes,
  ShapeMemory,
  ShapePreview,
  ShapeSettings,
} from "../lib/shapes/types";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, isFiniteNumber, isOneOf, prefField } from "./prefs";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { SPACING_RANGE, type ToolState } from "./toolStore";

/** The Shape tool's state: the shape waiting on the map, and what the next one starts from. */
export interface ShapeState {
  /** The shape on the map waiting for Enter or Place; null when none is. */
  pendingShape: PendingShape | null;
  /**
   * The preview of the shape Enter or Place took off the map, held until its edit settles, so the
   * map can draw it until the new systems arrive; null otherwise.
   */
  placingShape: ShapePreview | null;
  /** The last kind and each kind's last settings, kept across sessions on this machine. */
  shapeMemory: ShapeMemory;
  /** Puts the remembered shape on the map, centred on `at` (the origin when left out). */
  startShape(at?: Pt): void;
  /** Swaps the pending shape for one of `kind`, keeping its centre and size. */
  setShapeKind(kind: ShapeKind): void;
  /** Sets one number field of the pending shape; nothing when the pending shape is not of `kind`. */
  setShapeField<K extends ShapeKind>(kind: K, key: ShapeFieldKey<K>, value: number): void;
  /** Resizes the pending shape about its centre to `size`, as its spec's `size` reads it, keeping its count. */
  setShapeSize(size: number): void;
  /** Sets the pending shape's fill, or the remembered kind's when none is pending. */
  setFill(fill: Fill): void;
  /** Changes one or both of the pending shape's lane settings, or the remembered kind's. */
  setShapeLanes(change: Partial<ShapeLanes>): void;
  setSkipNear(on: boolean): void;
  /** Rolls a new seed, so a scattered fill lays out again. */
  shuffleShape(): void;
  /**
   * Replaces the pending shape with one of the remembered kind drawn from `anchor` to `to`, under
   * a new seed when `anchor` differs from the last draw's, so one drag keeps its seed.
   */
  drawShape(anchor: Pt, to: Pt, mods: ShapeDragMods): void;
  /** Sets the pending shape to `from`, the shape the drag started from, moved by the world offset `by`. */
  moveShape(from: Shape, by: Pt): void;
  /** Sets the pending shape to `from` with handle `id` dragged to `to`. */
  dragShapeHandle(from: Shape, id: ShapeHandleId, to: Pt, mods: ShapeDragMods): void;
  /** Puts back `pending`, the shape a drag Esc cancelled started from. */
  restoreShape(pending: PendingShape): void;
  /** Takes the pending shape off the map; true when there was one. */
  dropShape(): boolean;
}

export const LANE_MODES: readonly LaneMode[] = ["off", "new", "nearby"];

/** How many systems an outline starts with, and the fewest and most it takes. */
const OUTLINE_COUNT = 24;
export const COUNT_RANGE = { min: 2, max: SAMPLE_CAP } as const;

/** The least size a shape is resized to, in world units; the most is the galaxy's. */
export const SHAPE_SIZE_MIN = 10;

const ORIGIN: Pt = { x: 0, y: 0 };

/** The lanes a fill starts with: an outline follows itself, a fill meshes among its new systems. */
function defaultLanes(fill: Fill): ShapeLanes {
  return fill.kind === "outline" ? { follow: true, mode: "off" } : { follow: false, mode: "new" };
}

/** A kind's starting settings: its initial shape, with the outline's defaults. */
function initialSettings<K extends ShapeKind>(kind: K): ShapeSettings<K> {
  const fill: Fill = { kind: "outline", count: OUTLINE_COUNT };
  return { shape: SHAPE_SPECS[kind].initial, fill, lanes: defaultLanes(fill) };
}

function firstMemory(): ShapeMemory {
  return {
    kind: "circle",
    kinds: {
      line: initialSettings("line"),
      circle: initialSettings("circle"),
      polygon: initialSettings("polygon"),
      rect: initialSettings("rect"),
      star: initialSettings("star"),
    },
    skipNear: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPt(value: unknown): value is Pt {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

const SHAPE_KINDS = Object.keys(SHAPE_KIND_LABELS) as ShapeKind[];
const isShapeKind = isOneOf(SHAPE_KINDS);
const isFillKind = isOneOf(Object.keys(FILL_KIND_LABELS) as Fill["kind"][]);
const isLattice = isOneOf(Object.keys(LATTICE_LABELS) as Array<keyof typeof LATTICE_LABELS>);
const isLaneMode = isOneOf(LANE_MODES);

function isCount(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= COUNT_RANGE.min &&
    value <= COUNT_RANGE.max
  );
}

function isSpacing(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isFill(value: unknown): value is Fill {
  if (!isRecord(value) || !isFillKind(value.kind)) return false;
  switch (value.kind) {
    case "outline":
      return isCount(value.count);
    case "scattered":
      return isSpacing(value.spacing);
    case "grid":
      return isSpacing(value.spacing) && isLattice(value.lattice);
  }
}

function isLanes(value: unknown): value is ShapeLanes {
  return isRecord(value) && isBoolean(value.follow) && isLaneMode(value.mode);
}

/** Whether `value` has the fields of `kind`'s initial shape, each of its type, and in its field's range. */
function isShapeOf<K extends ShapeKind>(kind: K, value: unknown): value is Shape {
  const spec = specFor(kind);
  const initial = spec.initial as unknown as Record<string, unknown>;
  if (!isRecord(value) || value.kind !== kind) return false;
  const keys = Object.keys(initial);
  if (Object.keys(value).length !== keys.length) return false;
  const typed = keys.every((key) => {
    const want = initial[key];
    const got = value[key];
    if (typeof want === "number") return isFiniteNumber(got);
    if (typeof want === "string") return got === want;
    return isPt(got);
  });
  return (
    typed &&
    spec.fields.every((field) => {
      const got = value[field.key as string] as number;
      return got >= field.range.min && got <= field.range.max;
    })
  );
}

function isSettingsOf(kind: ShapeKind, value: unknown): boolean {
  return (
    isRecord(value) && isShapeOf(kind, value.shape) && isFill(value.fill) && isLanes(value.lanes)
  );
}

function isShapeMemory(value: unknown): value is ShapeMemory {
  if (!isRecord(value) || !isShapeKind(value.kind) || !isBoolean(value.skipNear)) return false;
  const kinds = value.kinds;
  return isRecord(kinds) && SHAPE_KINDS.every((kind) => isSettingsOf(kind, kinds[kind]));
}

const MEMORY = prefField(PREF_KEYS.shapeMemory, firstMemory(), isShapeMemory);

/** The point a shape is centred on: a line's midpoint, any other shape's `centre`. */
function centreOf(shape: Shape): Pt {
  if (shape.kind !== "line") return shape.centre;
  return { x: (shape.a.x + shape.b.x) / 2, y: (shape.a.y + shape.b.y) / 2 };
}

/** `shape` moved so that it is centred on `at`. */
function centredOn(shape: Shape, at: Pt): Shape {
  const c = centreOf(shape);
  if (c.x === at.x && c.y === at.y) return shape;
  return specOf(shape).moved(shape, { x: at.x - c.x, y: at.y - c.y });
}

/** `pending` with a fill its shape takes: an outline, with the outline's lanes, once it takes no other. */
function fitted(pending: PendingShape): PendingShape {
  if (specOf(pending.shape).fills(pending.shape).includes(pending.fill.kind)) return pending;
  const fill: Fill = { kind: "outline", count: OUTLINE_COUNT };
  return { ...pending, fill, lanes: defaultLanes(fill) };
}

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/** `fill` with its count or spacing held to their ranges; null when it is no fill at all. */
function heldFill(fill: Fill): Fill | null {
  if (!isRecord(fill)) return null;
  switch (fill.kind) {
    case "outline":
      if (!isFiniteNumber(fill.count)) return null;
      return { kind: "outline", count: clamp(Math.round(fill.count), COUNT_RANGE) };
    case "scattered":
      if (!isFiniteNumber(fill.spacing)) return null;
      return { kind: "scattered", spacing: clamp(fill.spacing, SPACING_RANGE) };
    case "grid":
      if (!isFiniteNumber(fill.spacing) || !isLattice(fill.lattice)) return null;
      return { kind: "grid", spacing: clamp(fill.spacing, SPACING_RANGE), lattice: fill.lattice };
    default:
      return null;
  }
}

/** The open document's edge; null when it records none. */
function extentNow(): MapExtent | null {
  const radius = useGalaxyStore.getState().galaxy?.galaxy_radius ?? 0;
  return mapExtent(useFileSessionStore.getState().kind, radius);
}

/** `p` held inside `extent`. */
function heldInside(p: Pt, extent: MapExtent | null): Pt {
  if (extent === null) return p;
  if (extent.shape === "square") {
    const range = { min: -extent.half, max: extent.half };
    return { x: clamp(p.x, range), y: clamp(p.y, range) };
  }
  const r = Math.hypot(p.x, p.y);
  return r <= extent.radius ? p : { x: (p.x * extent.radius) / r, y: (p.y * extent.radius) / r };
}

/** `value` held to `field`'s range, and to a whole number of steps when the step is whole. */
function heldTo(value: number, field: { range: { min: number; max: number }; step: number }) {
  const { min, max } = field.range;
  const stepped = Number.isInteger(field.step)
    ? Math.round(value / field.step) * field.step
    : value;
  return Math.min(max, Math.max(min, stepped));
}

/** `memory` with `settings` as their kind's, and that kind as the last used. */
function remembered(memory: ShapeMemory, settings: ShapeSettings): ShapeMemory {
  const kind = settings.shape.kind;
  const kinds = { ...memory.kinds, [kind]: settings } as ShapeMemory["kinds"];
  return { ...memory, kind, kinds };
}

/** The settings `memory` holds for `kind`, as any kind's. */
function rememberedFor(memory: ShapeMemory, kind: ShapeKind): ShapeSettings {
  const { shape, fill, lanes } = memory.kinds[kind];
  return { shape, fill, lanes };
}

function settingsOf({ shape, fill, lanes }: PendingShape): ShapeSettings {
  return { shape, fill, lanes };
}

function samePt(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.y === b.y;
}

/** The Shape tool's slice of `useToolStore`. */
export function shapeSlice(
  set: StoreApi<ToolState>["setState"],
  get: StoreApi<ToolState>["getState"],
): ShapeState {
  /** Where the last `drawShape` started, so a drag from the same press keeps its seed. */
  let lastAnchor: Pt | null = null;

  function remember(memory: ShapeMemory): void {
    set({ shapeMemory: memory });
    MEMORY.save(memory);
  }

  /** Shows `pending` on the map, and remembers its settings for the next shape of its kind. */
  function show(pending: PendingShape): void {
    const memory = remembered(get().shapeMemory, settingsOf(pending));
    set({ pendingShape: pending, shapeMemory: memory });
    MEMORY.save(memory);
  }

  /** Changes the pending shape's settings, or with none pending the remembered kind's. */
  function change(edit: (settings: ShapeSettings) => ShapeSettings | null): void {
    const { pendingShape, shapeMemory } = get();
    const before = pendingShape
      ? settingsOf(pendingShape)
      : rememberedFor(shapeMemory, shapeMemory.kind);
    const after = edit(before);
    if (after === null) return;
    if (pendingShape) show({ ...pendingShape, ...after });
    else remember(remembered(shapeMemory, after));
  }

  return {
    pendingShape: null,
    placingShape: null,
    shapeMemory: MEMORY.read(),

    startShape(at = ORIGIN) {
      const { shapeMemory } = get();
      const { shape, fill, lanes } = shapeMemory.kinds[shapeMemory.kind];
      lastAnchor = null;
      set({
        pendingShape: {
          shape: centredOn(shape, at),
          fill,
          lanes,
          skipNear: shapeMemory.skipNear,
          seed: newSeed(),
        },
      });
    },

    setShapeKind(kind) {
      const { pendingShape, shapeMemory } = get();
      if (pendingShape === null) {
        if (shapeMemory.kind !== kind) remember({ ...shapeMemory, kind });
        return;
      }
      const from = pendingShape.shape;
      if (from.kind === kind) return;
      const settings = shapeMemory.kinds[kind];
      const sized = specOf(settings.shape).resized(settings.shape, specOf(from).size(from));
      show(
        fitted({
          ...pendingShape,
          shape: centredOn(sized, centreOf(from)),
          fill: settings.fill,
          lanes: settings.lanes,
        }),
      );
    },

    setShapeField(kind, key, value) {
      const pending = get().pendingShape;
      if (pending === null || pending.shape.kind !== kind || !Number.isFinite(value)) return;
      const field = specFor(kind).fields.find((f) => f.key === key);
      const held = field ? heldTo(value, field) : value;
      const shape = { ...pending.shape, [key]: held } as Shape;
      show(fitted({ ...pending, shape }));
    },

    setShapeSize(size) {
      const pending = get().pendingShape;
      if (pending === null || !Number.isFinite(size)) return;
      const extent = extentNow();
      const most = extent ? galaxyFrame(extent).radius : Infinity;
      const held = clamp(size, { min: SHAPE_SIZE_MIN, max: Math.max(SHAPE_SIZE_MIN, most) });
      show({ ...pending, shape: specOf(pending.shape).resized(pending.shape, held) });
    },

    setFill(asked) {
      const fill = heldFill(asked);
      if (fill === null) return;
      change((s) => {
        if (!specOf(s.shape).fills(s.shape).includes(fill.kind)) return null;
        const lanes = fill.kind === s.fill.kind ? s.lanes : defaultLanes(fill);
        return { ...s, fill, lanes };
      });
    },

    setShapeLanes({ follow, mode }) {
      change((s) => ({
        ...s,
        lanes: {
          follow: isBoolean(follow) ? follow : s.lanes.follow,
          mode: isLaneMode(mode) ? mode : s.lanes.mode,
        },
      }));
    },

    setSkipNear(skipNear) {
      const { pendingShape, shapeMemory } = get();
      if (pendingShape) set({ pendingShape: { ...pendingShape, skipNear } });
      remember({ ...shapeMemory, skipNear });
    },

    shuffleShape() {
      const pending = get().pendingShape;
      if (pending) set({ pendingShape: { ...pending, seed: newSeed() } });
    },

    drawShape(anchor, to, mods) {
      const { pendingShape, shapeMemory } = get();
      const kind = shapeMemory.kind;
      const settings = shapeMemory.kinds[kind];
      const prev = pendingShape?.shape.kind === kind ? pendingShape.shape : settings.shape;
      const sameDrag = pendingShape !== null && lastAnchor !== null && samePt(lastAnchor, anchor);
      lastAnchor = anchor;
      show(
        fitted({
          shape: specOf(prev).fromDrag(anchor, to, mods, prev),
          fill: settings.fill,
          lanes: settings.lanes,
          skipNear: shapeMemory.skipNear,
          seed: sameDrag ? pendingShape.seed : newSeed(),
        }),
      );
    },

    moveShape(from, by) {
      const pending = get().pendingShape;
      if (pending === null || !isPt(by)) return;
      const c = centreOf(from);
      const to = heldInside({ x: c.x + by.x, y: c.y + by.y }, extentNow());
      show({ ...pending, shape: specOf(from).moved(from, { x: to.x - c.x, y: to.y - c.y }) });
    },

    dragShapeHandle(from, id, to, mods) {
      const pending = get().pendingShape;
      if (pending) show(fitted({ ...pending, shape: specOf(from).dragHandle(from, id, to, mods) }));
    },

    restoreShape(pending) {
      show(pending);
    },

    dropShape() {
      if (get().pendingShape === null) return false;
      set({ pendingShape: null });
      return true;
    },
  };
}
