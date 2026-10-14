import { counted, listed, thousands } from "../text";
import type { OptionCopy } from "../toolCopy";
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

/** Each fill choice in the options panel's row: its name, what it does, and the kind of fill it lays. */
const FILL_CHOICE_ROWS: Record<FillChoice, OptionCopy & { kind: FillKind }> = {
  outline: { label: "Outline", hint: "Put systems along the shape's edge only.", kind: "outline" },
  scattered: {
    label: "Scattered",
    hint: "Fill the shape with systems at random.",
    kind: "scattered",
  },
  square: {
    label: "Square grid",
    hint: "Fill the shape with systems in rows and columns.",
    kind: "grid",
  },
  hex: {
    label: "Hex grid",
    hint: "Fill the shape with systems in a honeycomb pattern.",
    kind: "grid",
  },
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

/** What a fill choice does, for its tooltip. */
export function fillChoiceHint(choice: FillChoice): string {
  return FILL_CHOICE_ROWS[choice].hint;
}

/** A section of the Shape tool's options panel. */
export type ShapeSection = "shape" | "fill" | "form" | "systems" | "lanes";

/** Each section's heading, in the panel's order. */
export const SHAPE_SECTION_HEADINGS: Record<ShapeSection, string> = {
  shape: "Shape",
  fill: "Fill",
  form: "Size and form",
  systems: "Systems",
  lanes: "Lanes",
};

/** Every section, in the panel's order. */
export const SHAPE_SECTIONS = Object.keys(SHAPE_SECTION_HEADINGS) as ShapeSection[];

/** The Shape tool's own options, beyond the kind's fields, the extras and the lane options it shares with the brushes. */
export type ShapeOption =
  | "size"
  | "small"
  | "whole"
  | "systems"
  | "selected"
  | "density"
  | "spacing"
  | "edge"
  | "follow"
  | "centre"
  | "spokes"
  | "skipNear"
  | "stars"
  | "shuffle"
  | "exact"
  | "centreAt"
  | "alsoOuter"
  | "galaxyForm";

export const SHAPE_OPTIONS: Record<ShapeOption, OptionCopy> = {
  size: { label: "Size", hint: "Make the shape larger or smaller." },
  small: { label: "Small", hint: "Make the shape a tenth as wide as the galaxy." },
  whole: { label: "Whole galaxy", hint: "Make the shape as wide as the galaxy." },
  systems: { label: "How many", hint: "Set how many systems go along the outline." },
  selected: { label: "Selected", hint: "The systems Arrange moves onto the shape." },
  density: { label: "System density", hint: "Set how close together the systems are." },
  spacing: {
    label: "Spacing",
    hint: "Set the distance between neighbouring systems, in game units.",
  },
  edge: {
    label: "Line the edge with systems",
    hint: "Add a row of systems along the shape's edge too.",
  },
  follow: {
    label: "Follow the shape",
    hint: "Join each system on the edge to the next one along it.",
  },
  centre: { label: "A system at the centre", hint: "Add one system at the centre of the shape." },
  spokes: {
    label: "Spokes to the centre",
    hint: "Join the centre system to every system on the outline.",
  },
  skipNear: {
    label: "Don't place on top of existing systems",
    hint: "Leave out points too close to a system already on the map.",
  },
  stars: { label: "Stars", hint: "Choose the star class of the new systems." },
  shuffle: { label: "Shuffle", hint: "Roll the random layout and stars again." },
  exact: {
    label: "Exact values",
    hint: "Type exact numbers for the shape's position, size and rotation.",
  },
  centreAt: { label: "Centre", hint: "Move the shape's centre to these coordinates." },
  alsoOuter: {
    label: "Also remove lanes to other systems",
    hint: "Remove the lanes from the selected systems to the rest of the map too.",
  },
  galaxyForm: {
    label: "Galaxy shape",
    hint: "Choose which of the game's galaxy shapes to lay the systems out in.",
  },
};

/** The tooltip on each star class's box under A mix…. */
export const MIX_CLASS_HINT = "Tick the star classes the mix rolls from.";

/** The tooltip on the Place button while it can place. */
export const PLACE_HINT = "Add the systems shown on the map.";

/** The tooltip on the Arrange button while it can arrange. */
export const ARRANGE_HINT = "Move the selected systems to the points shown on the map.";

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
  keep: {
    label: "Keep",
    title: "Keep the lanes between the selected systems, stretched to follow.",
  },
  rebuild: {
    label: "Rebuild",
    title: "Replace the lanes between the selected systems with new ones.",
  },
  clear: { label: "Clear", title: "Remove the lanes between the selected systems." },
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
