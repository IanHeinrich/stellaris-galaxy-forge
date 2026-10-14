import type { SystemMove } from "../../generated/SystemMove";
import type { Pair } from "../geometry/pairs";
import type { Rect } from "../geometry/polygon";
import type { Pt } from "../geometry/pt";
import type { MapExtent } from "../guides";
import type { PlacementGround } from "../placement/ground";
import type { LaneMode } from "../placement/lanes";
import type { Placement } from "../placement/placement";
import type { PlacementRules } from "../placement/rules";
import type { StarChoice } from "./stars";

/** The figures the Shape tool draws. */
export type ShapeKind = "line" | "circle" | "polygon" | "rect" | "star" | "spiral" | "galaxy";

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
  /** How much of the radius a fill leaves empty about the centre, as a percentage: a donut. */
  hollow: number;
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
  /** How much of the radius a fill leaves empty about the centre, as a percentage. */
  hollow: number;
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
  /** How much of the radius a fill leaves empty about the centre, as a percentage. */
  hollow: number;
}

/**
 * Arms of systems winding out from `centre`, spread evenly round it, each a single line from
 * `inner` percent of `radius` out to `radius`.
 */
export interface SpiralShape {
  kind: "spiral";
  centre: Pt;
  /** World units, centre to each arm's outer end. */
  radius: number;
  /** Degrees, as `CircleShape.rotation`; the first arm ends here. */
  rotation: number;
  /** A whole number from 1 to 6. */
  arms: number;
  /** How far round each arm winds from its inner end to its outer end, in turns. */
  turns: number;
  /** Where each arm starts, as a percentage of `radius`. */
  inner: number;
}

/** One of Stellaris's galaxy shapes, by the key the game names it with. */
export type GalaxyForm =
  | "elliptical"
  | "spiral_2"
  | "spiral_3"
  | "spiral_4"
  | "spiral_6"
  | "ring"
  | "bar"
  | "starburst"
  | "cartwheel"
  | "spoked";

/** A galaxy of systems about `centre` in one of the game's galaxy shapes, its fill thinned to the shape's arms and core. */
export interface GalaxyShape {
  kind: "galaxy";
  centre: Pt;
  /** World units, centre to the rim. */
  radius: number;
  /** Degrees, as `CircleShape.rotation`. */
  rotation: number;
  form: GalaxyForm;
}

/** One pending figure, one case per kind. */
export type Shape =
  LineShape | CircleShape | PolygonShape | RectShape | StarShape | SpiralShape | GalaxyShape;

/** The `Shape` case of `kind`. */
export type ShapeOf<K extends ShapeKind> = Extract<Shape, { kind: K }>;

/** A square lattice or a hexagonal one. */
export type Lattice = "square" | "hex";

/**
 * Where a shape's systems go: `count` along the outline, or a fill `spacing` apart. A fill with
 * `edge` also lines the shape's edge with a row of systems.
 */
export type Fill =
  | { kind: "outline"; count: number }
  | { kind: "scattered"; spacing: number; edge: boolean }
  | { kind: "grid"; spacing: number; edge: boolean; lattice: Lattice };

export type FillKind = Fill["kind"];

/** A fill that fills the shape, `spacing` apart. */
export type SpacedFill = Exclude<Fill, { kind: "outline" }>;

/** The options panel's four fill choices: a grid is one choice per lattice. */
export type FillChoice = Exclude<FillKind, "grid"> | Lattice;

/** A shape's lanes: `follow` joins each outline system to the next, `mode` meshes as the paint brush does. */
export interface ShapeLanes {
  follow: boolean;
  mode: LaneMode;
  /** Whether `mode`'s lanes are grouped into islands as the game does, rather than an even mesh. */
  islands: boolean;
}

/** Whether a shape has a system at its centre, and whether spokes join that system to the outline. */
export type ShapeCentre = "none" | "system" | "spokes";

/**
 * What changes an outline after it is laid: how thick it is, its rings, the openings in its
 * follow lanes, how far its points wobble, and a system at the centre. Each is laid only where
 * `extraApplies` or `takesCentre` says it applies, and is otherwise as in `NO_EXTRAS`.
 */
export interface ShapeExtras {
  /** How many systems thick the outline is, scattered within a band about it. */
  band: number;
  /** How many concentric copies of the outline there are, a spacing apart, the outline the outermost. */
  rings: number;
  /** How many openings each run of follow lanes has, spread evenly along it. */
  gaps: number;
  /** How far each point is nudged at random, as a percentage of half the spacing. */
  wobble: number;
  centre: ShapeCentre;
}

/** A number field of `ShapeExtras`. */
export type ExtraKey = NumberKey<ShapeExtras>;

/** What Arrange does with the lanes between selected systems: keep them, lay new ones, or take them out. */
export type ArrangeLanes = "keep" | "rebuild" | "clear";

/**
 * What placing a pending shape does: add new systems at its points, or move the selected
 * systems `ids` onto them, one to a point, doing `lanes` with the lanes between them.
 */
export type ShapePurpose =
  | { kind: "add" }
  | {
      kind: "arrange";
      ids: readonly number[];
      lanes: ArrangeLanes;
      /** Under Rebuild and Clear, also take out the lanes from the selected systems to others. */
      alsoOuter: boolean;
    };

/** The shape on the map, waiting for Enter or Place. */
export interface PendingShape {
  purpose: ShapePurpose;
  shape: Shape;
  fill: Fill;
  lanes: ShapeLanes;
  extras: ShapeExtras;
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
  extras: ShapeExtras;
}

/** What Arrange remembers: the last shape arranged into, and what it did with the lanes. */
export interface ArrangeMemory {
  settings: ShapeSettings;
  lanes: ArrangeLanes;
  alsoOuter: boolean;
}

/** The Shape tool's remembered settings: the last kind used, and each kind's last settings. */
export interface ShapeMemory {
  kind: ShapeKind;
  kinds: { [K in ShapeKind]: ShapeSettings<K> };
  skipNear: boolean;
  stars: StarChoice;
  arrange: ArrangeMemory;
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
  /** What arranging the selection onto the points does; null when the shape adds systems. */
  arranged: Arrangement | null;
};

/**
 * What arranging a selection onto a shape's points does. The preview's points are where the
 * systems go, `moves[i]` taking a system to `points[i]`, and its pairs every lane the arranged
 * systems end up with, a moved system's end under the provisional id of the point it goes to.
 */
export interface Arrangement {
  /** How many systems are arranged. */
  count: number;
  /** One per point, in the points' order. */
  moves: readonly SystemMove[];
  /** The lanes between selected systems taken out, by system id. */
  cut: readonly Pair[];
  /** The lanes laid, by system id. */
  added: readonly Pair[];
  /** The lanes kept that would cross another lane once the systems move, as the preview's pairs name them. */
  crossing: readonly Pair[];
  /** Why the systems can't be arranged as shown; null when they can. */
  refusal: string | null;
}

/** The galaxy a shape is placed into, read once per preview. */
export interface ShapeGround {
  /** The existing systems, their grid and the symmetry. */
  placement: PlacementGround;
  /** How far out a point may stand, the rules' edge widened to the galaxy's reach: points past it go to `outside`. */
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

/** A stretch of an outline that follow lanes join in order: `count` points from `start`, the last back to the first when `closed`. */
export interface OutlineRun {
  start: number;
  count: number;
  closed: boolean;
}

/** A shape's outline as points in order, in runs: one for most shapes, one per arm of a spiral. */
export interface Outline {
  points: Pt[];
  runs: OutlineRun[];
}

/** Where Spokes to the centre joins an outline: every point of the run nearest the centre, or each run's first point. */
export type SpokeEnds = "ring" | "arms";

/** Whether a field shows whatever the fill, or only when the shape is filled. */
export type FieldWhen = "always" | "filled";

/** The keys of `S` that hold a number. */
type NumberKey<S> = { [P in keyof S]: S[P] extends number ? P : never }[keyof S];

/** A number field of a kind of shape, such as a polygon's `sides`. */
export type ShapeFieldKey<K extends ShapeKind> = NumberKey<ShapeOf<K>>;

/** One number field the options panel shows for a kind of shape. */
export interface ShapeField<S extends Shape> {
  key: NumberKey<S>;
  label: string;
  /** What the field does to the shape, for its tooltip. */
  hint: string;
  range: { min: number; max: number };
  step: number;
  /** Shown after the number: "", "°" or "%". */
  unit: string;
  /** Folded under "Exact values" rather than shown in the panel's body. */
  exact: boolean;
  when: FieldWhen;
}

/** How a kind's fill thins out: the share of its points kept about a point, and the share kept over what a fill fills. */
export interface Thinning<S extends Shape> {
  /** In [0, 1]. */
  at(s: S, p: Pt): number;
  mean(s: S): number;
}

/** Everything that differs between kinds of shape: one row of `SHAPE_SPECS`. */
export interface ShapeSpec<S extends Shape> {
  /** The kind's name in the picker and the status bar: "Rectangle". */
  label: string;
  /** What the kind lays, for the picker's tooltip. */
  hint: string;
  /** The picker's icon: SVG path data on `Glyph`'s 16-unit grid, stroked. */
  glyph: string;
  /** The shape a kind starts as before it is ever drawn: about the origin, at a default size. */
  initial: S;
  /** The fills `s` takes, outline first: a line takes only the outline. */
  fills(s: S): readonly FillKind[];
  /** The extras the kind takes, where its fill takes them too. */
  extras: readonly ExtraKey[];
  /** Where spokes join the outline to a system at the centre; null for a kind with no centre system. */
  spokes: SpokeEnds | null;
  /** Whether a fill can line the edge with a row of systems: a galaxy fades out toward its rim, so it has none. */
  edgeRow: boolean;
  /** Whether the lanes a shape lays always join its systems into one network, as a galaxy's do. */
  connected: boolean;
  /** How the kind's fill thins out; null for a kind filled evenly. */
  thinning: Thinning<S> | null;
  /** Whether the kind's lanes start grouped into islands as the game does. */
  islands: boolean;
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
  /** `n` points in order along the outline, every corner among them when `n` is at least the corner count; follow lanes join each run's in order. */
  outline(s: S, n: number): Outline;
  /** About `n` points round the edge of what a fill fills, every corner among them as for `outline`: an arc's closed sector, and a hollow centre's edge as a run of its own. */
  edge(s: S, n: number, copies?: number): Outline;
  /** What a placed `s` is called after "Placed ": "a ring", "a disc", "a hexagon". */
  noun(s: S, fill: Fill): string;
}

/** Every kind's row, each typed against its own case. */
export type ShapeSpecs = { [K in ShapeKind]: ShapeSpec<ShapeOf<K>> };
