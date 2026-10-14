import { SAMPLE_CAP } from "../placement/limits";
import { counted, thousands } from "../text";
import { specOf } from "./specs";
import type {
  Fill,
  FillChoice,
  FillKind,
  GalaxyFrame,
  Lattice,
  PendingShape,
  ShapePreview,
} from "./types";

/** Each fill choice in the options panel's row: its name, and the kind of fill it lays. */
const FILL_CHOICE_ROWS: Record<FillChoice, { label: string; kind: FillKind }> = {
  outline: { label: "Outline", kind: "outline" },
  scattered: { label: "Scattered", kind: "scattered" },
  square: { label: "Square grid", kind: "grid" },
  hex: { label: "Hex grid", kind: "grid" },
};

/** Every fill choice, in the row's order. */
export const FILL_CHOICES = Object.keys(FILL_CHOICE_ROWS) as FillChoice[];

/** Every lattice: the choices that lay a grid, each named for its lattice. */
export const LATTICES = FILL_CHOICES.filter(
  (c): c is Lattice => FILL_CHOICE_ROWS[c].kind === "grid",
);

/** A fill choice's name: "Hex grid". */
export function fillChoiceLabel(choice: FillChoice): string {
  return FILL_CHOICE_ROWS[choice].label;
}

/** The kind of fill a choice lays. */
export function fillKindOf(choice: FillChoice): FillKind {
  return FILL_CHOICE_ROWS[choice].kind;
}

/** The choice that shows `fill`: its kind, or a grid's lattice. */
export function fillChoiceOf(fill: Fill): FillChoice {
  return fill.kind === "grid" ? fill.lattice : fill.kind;
}

/** The status bar's words for a pending shape: what it adds, then each thing it leaves out. */
export interface ShapeStatus {
  /** "Circle · 22 systems, 22 lanes". */
  summary: string;
  /** "2 left out, too close to existing systems", "3 past the edge", one per kind of warning. */
  warnings: readonly string[];
}

/** Shares of the galaxy's width a line is read as, when it is within two points of one. */
const ACROSS: ReadonlyArray<readonly [number, string]> = [
  [1 / 4, "a quarter of the way across"],
  [1 / 3, "a third of the way across"],
  [1 / 2, "halfway across"],
  [2 / 3, "two thirds of the way across"],
  [3 / 4, "three quarters of the way across"],
  [1, "all the way across"],
];

/** How far across the galaxy a line `share` of its width long reaches, in words. */
function acrossWords(share: number): string {
  const named = ACROSS.find(([at]) => Math.abs(share - at) <= 0.02);
  return named ? named[1] : `${Math.round(share * 100)}% of the way across`;
}

/** The readout beside the rim handle: "40% of the galaxy · 24 systems". */
export function shapeReadout(
  pending: PendingShape,
  preview: ShapePreview,
  frame: GalaxyFrame,
): string {
  const share = specOf(pending.shape).size(pending.shape) / frame.radius;
  const size =
    pending.shape.kind === "line"
      ? acrossWords(share)
      : `${Math.round(share * 100)}% of the galaxy`;
  return `${size} · ${counted(preview.points.length, "system")}`;
}

/** What the status bar says while `pending` waits. */
export function shapeStatus(pending: PendingShape, preview: ShapePreview): ShapeStatus {
  const { points, pairs, left, outside, overlaps, capped, interleaved } = preview;
  const summary = `${specOf(pending.shape).label} · ${counted(points.length, "system")}, ${counted(pairs.length, "lane")}`;
  const warnings: string[] = [];
  if (left.length > 0) warnings.push(`${left.length} left out, too close to existing systems`);
  if (outside.length > 0) warnings.push(`${outside.length} past the edge`);
  if (overlaps > 0) warnings.push(`${counted(overlaps, "system")} overlap others on the map`);
  if (capped) warnings.push(`Stopped at ${thousands(SAMPLE_CAP)} systems, the most one shape adds`);
  if (interleaved !== null) {
    warnings.push(
      `Symmetry's ${interleaved} copies fall between the points: use a count that divides by ${interleaved}`,
    );
  }
  return { summary, warnings };
}

/** The history line's start, before `placeSystems` adds the counts: "Placed a ring of". */
export function placeLead(pending: PendingShape): string {
  return `Placed ${specOf(pending.shape).noun(pending.shape, pending.fill)} of`;
}

/** The Place button's label: "Place 22 systems". */
export function placeLabel(preview: ShapePreview): string {
  return `Place ${counted(preview.points.length, "system")}`;
}
