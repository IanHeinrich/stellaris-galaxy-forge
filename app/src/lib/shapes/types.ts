import type { Rect } from "../geometry/polygon";
import type { Pt } from "../geometry/pt";
import type { MapExtent } from "../guides";
import type { PlacementGround } from "../placement/ground";
import type { LaneMode } from "../placement/lanes";
import type { Placement } from "../placement/placement";
import type { PlacementRules } from "./rules";
import type { StarChoice } from "./stars";

/** The figures the Shape tool draws. */
export type ShapeKind = "line" | "circle" | "polygon" | "rect" | "star";

/** Systems from `a` to `b`, both ends included. */
export interface LineShape {
  kind: "line";
  a: Pt;
  b: Pt;
}

/**
 * A ring about `centre`: an arc when `sweep` is under 360, an ellipse when `squash` is under 100.
 * An arc's fill fills the sector between it and the centre.
 */
export interface CircleShape {
  kind: "circle";
  centre: Pt;
  /** World units; the ellipse's half-width along `rotation`. */
  radius: number;
  /** Degrees, as `Math.atan2(y, x)` measures them in world coordinates; an arc starts here. */
  rotation: number;
  /** Degrees of arc in (0, 360], anticlockwise from `rotation`. */
  sweep: number;
  /** The ellipse's half-height as a percentage of `radius`, in (0, 100]. */
  squash: number;
}

/** A regular polygon with a corner at `rotation`. */
export interface PolygonShape {
  kind: "polygon";
  centre: Pt;
  /** World units, centre to corner. */
  radius: number;
  /** Degrees, as `CircleShape.rotation`. */
  rotation: number;
  /** A whole number from 3 to 12. */
  sides: number;
}

/** A rectangle about `centre`, `width` along `rotation`. */
export interface RectShape {
  kind: "rect";
  centre: Pt;
  /** World units. */
  width: number;
  /** World units. */
  height: number;
  /** Degrees, as `CircleShape.rotation`. */
  rotation: number;
}

/** A star polygon: `points` tips at `radius`, with notches between them at `inner` percent of it. */
export interface StarShape {
  kind: "star";
  centre: Pt;
  /** World units, centre to tip. */
  radius: number;
  /** Degrees, as `CircleShape.rotation`; a tip sits here. */
  rotation: number;
  /** A whole number from 4 to 12. */
  points: number;
  /** The notches' radius as a percentage of `radius`, in (0, 100). */
  inner: number;
}

/** One pending figure, one case per kind. */
export type Shape = LineShape | CircleShape | PolygonShape | RectShape | StarShape;

/** The `Shape` case of `kind`. */
export type ShapeOf<K extends ShapeKind> = Extract<Shape, { kind: K }>;

/** A square lattice or a hexagonal one. */
export type Lattice = "square" | "hex";

/**
 * Where a shape's systems go: `count` along the outline, or a fill `spacing` apart. A scattered
 * fill with `edge` also lines the shape's edge with a row of systems.
 */
export type Fill =
  | { kind: "outline"; count: number }
  | { kind: "scattered"; spacing: number; edge: boolean }
  | { kind: "grid"; spacing: number; lattice: Lattice };

export type FillKind = Fill["kind"];

/** A fill that fills the shape, `spacing` apart. */
export type SpacedFill = Exclude<Fill, { kind: "outline" }>;

/** The options panel's four fill choices: a grid is one choice per lattice. */
export type FillChoice = Exclude<FillKind, "grid"> | Lattice;

/** A shape's lanes: `follow` joins each outline system to the next, `mode` meshes as the paint brush does. */
export interface ShapeLanes {
  follow: boolean;
  mode: LaneMode;
}

/** The shape on the map, waiting for Enter or Place. */
export interface PendingShape {
  shape: Shape;
  fill: Fill;
  lanes: ShapeLanes;
  /** Leave out a point within the spacing of an existing system. */
  skipNear: boolean;
  /** Seeds the scattered fill and the star draw, so they hold still while the shape is resized. */
  seed: number;
  /** The star classes a rolled shape's systems take. */
  stars: StarChoice;
}

/** What the Shape tool remembers of one kind, which the next shape of that kind starts from. */
export interface ShapeSettings<K extends ShapeKind = ShapeKind> {
  shape: ShapeOf<K>;
  fill: Fill;
  lanes: ShapeLanes;
}

/** The Shape tool's remembered settings: the last kind used, and each kind's last settings. */
export interface ShapeMemory {
  kind: ShapeKind;
  kinds: { [K in ShapeKind]: ShapeSettings<K> };
  skipNear: boolean;
  stars: StarChoice;
}

/** A point left out for sitting within the spacing of existing system `blocker`. */
export interface LeftOut {
  at: Pt;
  blocker: number;
}

/** What placing a pending shape would add, and what it leaves out. */
export type ShapePreview = Placement & {
  /** Points left out beside an existing system, every symmetry copy's. */
  left: readonly LeftOut[];
  /** Points past the extent, left out with no lanes. */
  outside: readonly Pt[];
  /** How many new systems sit closer than the paint brush's least spacing to another system; allowed, but warned of. */
  overlaps: number;
  /** How many new systems were dropped for standing closer than the rules' least gap to another new one. */
  crowded: number;
  /** Whether points were dropped at the rules' cap over the symmetry's copies. */
  capped: boolean;
  /**
   * The symmetry's copies when they land on an outline between its points rather than on
   * them, as for a ring on the pivot whose count they don't divide; null otherwise.
   */
  interleaved: number | null;
  /** Each point's star class, `classes[i]` for `points[i]`; null where the document rolls none. */
  classes: readonly string[] | null;
};

/** The galaxy a shape is placed into, read once per preview. */
export interface ShapeGround {
  /** The existing systems, their grid and the symmetry. */
  placement: PlacementGround;
  /** The map's edge, the rules' edge at the galaxy's radius: points past it go to `outside`. */
  extent: MapExtent;
  /** The cap, least gap and edge of the path the shape takes into the document. */
  rules: PlacementRules;
  /** The star classes a rolled shape draws, each with its weight; null where the document rolls none. */
  starWeights: Array<[string, number]> | null;
  /** The Lane density slider's value. */
  laneDensity: number;
}

/** The circle a shape's size is measured against: "40% of the galaxy". */
export interface GalaxyFrame {
  centre: Pt;
  radius: number;
}

/** A handle's name, unique among one shape's handles and chosen by its `ShapeSpec` row. */
export type ShapeHandleId = string;

/** How a handle draws: the square that moves the shape, a round one that sizes it, or the small turn handle. */
export type HandleLook = "centre" | "size" | "turn";

/** One handle on a pending shape, at a world point. */
export interface ShapeHandle {
  id: ShapeHandleId;
  at: Pt;
  look: HandleLook;
}

/** What the pointer is on: one of the pending shape's handles, or inside it. */
export type ShapePick = { kind: "handle"; id: ShapeHandleId } | { kind: "inside" };

/** The keys a shape drag reads: Ctrl at the press turns `snap` off, Shift sets `constrain`. */
export interface ShapeDragMods {
  /** Snap the anchor or centre to the galaxy centre and to systems, and a rotation near a multiple of 45° onto it. */
  snap: boolean;
  /** Hold angles to 15° steps, and keep a rectangle square. */
  constrain: boolean;
}

/** A shape's outline as points in order, `closed` when the last joins the first. */
export interface Outline {
  points: Pt[];
  closed: boolean;
}

/** The keys of `S` that hold a number. */
type NumberKey<S> = { [P in keyof S]: S[P] extends number ? P : never }[keyof S];

/** A number field of a kind of shape, such as a polygon's `sides`. */
export type ShapeFieldKey<K extends ShapeKind> = NumberKey<ShapeOf<K>>;

/** One number field the options panel shows for a kind of shape. */
export interface ShapeField<S extends Shape> {
  key: NumberKey<S>;
  label: string;
  range: { min: number; max: number };
  step: number;
  /** Shown after the number: "", "°" or "%". */
  unit: string;
  /** Folded under "Exact values" rather than shown in the panel's body. */
  exact: boolean;
}

/** Everything that differs between kinds of shape: one row of `SHAPE_SPECS`. */
export interface ShapeSpec<S extends Shape> {
  /** The kind's name in the picker and the status bar: "Rectangle". */
  label: string;
  /** The picker's icon: SVG path data on `Glyph`'s 16-unit grid, stroked. */
  glyph: string;
  /** The shape a kind starts as before it is ever drawn: about the origin, at a default size. */
  initial: S;
  /** The fills `s` takes, outline first: a line takes only the outline. */
  fills(s: S): readonly FillKind[];
  /** The kind's own number fields, in the panel's order. */
  fields: readonly ShapeField<S>[];
  /** The shape a drag from `anchor` to `to` draws, taking what a drag doesn't set (sides, sweep) from `prev`. */
  fromDrag(anchor: Pt, to: Pt, mods: ShapeDragMods, prev: S): S;
  /** The handles drawn on `s`. */
  handles(s: S): readonly ShapeHandle[];
  /** `s` with handle `id` dragged to `to`. */
  dragHandle(s: S, id: ShapeHandleId, to: Pt, mods: ShapeDragMods): S;
  /** The Size slider's value, in world units: a radius, half a line's length, half a rectangle's diagonal. */
  size(s: S): number;
  /** `s` scaled about its centre so that `size` gives `size`. */
  resized(s: S, size: number): S;
  /** `s` moved by the world offset `by`. */
  moved(s: S, by: Pt): S;
  /** Whether `p` is inside what a fill fills, an arc's sector; never for a line. */
  contains(s: S, p: Pt): boolean;
  /** The world box around `s`, an arc's sector included. */
  bounds(s: S): Rect;
  /** The area a fill fills, in square world units: 0 for a line, an arc's sector. */
  area(s: S): number;
  /** `n` points in order along the outline, every corner among them when `n` is at least the corner count; follow lanes join them in this order. */
  outline(s: S, n: number): Outline;
  /** `n` points round the edge of what a fill fills, every corner among them as for `outline`: an arc's closed sector. */
  edge(s: S, n: number): Outline;
  /** What a placed `s` is called after "Placed ": "a ring", "a disc", "a hexagon". */
  noun(s: S, fill: Fill): string;
}

/** Every kind's row, each typed against its own case. */
export type ShapeSpecs = { [K in ShapeKind]: ShapeSpec<ShapeOf<K>> };
