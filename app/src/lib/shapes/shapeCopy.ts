import type {
  FillKind,
  GalaxyFrame,
  Lattice,
  PendingShape,
  ShapeKind,
  ShapePreview,
} from "./types";

// stub: W1 fills this
const notYet = (): never => {
  throw new Error("not implemented");
};

/** Each kind's name in the picker and the status bar. */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  line: "Line",
  circle: "Circle",
  polygon: "Polygon",
  rect: "Rectangle",
  star: "Star",
};

/** Each fill's name in the Outline / Scattered / Grid choice. */
export const FILL_KIND_LABELS: Record<FillKind, string> = {
  outline: "Outline",
  scattered: "Scattered",
  grid: "Grid",
};

/** Each lattice's name in the Square / Hex choice. */
export const LATTICE_LABELS: Record<Lattice, string> = {
  square: "Square",
  hex: "Hex",
};

/** The status bar's words for a pending shape: what it adds, then each thing it leaves out. */
export interface ShapeStatus {
  /** "Circle · 22 systems, 22 lanes". */
  summary: string;
  /** "2 left out, too close to existing systems", "3 past the edge", one per kind of warning. */
  warnings: readonly string[];
}

/** The readout beside the rim handle: "40% of the galaxy · 24 systems". */
export const shapeReadout: (
  pending: PendingShape,
  preview: ShapePreview,
  frame: GalaxyFrame,
) => string = notYet;

/** What the status bar says while `pending` waits. */
export const shapeStatus: (pending: PendingShape, preview: ShapePreview) => ShapeStatus = notYet;

/** The history line's start, before `placeSystems` adds the counts: "Placed a ring of". */
export const placeLead: (pending: PendingShape) => string = notYet;

/** The Place button's label: "Place 22 systems". */
export const placeLabel: (preview: ShapePreview) => string = notYet;
