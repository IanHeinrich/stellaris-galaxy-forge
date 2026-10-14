import type { StoreApi } from "zustand";
import { clampTo } from "../lib/geometry/geometry";
import type { Pt } from "../lib/geometry/pt";
import type { MapExtent } from "../lib/guides";
import { placementBounds, type PlacementBounds } from "../lib/placement/rules";
import { LANE_MODES } from "../lib/placement/lanes";
import { LEAST_SPACING, SAMPLE_CAP } from "../lib/placement/limits";
import { newSeed } from "../lib/random";
import { spreadOf } from "../lib/shapes/arrange";
import { galaxyFrame } from "../lib/shapes/drag";
import { polylineLength } from "../lib/shapes/outline";
import { ARRANGE_LANE_CHOICES, FILL_CHOICES, LATTICES } from "../lib/shapes/shapeCopy";
import type { StarChoice } from "../lib/shapes/stars";
import {
  centreOf,
  heldShape,
  SHAPE_KINDS,
  SHAPE_SPECS,
  specFor,
  specOf,
} from "../lib/shapes/specs";
import type { Tool } from "../lib/tools";
import type {
  ArrangeLanes,
  ArrangeMemory,
  Fill,
  FillChoice,
  PendingShape,
  Shape,
  ShapeDragMods,
  ShapeFieldKey,
  ShapeHandleId,
  ShapeKind,
  ShapeLanes,
  ShapeMemory,
  ShapeOf,
  ShapePreview,
  ShapePurpose,
  ShapeSettings,
} from "../lib/shapes/types";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, isFiniteNumber, isOneOf, readPref, writePref } from "./prefs";
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
  /**
   * Sets one number field of the pending shape, or of the remembered kind's with none pending;
   * nothing when that shape is not of `kind`.
   */
  setShapeField<K extends ShapeKind>(kind: K, key: ShapeFieldKey<K>, value: number): void;
  /** Resizes the pending shape about its centre to `size`, as its spec's `size` reads it, keeping its count. */
  setShapeSize(size: number): void;
  /**
   * `[` and `]`: scales the pending shape about its centre by `factor`. It grows as far as its
   * kind's fields reach, past the galaxy too, and never shrinks below `SHAPE_SIZE_MIN`.
   */
  scaleShape(factor: number): void;
  /** Sets the pending shape's fill, or the remembered kind's when none is pending. */
  setFill(fill: Fill): void;
  /** Changes the fill to the one `choice` lays, keeping the count or spacing it had and starting the rest at their usual values. */
  setFillChoice(choice: FillChoice): void;
  /** Changes one or both of the pending shape's lane settings, or the remembered kind's. */
  setShapeLanes(change: Partial<ShapeLanes>): void;
  setSkipNear(on: boolean): void;
  /** Sets which stars a save's shape rolls, for the pending shape and the next; nothing for a choice that is none. */
  setShapeStars(choice: StarChoice): void;
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
  /**
   * Puts back `pending`, the shape a cancelled drag started from; nothing outside the Shape tool,
   * or once the drag's shape has been dropped.
   */
  restoreShape(pending: PendingShape): void;
  /** Saves the settings a drag left remembered but unsaved; the map calls it as each drag ends. */
  settleShape(): void;
  /**
   * Takes the pending shape off the map; true when there was one. A shape that was arranging
   * puts back the tool Arrange was started from.
   */
  dropShape(): boolean;
  /**
   * Arrange: opens the Shape tool with the shape last arranged into pending, centred on `at`
   * and sized to fit the systems `ids`, to move them onto. False when the document takes no
   * shapes or fewer than two of `ids` are systems.
   */
  startArrange(ids: readonly number[], at: Pt): boolean;
  /** Sets what arranging does with the lanes between the selected systems; nothing unless arranging. */
  setArrangeLanes(lanes: ArrangeLanes): void;
  /** Sets whether Rebuild and Clear also take out the lanes to other systems; nothing unless arranging. */
  setArrangeAlsoOuter(on: boolean): void;
  /**
   * Once an arrange is placed: puts back the tool Arrange was started from, unless the player
   * has drawn another shape since.
   */
  leaveArrange(): void;
}

/** How many systems an outline starts with, and the fewest and most it takes. */
export const OUTLINE_COUNT = 24;
export const COUNT_RANGE = { min: 2, max: SAMPLE_CAP } as const;

/** The least size a shape is resized to, in world units; the most is the galaxy's. */
export const SHAPE_SIZE_MIN = 10;

const ORIGIN: Pt = { x: 0, y: 0 };

const ADD: ShapePurpose = { kind: "add" };

/** How much farther apart than the least spacing an arranged outline's points start. */
const ARRANGE_ROOM = 1.2;

/** The lanes a fill starts with: an outline follows itself, a fill meshes among its new systems. */
function defaultLanes(fill: Fill): ShapeLanes {
  return fill.kind === "outline" ? { follow: true, mode: "off" } : { follow: false, mode: "new" };
}

/** A kind's starting settings: its initial shape, with the outline's defaults. */
function initialSettings<K extends ShapeKind>(kind: K): ShapeSettings<K> {
  const fill: Fill = { kind: "outline", count: OUTLINE_COUNT };
  return { shape: SHAPE_SPECS[kind].initial, fill, lanes: defaultLanes(fill) };
}

/** The stars a shape rolls until the player picks others: the game's usual mix. */
const RANDOM_STARS: StarChoice = { kind: "random" };

/** What Arrange starts from the first time: a circle, keeping the lanes. */
function firstArrange(): ArrangeMemory {
  const { shape, fill, lanes } = initialSettings("circle");
  return { settings: { shape, fill, lanes }, lanes: "keep", alsoOuter: false };
}

function firstMemory(): ShapeMemory {
  const kinds = Object.fromEntries(SHAPE_KINDS.map((kind) => [kind, initialSettings(kind)]));
  return {
    kind: "circle",
    kinds: kinds as ShapeMemory["kinds"],
    skipNear: true,
    stars: RANDOM_STARS,
    arrange: firstArrange(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPt(value: unknown): value is Pt {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

const isShapeKind = isOneOf(SHAPE_KINDS);
const isFillChoice = isOneOf(FILL_CHOICES);
const isLattice = isOneOf(LATTICES);
const isLaneMode = isOneOf(LANE_MODES);
const isArrangeLanes = isOneOf(ARRANGE_LANE_CHOICES);

function isClassKey(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** `value` as a star choice, a mix's classes each once; null when it is none, or a mix of none. */
function heldStars(value: unknown): StarChoice | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "random":
      return RANDOM_STARS;
    case "one":
      return isClassKey(value.class) ? { kind: "one", class: value.class } : null;
    case "mix": {
      if (!Array.isArray(value.classes) || !value.classes.every(isClassKey)) return null;
      const classes = [...new Set(value.classes)];
      return classes.length > 0 ? { kind: "mix", classes } : null;
    }
    default:
      return null;
  }
}

function isLanes(value: unknown): value is ShapeLanes {
  return isRecord(value) && isBoolean(value.follow) && isLaneMode(value.mode);
}

/** Whether `value` has the fields of `kind`'s initial shape, each of its type. */
function isShapeOf<K extends ShapeKind>(kind: K, value: unknown): value is ShapeOf<K> {
  const initial = specFor(kind).initial as unknown as Record<string, unknown>;
  if (!isRecord(value) || value.kind !== kind) return false;
  const keys = Object.keys(initial);
  if (Object.keys(value).length !== keys.length) return false;
  return keys.every((key) => {
    const want = initial[key];
    const got = value[key];
    if (typeof want === "number") return isFiniteNumber(got);
    if (typeof want === "string") return got === want;
    return isPt(got);
  });
}

/** `fill` with its count or spacing held to their ranges; null when it is no fill at all. */
function heldFill(fill: Fill): Fill | null {
  if (!isRecord(fill)) return null;
  switch (fill.kind) {
    case "outline":
      if (!isFiniteNumber(fill.count)) return null;
      return { kind: "outline", count: clampTo(Math.round(fill.count), COUNT_RANGE) };
    case "scattered":
      if (!isFiniteNumber(fill.spacing)) return null;
      return {
        kind: "scattered",
        spacing: clampTo(fill.spacing, SPACING_RANGE),
        edge: isBoolean(fill.edge) ? fill.edge : true,
      };
    case "grid":
      if (!isFiniteNumber(fill.spacing) || !isLattice(fill.lattice)) return null;
      return { kind: "grid", spacing: clampTo(fill.spacing, SPACING_RANGE), lattice: fill.lattice };
    default:
      return null;
  }
}

/**
 * The settings stored for `kind`, its shape and fill held to their ranges, since a drag can take a
 * field past its slider's end; a part that is no setting at all, or a fill the shape doesn't
 * take, starts as it first did.
 */
function storedSettings(kind: ShapeKind, value: unknown): ShapeSettings {
  const first = initialSettings(kind);
  if (!isRecord(value)) return first;
  const shape = isShapeOf(kind, value.shape) ? heldShape(value.shape) : first.shape;
  const held = heldFill(value.fill as Fill);
  const fill = held && specOf(shape).fills(shape).includes(held.kind) ? held : first.fill;
  const lanes = isLanes(value.lanes) && fill === held ? value.lanes : defaultLanes(fill);
  return { shape, fill, lanes };
}

/** What Arrange remembers as stored, starting as it first did where that is no setting. */
function storedArrange(value: unknown): ArrangeMemory {
  const first = firstArrange();
  if (!isRecord(value) || !isRecord(value.settings)) return first;
  const shape = value.settings.shape;
  const kind = isRecord(shape) && isShapeKind(shape.kind) ? shape.kind : first.settings.shape.kind;
  return {
    settings: storedSettings(kind, value.settings),
    lanes: isArrangeLanes(value.lanes) ? value.lanes : first.lanes,
    alsoOuter: isBoolean(value.alsoOuter) ? value.alsoOuter : first.alsoOuter,
  };
}

/** The remembered settings stored on this machine, the first settings standing in for what is not. */
function storedMemory(): ShapeMemory {
  const first = firstMemory();
  const value = readPref(PREF_KEYS.shapeMemory, null, isRecord);
  if (value === null) return first;
  const kinds = isRecord(value.kinds) ? value.kinds : {};
  const held = SHAPE_KINDS.map((kind) => [kind, storedSettings(kind, kinds[kind])]);
  return {
    kind: isShapeKind(value.kind) ? value.kind : first.kind,
    kinds: Object.fromEntries(held) as ShapeMemory["kinds"],
    skipNear: isBoolean(value.skipNear) ? value.skipNear : first.skipNear,
    stars: heldStars(value.stars) ?? first.stars,
    arrange: storedArrange(value.arrange),
  };
}

/** `shape` moved so that it is centred on `at`. */
function centredOn(shape: Shape, at: Pt): Shape {
  const c = centreOf(shape);
  if (c.x === at.x && c.y === at.y) return shape;
  return specOf(shape).moved(shape, { x: at.x - c.x, y: at.y - c.y });
}

/** The fill `choice` lays, keeping the count, spacing or edge `from` had and starting the rest at their usual values. */
function fillOfChoice(choice: FillChoice, from: Fill): Fill {
  const spacing = from.kind === "outline" ? SPACING_RANGE.fallback : from.spacing;
  switch (choice) {
    case "outline":
      return { kind: choice, count: from.kind === "outline" ? from.count : OUTLINE_COUNT };
    case "scattered":
      return { kind: choice, spacing, edge: from.kind === "scattered" ? from.edge : true };
    case "square":
    case "hex":
      return { kind: "grid", spacing, lattice: choice };
  }
}

/** `settings` with `fill`, its lanes as the fill starts them when the kind changes; null for a fill the shape cannot take. */
function withFill(settings: ShapeSettings, fill: Fill): ShapeSettings | null {
  if (!specOf(settings.shape).fills(settings.shape).includes(fill.kind)) return null;
  const lanes = fill.kind === settings.fill.kind ? settings.lanes : defaultLanes(fill);
  return { ...settings, fill, lanes };
}

/** Whether each number field `to` changed from `from` is inside its range. */
function inRanges(from: Shape, to: Shape): boolean {
  const was = from as unknown as Record<string, number>;
  const now = to as unknown as Record<string, number>;
  return specOf(to).fields.every(({ key, range }) => {
    const value = now[key as string]!;
    return value === was[key as string] || (value >= range.min && value <= range.max);
  });
}

/** `shape` resized toward `want`, stopping where a field would leave its range, but never below its size now. */
function resizedWithin(shape: Shape, want: number): Shape {
  const spec = specOf(shape);
  const at = (size: number) => spec.resized(shape, size);
  if (inRanges(shape, at(want))) return at(want);
  let fits = Math.min(spec.size(shape), want);
  let past = want;
  while (past - fits > 0.5) {
    const mid = (fits + past) / 2;
    if (inRanges(shape, at(mid))) fits = mid;
    else past = mid;
  }
  return at(fits);
}

/** The open document's edge, null when it records none, and the gap a placed or moved system keeps. */
export function placementBoundsNow(): PlacementBounds {
  const radius = useGalaxyStore.getState().galaxy?.galaxy_radius ?? 0;
  return placementBounds(useFileSessionStore.getState().capabilities, radius);
}

/** The open document's edge; null when it records none. */
function extentNow(): MapExtent | null {
  return placementBoundsNow().edge;
}

/**
 * `shape` sized to fit `points`: as far from its centre as they spread from theirs, and large
 * enough that `points.length` systems round its outline sit `least` apart and a little more.
 */
function fittedShape(shape: Shape, points: readonly Pt[], least: number): Shape {
  const n = points.length;
  const { spread } = spreadOf(points);
  const spec = specOf(shape);
  const fits = resizedWithin(shape, Math.max(SHAPE_SIZE_MIN, spread));
  const { points: ring, closed } = spec.outline(fits, n);
  const gaps = closed ? ring.length : ring.length - 1;
  const step = gaps > 0 ? polylineLength(ring, closed) / gaps : 0;
  const want = least * ARRANGE_ROOM;
  if (step >= want || step <= 0) return fits;
  return resizedWithin(fits, (spec.size(fits) * want) / step);
}

/** `p` held inside `extent`. */
function heldInside(p: Pt, extent: MapExtent | null): Pt {
  if (extent === null) return p;
  if (extent.shape === "square") {
    const range = { min: -extent.half, max: extent.half };
    return { x: clampTo(p.x, range), y: clampTo(p.y, range) };
  }
  const r = Math.hypot(p.x, p.y);
  return r <= extent.radius ? p : { x: (p.x * extent.radius) / r, y: (p.y * extent.radius) / r };
}

/** `value` held to `field`'s range, and to a whole number of steps when the step is whole. */
function heldTo(value: number, field: { range: { min: number; max: number }; step: number }) {
  const stepped = Number.isInteger(field.step)
    ? Math.round(value / field.step) * field.step
    : value;
  return clampTo(stepped, field.range);
}

/** `memory` with `settings` as their kind's, and that kind as the last used. */
function remembered(memory: ShapeMemory, settings: ShapeSettings): ShapeMemory {
  const kind = settings.shape.kind;
  const kinds = { ...memory.kinds, [kind]: settings } as ShapeMemory["kinds"];
  return { ...memory, kind, kinds };
}

/** The settings `memory` holds for `kind` (the last kind used when left out), as any kind's. */
export function rememberedFor(memory: ShapeMemory, kind: ShapeKind = memory.kind): ShapeSettings {
  const { shape, fill, lanes } = memory.kinds[kind];
  return { shape, fill, lanes };
}

function settingsOf({ shape, fill, lanes }: PendingShape): ShapeSettings {
  return { shape, fill, lanes };
}

/** `memory` with `pending`'s settings remembered for the next shape of its purpose. */
function rememberedOf(memory: ShapeMemory, pending: PendingShape): ShapeMemory {
  const { purpose } = pending;
  switch (purpose.kind) {
    case "add":
      return remembered(memory, settingsOf(pending));
    case "arrange":
      return {
        ...memory,
        arrange: {
          settings: settingsOf(pending),
          lanes: purpose.lanes,
          alsoOuter: purpose.alsoOuter,
        },
      };
  }
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
  /** Whether `shapeMemory` holds settings a drag changed that are not saved yet. */
  let unsaved = false;
  /** The tool Arrange was started from, which it puts back; null when that was the Shape tool. */
  let arrangedFrom: Tool | null = null;

  function putToolBack(): void {
    const back = arrangedFrom;
    arrangedFrom = null;
    if (back !== null && get().tool === "shape") get().setTool(back);
  }

  function save(memory: ShapeMemory): void {
    writePref(PREF_KEYS.shapeMemory, memory);
    unsaved = false;
  }

  function remember(memory: ShapeMemory): void {
    set({ shapeMemory: memory });
    save(memory);
  }

  /** Shows `pending` on the map, and remembers its settings for the next shape of its kind. */
  function show(pending: PendingShape): void {
    save(showDragged(pending));
  }

  /** `show` for each step of a drag, which saves the settings only once it ends. */
  function showDragged(pending: PendingShape): ShapeMemory {
    const memory = rememberedOf(get().shapeMemory, pending);
    set({ pendingShape: pending, shapeMemory: memory });
    unsaved = true;
    return memory;
  }

  /** Changes the pending shape's settings, or with none pending the remembered kind's. */
  function change(edit: (settings: ShapeSettings) => ShapeSettings | null): void {
    const { pendingShape, shapeMemory } = get();
    const before = pendingShape ? settingsOf(pendingShape) : rememberedFor(shapeMemory);
    const after = edit(before);
    if (after === null) return;
    if (pendingShape) show({ ...pendingShape, ...after });
    else remember(remembered(shapeMemory, after));
  }

  return {
    pendingShape: null,
    placingShape: null,
    shapeMemory: storedMemory(),

    startShape(at = ORIGIN) {
      const { shapeMemory } = get();
      const { shape, fill, lanes } = shapeMemory.kinds[shapeMemory.kind];
      lastAnchor = null;
      set({
        pendingShape: {
          purpose: ADD,
          shape: centredOn(shape, at),
          fill,
          lanes,
          skipNear: shapeMemory.skipNear,
          stars: shapeMemory.stars,
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
      const shape = centredOn(sized, centreOf(from));
      // Arranging keeps its fill and lanes where the new kind takes them.
      const kept =
        pendingShape.purpose.kind === "arrange"
          ? withFill({ ...settingsOf(pendingShape), shape }, pendingShape.fill)
          : null;
      show({ ...pendingShape, ...(kept ?? { ...settings, shape }) });
    },

    setShapeField(kind, key, value) {
      if (!Number.isFinite(value)) return;
      const field = specFor(kind).fields.find((f) => f.key === key);
      const held = field ? heldTo(value, field) : value;
      change((s) =>
        s.shape.kind === kind ? { ...s, shape: { ...s.shape, [key]: held } as Shape } : null,
      );
    },

    setShapeSize(size) {
      const pending = get().pendingShape;
      if (pending === null || !Number.isFinite(size)) return;
      const extent = extentNow();
      const most = extent ? galaxyFrame(extent).radius : Infinity;
      const held = clampTo(size, { min: SHAPE_SIZE_MIN, max: Math.max(SHAPE_SIZE_MIN, most) });
      show({ ...pending, shape: specOf(pending.shape).resized(pending.shape, held) });
    },

    scaleShape(factor) {
      const pending = get().pendingShape;
      if (pending === null || !Number.isFinite(factor) || factor <= 0) return;
      const want = Math.max(SHAPE_SIZE_MIN, specOf(pending.shape).size(pending.shape) * factor);
      show({ ...pending, shape: resizedWithin(pending.shape, want) });
    },

    setFill(asked) {
      const fill = heldFill(asked);
      if (fill !== null) change((s) => withFill(s, fill));
    },

    setFillChoice(choice) {
      if (isFillChoice(choice)) change((s) => withFill(s, fillOfChoice(choice, s.fill)));
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

    setShapeStars(choice) {
      const stars = heldStars(choice);
      if (stars === null) return;
      const { pendingShape, shapeMemory } = get();
      if (pendingShape) set({ pendingShape: { ...pendingShape, stars } });
      remember({ ...shapeMemory, stars });
    },

    shuffleShape() {
      const pending = get().pendingShape;
      if (pending) set({ pendingShape: { ...pending, seed: newSeed() } });
    },

    drawShape(anchor, to, mods) {
      const { pendingShape, shapeMemory } = get();
      // A shape drawn while arranging arranges too, of the kind and with the settings it had.
      const arranging = pendingShape?.purpose.kind === "arrange" ? pendingShape : null;
      const kind = arranging?.shape.kind ?? shapeMemory.kind;
      const settings = arranging ? settingsOf(arranging) : shapeMemory.kinds[kind];
      const prev = pendingShape?.shape.kind === kind ? pendingShape.shape : settings.shape;
      const sameDrag = pendingShape !== null && lastAnchor !== null && samePt(lastAnchor, anchor);
      lastAnchor = anchor;
      showDragged({
        purpose: arranging?.purpose ?? ADD,
        shape: specOf(prev).fromDrag(anchor, to, mods, prev),
        fill: settings.fill,
        lanes: settings.lanes,
        skipNear: shapeMemory.skipNear,
        stars: shapeMemory.stars,
        seed: sameDrag ? pendingShape.seed : newSeed(),
      });
    },

    moveShape(from, by) {
      const pending = get().pendingShape;
      if (pending === null || !isPt(by)) return;
      const c = centreOf(from);
      const to = heldInside({ x: c.x + by.x, y: c.y + by.y }, extentNow());
      const shape = specOf(from).moved(from, { x: to.x - c.x, y: to.y - c.y });
      showDragged({ ...pending, shape });
    },

    dragShapeHandle(from, id, to, mods) {
      const pending = get().pendingShape;
      if (pending) showDragged({ ...pending, shape: specOf(from).dragHandle(from, id, to, mods) });
    },

    restoreShape(pending) {
      const { tool, pendingShape } = get();
      if (tool === "shape" && pendingShape !== null) show(pending);
    },

    settleShape() {
      if (unsaved) save(get().shapeMemory);
    },

    dropShape() {
      const pending = get().pendingShape;
      if (pending === null) return false;
      set({ pendingShape: null });
      if (pending.purpose.kind === "arrange") putToolBack();
      return true;
    },

    startArrange(ids, at) {
      const systems = useGalaxyStore.getState().systems;
      const chosen = [...new Set(ids)].filter((id) => systems.has(id));
      const path = shapePath(useFileSessionStore.getState().capabilities);
      if (chosen.length < 2 || path === null || !isPt(at)) return false;
      const before = get().tool;
      const wasArranging = get().pendingShape?.purpose.kind === "arrange";
      if (!get().setTool("shape")) return false;
      if (before !== "shape") arrangedFrom = before;
      else if (!wasArranging) arrangedFrom = null;
      const { shapeMemory } = get();
      const { settings, lanes, alsoOuter } = shapeMemory.arrange;
      const least = Math.max(LEAST_SPACING, PLACEMENT_RULES[path].minGap);
      const fitted = fittedShape(
        settings.shape,
        chosen.map((id) => systems.get(id)!),
        least,
      );
      lastAnchor = null;
      set({
        pendingShape: {
          purpose: { kind: "arrange", ids: chosen, lanes, alsoOuter },
          shape: centredOn(fitted, at),
          fill: settings.fill,
          lanes: settings.lanes,
          skipNear: false,
          stars: shapeMemory.stars,
          seed: newSeed(),
        },
      });
      return true;
    },

    setArrangeLanes(lanes) {
      const pending = get().pendingShape;
      if (pending?.purpose.kind !== "arrange" || !isArrangeLanes(lanes)) return;
      show({ ...pending, purpose: { ...pending.purpose, lanes } });
    },

    setArrangeAlsoOuter(alsoOuter) {
      const pending = get().pendingShape;
      if (pending?.purpose.kind !== "arrange" || !isBoolean(alsoOuter)) return;
      show({ ...pending, purpose: { ...pending.purpose, alsoOuter } });
    },

    leaveArrange() {
      // A shape drawn while the arrange was landing is the player's, so it and the tool stay.
      if (get().pendingShape === null) putToolBack();
      else arrangedFrom = null;
    },
  };
}
