import { counted, listed, thousands } from "../text";
import { PLACEMENT_RULES, type PlacementPath } from "../placement/rules";
import { specOf } from "./specs";
import type {
  Arrangement,
  ArrangeLanes,
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

/** What the cap warning says the cap is, after "the most one shape adds". */
const CAP_PLACE: Record<PlacementPath, string> = {
  statements: "",
  rolled: " to a save",
};

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

/** What the status bar says while `pending` waits to take `path` into the document. */
export function shapeStatus(
  pending: PendingShape,
  preview: ShapePreview,
  path: PlacementPath,
): ShapeStatus {
  if (preview.arranged) return arrangeStatus(pending, preview, preview.arranged);
  const { points, pairs, left, outside, overlaps, crowded, capped, interleaved } = preview;
  const summary = `${specOf(pending.shape).label} · ${counted(points.length, "system")}, ${counted(pairs.length, "lane")}`;
  const warnings: string[] = [];
  if (left.length > 0) warnings.push(`${left.length} left out, too close to existing systems`);
  if (outside.length > 0) warnings.push(`${outside.length} past the edge`);
  if (crowded > 0) warnings.push(`${crowded} left out, too close to each other`);
  if (overlaps > 0) warnings.push(`${counted(overlaps, "system")} overlap others on the map`);
  if (capped) {
    const cap = thousands(PLACEMENT_RULES[path].cap);
    warnings.push(`Stopped at ${cap} systems, the most one shape adds${CAP_PLACE[path]}`);
  }
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

/** Why Arrange is off under symmetry. */
export const ARRANGE_SYMMETRY =
  "Arrange moves only the selected systems, so it works with symmetry off.";

/** Why Arrange needs a selection of two or more. */
export const ARRANGE_NEEDS_TWO = "Select two or more systems to arrange.";

/** Why Arrange refuses a selection past `cap`. */
export function arrangeOverCap(cap: number): string {
  return `Arrange moves at most ${thousands(cap)} systems at once.`;
}

/** Why a fill is refused when even its closest spacing holds fewer than `n` systems. */
export function arrangeTooSmall(n: number): string {
  return `The shape is too small for ${counted(n, "system")}. Make it larger.`;
}

/**
 * Why `n` systems can't be arranged when only `fit` points fit, naming what kept the rest out:
 * "Only 5 of 7 systems fit: 2 too close to other systems. Move or resize the shape."
 */
export function arrangeShortfall(
  n: number,
  fit: number,
  { left, outside, crowded }: Pick<ShapePreview, "left" | "outside" | "crowded">,
): string {
  const why = [
    left.length > 0 ? `${left.length} too close to other systems` : null,
    outside.length > 0 ? `${outside.length} past the edge` : null,
    crowded > 0 ? `${crowded} too close to each other` : null,
  ].filter((w): w is string => w !== null);
  if (why.length === 0) return arrangeTooSmall(n);
  return `Only ${fit} of ${n} systems fit: ${listed(why, "and")}. Move or resize the shape.`;
}

/** Each choice of what Arrange does with the lanes between selected systems: its name and what it does. */
const ARRANGE_LANE_ROWS: Record<ArrangeLanes, { label: string; title: string }> = {
  keep: { label: "Keep", title: "Keep every lane; each stretches to follow" },
  rebuild: { label: "Rebuild", title: "Take out the lanes between them and lay new ones" },
  clear: { label: "Clear", title: "Take out the lanes between them" },
};

/** Every lane choice of Arrange, in the row's order. */
export const ARRANGE_LANE_CHOICES = Object.keys(ARRANGE_LANE_ROWS) as ArrangeLanes[];

/** A lane choice's name and what it does. */
export function arrangeLaneRow(choice: ArrangeLanes): { label: string; title: string } {
  return ARRANGE_LANE_ROWS[choice];
}

/**
 * The history line of an arrangement into `pending`, with the lanes it cut and added where there
 * are any: "Arranged 7 systems in a ring, cut 3 lanes and added 7 lanes".
 */
export function arrangeDescription(
  pending: PendingShape,
  { count, cut, added }: Arrangement,
): string {
  const { shape, fill } = pending;
  const lead = `Arranged ${counted(count, "system")} in ${specOf(shape).noun(shape, fill)}`;
  const outer = outerCuts(pending, cut);
  const parts = [
    cut.length > 0 ? `cut ${counted(cut.length, "lane")}${outerNote(outer)}` : null,
    added.length > 0 ? `added ${counted(added.length, "lane")}` : null,
  ].filter((p): p is string => p !== null);
  return listed([lead, ...parts], "and");
}

/** " (2 to other systems)" after a count of lanes cut, when some ran out of the selection. */
function outerNote(outer: number): string {
  return outer > 0 ? ` (${outer} to other systems)` : "";
}

/** How many of `cut` run from an arranged system out to one `pending` doesn't arrange. */
function outerCuts(pending: PendingShape, cut: Arrangement["cut"]): number {
  if (pending.purpose.kind !== "arrange") return 0;
  const ids = new Set(pending.purpose.ids);
  return cut.filter(([a, b]) => !ids.has(a) || !ids.has(b)).length;
}

/** The Place button's label in Arrange: "Arrange 7 systems". */
export function arrangeLabel(count: number): string {
  return `Arrange ${counted(count, "system")}`;
}

/** What the status bar says while `pending` waits to arrange the selection. */
function arrangeStatus(
  pending: PendingShape,
  preview: ShapePreview,
  { count, cut, added, crossing, refusal }: Arrangement,
): ShapeStatus {
  const outer = outerCuts(pending, cut);
  const parts = [
    cut.length > 0 ? `${counted(cut.length, "lane")} out${outerNote(outer)}` : null,
    added.length > 0 ? `${counted(added.length, "lane")} in` : null,
  ].filter((p): p is string => p !== null);
  const lanes = parts.length > 0 ? parts.join(", ") : "lanes kept";
  const summary = `${specOf(pending.shape).label} · ${arrangeLabel(count)} · ${lanes}`;
  const warnings: string[] = [];
  if (refusal !== null) warnings.push(refusal);
  if (crossing.length > 0) {
    warnings.push(`${counted(crossing.length, "kept lane")} would cross others`);
  }
  if (refusal === null && preview.overlaps > 0) {
    warnings.push(`${counted(preview.overlaps, "system")} overlap others on the map`);
  }
  return { summary, warnings };
}
