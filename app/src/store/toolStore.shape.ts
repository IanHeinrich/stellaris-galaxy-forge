import type { StoreApi } from "zustand";
import type { Pt } from "../lib/geometry/pt";
import { SHAPE_SPECS } from "../lib/shapes/specs";
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
  ShapeSettings,
} from "../lib/shapes/types";
import type { ToolState } from "./toolStore";

/** The Shape tool's state: the shape waiting on the map, and what the next one starts from. */
export interface ShapeState {
  /** The shape on the map waiting for Enter or Place; null when none is. */
  pendingShape: PendingShape | null;
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
  setFill(fill: Fill): void;
  /** Changes one or both of the pending shape's lane settings. */
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

/** A kind's starting settings: its initial shape, with the outline's defaults. */
function initialSettings<K extends ShapeKind>(kind: K): ShapeSettings<K> {
  return {
    shape: SHAPE_SPECS[kind].initial,
    fill: { kind: "outline", count: 24 },
    lanes: { follow: true, mode: "off" },
  };
}

// stub: W2 reads it from prefs
const FIRST_MEMORY: ShapeMemory = {
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

/** The Shape tool's slice of `useToolStore`. */
export function shapeSlice(
  _set: StoreApi<ToolState>["setState"],
  get: StoreApi<ToolState>["getState"],
): ShapeState {
  // stub: W2 fills this; every action leaves the state as it is
  return {
    pendingShape: null,
    shapeMemory: FIRST_MEMORY,
    startShape() {},
    setShapeKind() {},
    setShapeField() {},
    setShapeSize() {},
    setFill() {},
    setShapeLanes() {},
    setSkipNear() {},
    shuffleShape() {},
    drawShape() {},
    moveShape() {},
    dragShapeHandle() {},
    restoreShape() {},
    dropShape: () => get().pendingShape !== null,
  };
}
