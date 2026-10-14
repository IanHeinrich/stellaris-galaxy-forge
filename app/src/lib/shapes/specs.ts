import { boxOf, inRing, type Rect } from "../geometry/polygon";
import type { Pt } from "../geometry/pt";
import { ANGLE_STEP, draggedRotation, snapAngle } from "./drag";
import { clamp } from "../geometry/geometry";
import { angleOf, dir, distance, lerp, norm360, toLocal, toWorld, type ShapeFrame } from "./frame";
import {
  alongPolyline,
  arcPoints,
  cornersThenPieces,
  cornersThenSides,
  joined,
  oneRun,
} from "./outline";
import { galaxyDensity, keptShare } from "./galaxies";
import type {
  CircleShape,
  ExtraKey,
  FieldWhen,
  Fill,
  FillKind,
  GalaxyShape,
  LineShape,
  Outline,
  PolygonShape,
  RectShape,
  Shape,
  ShapeDragMods,
  ShapeField,
  ShapeHandle,
  ShapeKind,
  ShapeOf,
  ShapeSpec,
  ShapeSpecs,
  SpiralShape,
  StarShape,
} from "./types";

/** The handle that moves a shape, which every kind has. */
const CENTRE_HANDLE = "centre";
/** The round handle that sizes a shape about its centre: a circle's rim, a polygon's or star's first corner. */
const RIM_HANDLE = "rim";
/** The small handle that turns a shape. */
const TURN_HANDLE = "turn";

/** How far past its rim handle a shape's turn handle sits, as a share of the shape's size. */
const TURN_GAP = 0.15;
/** The least size a drag gives a shape, in world units. */
const LEAST_SIZE = 1;
/** Every point of an ellipse's outline is spread along at least this many chords. */
const ELLIPSE_CHORDS = 256;

const ORIGIN = { x: 0, y: 0 };
const ALL_FILLS: readonly FillKind[] = ["outline", "scattered", "grid"];
const OUTLINE_ONLY: readonly FillKind[] = ["outline"];

const SIZE_RANGE = { min: LEAST_SIZE, max: 1000 };
const ROTATION_RANGE = { min: 0, max: 359 };

/** `degrees` rounded to a whole degree in [0, 360), so 359.6 turns to 0 rather than past the field's 359. */
function wholeDegrees(degrees: number): number {
  return norm360(Math.round(degrees));
}

/** A drawn size held to the size fields' range. */
function heldSize(size: number): number {
  return clamp(size, SIZE_RANGE.min, SIZE_RANGE.max);
}

/** `to`'s angle about `from` as a dragged rotation, to a whole degree. */
function heldAngle(from: Pt, to: Pt, mods: ShapeDragMods): number {
  return wholeDegrees(draggedRotation(angleOf(from, to), mods));
}

function frameOf(s: { centre: Pt; rotation: number }): ShapeFrame {
  return { origin: s.centre, rotation: s.rotation };
}

function added(p: Pt, by: Pt): Pt {
  return { x: p.x + by.x, y: p.y + by.y };
}

function handle(id: string, at: Pt, look: ShapeHandle["look"]): ShapeHandle {
  return { id, at, look };
}

/** The turn handle `reach` out from the centre along the rotation, and a little further. */
function turnHandle(s: { centre: Pt; rotation: number }, reach: number, size: number): ShapeHandle {
  return handle(TURN_HANDLE, toWorld(frameOf(s), { x: reach + TURN_GAP * size, y: 0 }), "turn");
}

/** The radius and rotation fields every radial kind has, folded under "Exact values". */
const RADIUS_FIELD = {
  key: "radius",
  label: "Radius",
  hint: "Set how far the shape reaches from its centre, in game units.",
  range: SIZE_RANGE,
  step: 1,
  unit: "",
  exact: true,
  when: "always",
} as const;
const ROTATION_FIELD = {
  key: "rotation",
  label: "Rotation",
  hint: "Turn the shape about its centre.",
  range: ROTATION_RANGE,
  step: 1,
  unit: "°",
  exact: true,
  when: "always",
} as const;

/** What the circle, polygon, star, spiral and galaxy share: a centre, a radius and a rotation. */
type Radial = CircleShape | PolygonShape | StarShape | SpiralShape | GalaxyShape;

/** The extras a closed outline takes, and those an open one takes, which has no rings. */
const CLOSED_EXTRAS: readonly ExtraKey[] = ["band", "rings", "gaps", "wobble"];
const OPEN_EXTRAS: readonly ExtraKey[] = ["band", "gaps", "wobble"];

// --- Hollow centres ---

/** The kinds a fill can leave hollow. */
type Hollowed = CircleShape | PolygonShape | StarShape;

const HOLLOW_FIELD = {
  key: "hollow",
  label: "Hollow centre",
  hint: "Leave the middle empty, as a share of the radius.",
  range: { min: 0, max: 90 },
  step: 1,
  unit: "%",
  exact: false,
  when: "filled",
} as const;

/** The hole a hollow shape leaves: the shape itself, solid and scaled down about its centre. */
function holeOf<S extends Hollowed>(s: S): S {
  return { ...s, radius: (s.radius * s.hollow) / 100, hollow: 0 };
}

/** Whether `p` is inside what a fill fills: inside the solid shape and not in its hole. */
function hollowContains<S extends Hollowed>(solid: (s: S, p: Pt) => boolean) {
  return (s: S, p: Pt) => solid(s, p) && !(s.hollow > 0 && solid(holeOf(s), p));
}

/** The share of the solid shape's area a fill fills. */
function filledShare(s: Hollowed): number {
  return 1 - (s.hollow / 100) ** 2;
}

/**
 * About `n` points round the edge `outer` gives and round the hole's, each a run, shared by
 * their lengths in whole multiples of `copies` where `n` is one, so symmetry's copies of each
 * run land on it.
 */
function hollowEdge<S extends Hollowed>(
  s: S,
  n: number,
  copies: number,
  outer: (s: S, n: number) => Outline,
): Outline {
  if (s.hollow <= 0) return outer(s, n);
  const unit = n % copies === 0 ? copies : 1;
  const least = unit * Math.ceil(3 / unit);
  const share = (n * s.hollow) / (100 + s.hollow);
  const inner = Math.max(least, unit * Math.round(share / unit));
  return joined([outer(s, Math.max(least, n - inner)), outer(holeOf(s), inner)]);
}

/** `noun` for a fill that leaves the centre empty: "a hollow hexagon". */
function hollowed(noun: string, s: Hollowed, fill: Fill): string {
  if (fill.kind === "outline" || s.hollow <= 0) return noun;
  return `a hollow ${noun.replace(/^an? /, "")}`;
}

function radialFromDrag<S extends Radial>(anchor: Pt, to: Pt, mods: ShapeDragMods, prev: S): S {
  return {
    ...prev,
    centre: anchor,
    radius: heldSize(distance(anchor, to)),
    rotation: heldAngle(anchor, to, mods),
  };
}

/** A radial shape with one of the handles every radial kind has dragged; null for another handle. */
function radialDragged<S extends Radial>(s: S, id: string, to: Pt, mods: ShapeDragMods): S | null {
  switch (id) {
    case CENTRE_HANDLE:
      return { ...s, centre: to };
    case RIM_HANDLE:
      return { ...s, radius: heldSize(distance(s.centre, to)) };
    case TURN_HANDLE:
      return { ...s, rotation: heldAngle(s.centre, to, mods) };
    default:
      return null;
  }
}

/** The parts of a row every radial kind shares. */
function radialRow<S extends Radial>() {
  return {
    fromDrag: radialFromDrag<S>,
    size: (s: S) => s.radius,
    resized: (s: S, size: number): S => ({ ...s, radius: Math.max(LEAST_SIZE, size) }),
    moved: (s: S, by: Pt): S => ({ ...s, centre: added(s.centre, by) }),
  };
}

// --- Line ---

const LINE: ShapeSpec<LineShape> = {
  label: "Line",
  hint: "Lay systems along a straight line.",
  glyph: "M2.5 13.5 13.5 2.5",
  initial: { kind: "line", a: { x: -200, y: 0 }, b: { x: 200, y: 0 } },
  fills: () => OUTLINE_ONLY,
  extras: OPEN_EXTRAS,
  spokes: null,
  edgeRow: true,
  connected: false,
  thinning: null,
  islands: false,
  fields: [],
  fromDrag: (anchor, to, mods, prev) => ({
    ...prev,
    a: anchor,
    b: mods.constrain ? snapAngle(anchor, to) : to,
  }),
  handles: (s) => [
    handle(CENTRE_HANDLE, lerp(s.a, s.b, 0.5), "centre"),
    handle("a", s.a, "size"),
    handle("b", s.b, "size"),
  ],
  dragHandle(s, id, to, mods) {
    switch (id) {
      case "a":
        return { ...s, a: mods.constrain ? snapAngle(s.b, to) : to };
      case "b":
        return { ...s, b: mods.constrain ? snapAngle(s.a, to) : to };
      case CENTRE_HANDLE: {
        const mid = lerp(s.a, s.b, 0.5);
        return LINE.moved(s, { x: to.x - mid.x, y: to.y - mid.y });
      }
      default:
        return s;
    }
  },
  size: (s) => distance(s.a, s.b) / 2,
  resized(s, size) {
    const mid = lerp(s.a, s.b, 0.5);
    const half = distance(s.a, s.b) / 2;
    if (half === 0) {
      return { ...s, a: { x: mid.x - size, y: mid.y }, b: { x: mid.x + size, y: mid.y } };
    }
    const k = size / half;
    const scaled = (p: Pt) => ({ x: mid.x + (p.x - mid.x) * k, y: mid.y + (p.y - mid.y) * k });
    return { ...s, a: scaled(s.a), b: scaled(s.b) };
  },
  moved: (s, by) => ({ ...s, a: added(s.a, by), b: added(s.b, by) }),
  contains: () => false,
  bounds: (s) => boxOf([s.a, s.b]),
  area: () => 0,
  outline: (s, n) => oneRun(alongPolyline([s.a, s.b], false, n), false),
  edge: (s, n) => LINE.outline(s, n),
  noun: () => "a line",
};

// --- Circle, arc and ellipse ---

/** Point `t` degrees round the ellipse from its first, measured before it is squashed. */
function ellipsePoint(s: CircleShape, t: number): Pt {
  const d = dir(t);
  return toWorld(frameOf(s), { x: s.radius * d.x, y: (s.radius * s.squash * d.y) / 100 });
}

/** `to`'s angle round the ellipse from its first point, measured before it is squashed. */
function ellipseAngle(s: CircleShape, to: Pt): number {
  const local = toLocal(frameOf(s), to);
  return angleOf(ORIGIN, { x: local.x, y: (local.y * 100) / s.squash });
}

const SWEEP_RANGE = { min: 10, max: 360 };
const SQUASH_RANGE = { min: 10, max: 100 };

function isArc(s: CircleShape): boolean {
  return s.sweep < 360;
}

/** The ellipse's half-height. */
function halfHeight(s: CircleShape): number {
  return (s.radius * s.squash) / 100;
}

/** Points close together along the ellipse from its first, enough to spread `n` along; an arc's last is its end. */
function denseEllipse(s: CircleShape, n: number): Pt[] {
  const chords = Math.max(ELLIPSE_CHORDS, 4 * n);
  return Array.from({ length: isArc(s) ? chords + 1 : chords }, (_, i) =>
    ellipsePoint(s, (i * Math.min(s.sweep, 360)) / chords),
  );
}

/** The angles round the ellipse, measured before it is squashed, where it reaches furthest along x and along y. */
function ellipseExtremes(s: CircleShape): number[] {
  const { x: c, y: sn } = dir(s.rotation);
  const b = halfHeight(s);
  const alongX = angleOf(ORIGIN, { x: s.radius * c, y: -b * sn });
  const alongY = angleOf(ORIGIN, { x: s.radius * sn, y: b * c });
  return [alongX, alongX + 180, alongY, alongY + 180].map(norm360);
}

/** A filled arc's words, round and oval, for each sweep that has its own: any other is a wedge. */
const SECTOR_NOUNS: Readonly<Record<number, { round: string; oval: string }>> = {
  180: { round: "a half disc", oval: "a half oval" },
  90: { round: "a quarter disc", oval: "a quarter oval" },
};

const CIRCLE: ShapeSpec<CircleShape> = {
  label: "Circle",
  hint: "Lay systems in a circle, an arc or an oval.",
  glyph: "M2.5 8a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0Z",
  initial: {
    kind: "circle",
    centre: ORIGIN,
    radius: 200,
    rotation: 0,
    sweep: 360,
    squash: 100,
    hollow: 0,
  },
  fills: () => ALL_FILLS,
  extras: CLOSED_EXTRAS,
  spokes: "ring",
  edgeRow: true,
  connected: false,
  thinning: null,
  islands: false,
  fields: [
    {
      key: "sweep",
      label: "Arc",
      hint: "Open the circle into an arc this many degrees round.",
      range: SWEEP_RANGE,
      step: 1,
      unit: "°",
      exact: false,
      when: "always",
    },
    {
      key: "squash",
      label: "Roundness",
      hint: "Squash the circle into an oval.",
      range: SQUASH_RANGE,
      step: 1,
      unit: "%",
      exact: false,
      when: "always",
    },
    HOLLOW_FIELD,
    RADIUS_FIELD,
    ROTATION_FIELD,
  ],
  ...radialRow<CircleShape>(),
  handles(s) {
    const out = [
      handle(CENTRE_HANDLE, s.centre, "centre"),
      handle(RIM_HANDLE, ellipsePoint(s, 0), "size"),
      handle("height", ellipsePoint(s, 90), "size"),
    ];
    if (s.sweep < 360) out.push(handle("end", ellipsePoint(s, s.sweep), "size"));
    out.push(turnHandle(s, s.radius, s.radius));
    return out;
  },
  dragHandle(s, id, to, mods) {
    const radial = radialDragged(s, id, to, mods);
    if (radial) return radial;
    switch (id) {
      case "height": {
        const squash = (100 * distance(s.centre, to)) / s.radius;
        return { ...s, squash: clamp(squash, SQUASH_RANGE.min, SQUASH_RANGE.max) };
      }
      case "end": {
        const t = ellipseAngle(s, to);
        const held = mods.constrain ? Math.round(t / ANGLE_STEP) * ANGLE_STEP : t;
        return { ...s, sweep: clamp(held === 0 ? 360 : held, SWEEP_RANGE.min, SWEEP_RANGE.max) };
      }
      default:
        return s;
    }
  },
  contains: hollowContains((s: CircleShape, p: Pt) => {
    const local = toLocal(frameOf(s), p);
    if ((local.x / s.radius) ** 2 + (local.y / halfHeight(s)) ** 2 > 1) return false;
    return !isArc(s) || ellipseAngle(s, p) <= s.sweep;
  }),
  bounds(s) {
    if (isArc(s)) {
      const reached = ellipseExtremes(s).filter((t) => t <= s.sweep);
      return boxOf([s.centre, ...[0, s.sweep, ...reached].map((t) => ellipsePoint(s, t))]);
    }
    const a = s.radius;
    const b = halfHeight(s);
    const { x: c, y: sn } = dir(s.rotation);
    const hx = Math.hypot(a * c, b * sn);
    const hy = Math.hypot(a * sn, b * c);
    return { x0: s.centre.x - hx, y0: s.centre.y - hy, x1: s.centre.x + hx, y1: s.centre.y + hy };
  },
  area: (s) => (Math.PI * s.radius * halfHeight(s) * Math.min(s.sweep, 360) * filledShare(s)) / 360,
  outline(s, n) {
    const closed = !isArc(s);
    if (s.squash >= 100) {
      return oneRun(arcPoints(s.centre, s.radius, s.rotation, s.sweep, n), closed);
    }
    return oneRun(alongPolyline(denseEllipse(s, n), closed, n), closed);
  },
  edge(s, n, copies = 1) {
    if (!isArc(s)) return hollowEdge(s, n, copies, CIRCLE.outline);
    const arc = denseEllipse(s, n);
    const end = arc[arc.length - 1];
    if (s.hollow <= 0) {
      const pieces = [arc, [end, s.centre], [s.centre, arc[0]]];
      return oneRun(cornersThenPieces(pieces, true, n), true);
    }
    const hole = denseEllipse(holeOf(s), n).reverse();
    const pieces = [arc, [end, hole[0]], hole, [hole[hole.length - 1], arc[0]]];
    return oneRun(cornersThenPieces(pieces, true, n), true);
  },
  noun(s, fill) {
    const round = s.squash >= 100;
    if (fill.kind === "outline") {
      if (isArc(s)) return round ? "an arc" : "an oval arc";
      return round ? "a ring" : "an oval ring";
    }
    if (!isArc(s) && s.hollow > 0) return round ? "a donut" : "an oval donut";
    if (!isArc(s)) return round ? "a disc" : "an oval";
    const sector = SECTOR_NOUNS[Math.round(s.sweep)];
    if (!sector) return "a wedge";
    return round ? sector.round : sector.oval;
  },
};

// --- Polygon ---

function polygonCorners(s: PolygonShape): Pt[] {
  return Array.from({ length: s.sides }, (_, i) =>
    toWorld(
      { origin: s.centre, rotation: s.rotation + (i * 360) / s.sides },
      { x: s.radius, y: 0 },
    ),
  );
}

const POLYGON_NOUNS: Readonly<Record<number, string>> = {
  3: "a triangle",
  4: "a square",
  5: "a pentagon",
  6: "a hexagon",
  7: "a heptagon",
  8: "an octagon",
  9: "a nonagon",
  10: "a decagon",
  11: "an 11-sided polygon",
  12: "a dodecagon",
};

const POLYGON: ShapeSpec<PolygonShape> = {
  label: "Polygon",
  hint: "Lay systems in a shape with 3 to 12 equal sides.",
  glyph: "M8 2.5 13 5.25v5.5L8 13.5 3 10.75v-5.5Z",
  initial: { kind: "polygon", centre: ORIGIN, radius: 200, rotation: 90, sides: 6, hollow: 0 },
  fills: () => ALL_FILLS,
  extras: CLOSED_EXTRAS,
  spokes: "ring",
  edgeRow: true,
  connected: false,
  thinning: null,
  islands: false,
  fields: [
    {
      key: "sides",
      label: "Sides",
      hint: "Set how many sides the shape has.",
      range: { min: 3, max: 12 },
      step: 1,
      unit: "",
      exact: false,
      when: "always",
    },
    HOLLOW_FIELD,
    RADIUS_FIELD,
    ROTATION_FIELD,
  ],
  ...radialRow<PolygonShape>(),
  handles: (s) => [
    handle(CENTRE_HANDLE, s.centre, "centre"),
    handle(RIM_HANDLE, polygonCorners(s)[0], "size"),
    turnHandle(s, s.radius, s.radius),
  ],
  dragHandle: (s, id, to, mods) => radialDragged(s, id, to, mods) ?? s,
  contains: hollowContains((s: PolygonShape, p: Pt) => inRing(p, polygonCorners(s))),
  bounds: (s) => boxOf(polygonCorners(s)),
  area: (s) => (s.sides * s.radius ** 2 * Math.sin((2 * Math.PI) / s.sides) * filledShare(s)) / 2,
  outline: (s, n) => oneRun(cornersThenSides(polygonCorners(s), true, n), true),
  edge: (s, n, copies = 1) => hollowEdge(s, n, copies, POLYGON.outline),
  noun: (s, fill) => hollowed(POLYGON_NOUNS[s.sides] ?? `a ${s.sides}-sided polygon`, s, fill),
};

// --- Rectangle ---

/** Each corner's side of the centre, in the rectangle's own frame, anticlockwise from the first. */
const CORNER_SIGNS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/** Side i runs from corner i to corner i + 1: the axis it moves along, and which way it faces. */
const SIDES: ReadonlyArray<{ axis: "x" | "y"; sign: number }> = [
  { axis: "y", sign: 1 },
  { axis: "x", sign: -1 },
  { axis: "y", sign: -1 },
  { axis: "x", sign: 1 },
];

function rectCorners(s: RectShape): Pt[] {
  return CORNER_SIGNS.map(([sx, sy]) =>
    toWorld(frameOf(s), { x: (sx * s.width) / 2, y: (sy * s.height) / 2 }),
  );
}

/** The rectangle spanning from `from` to `to` along `rotation`, made square under Shift. */
function spanned(
  s: RectShape,
  from: Pt,
  to: Pt,
  mods: ShapeDragMods,
  signs: readonly [number, number],
): RectShape {
  const frame = { origin: from, rotation: s.rotation };
  let { x: dx, y: dy } = toLocal(frame, to);
  if (mods.constrain) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (Math.sign(dx) || signs[0]) * side;
    dy = (Math.sign(dy) || signs[1]) * side;
  }
  dx = clamp(dx, -SIZE_RANGE.max, SIZE_RANGE.max);
  dy = clamp(dy, -SIZE_RANGE.max, SIZE_RANGE.max);
  return {
    ...s,
    centre: toWorld(frame, { x: dx / 2, y: dy / 2 }),
    width: Math.max(LEAST_SIZE, Math.abs(dx)),
    height: Math.max(LEAST_SIZE, Math.abs(dy)),
  };
}

/** `s` with side `index` dragged to `to`, the opposite side held; Shift makes it square about its middle. */
function sideDragged(s: RectShape, index: number, to: Pt, mods: ShapeDragMods): RectShape {
  const { axis, sign } = SIDES[index];
  const local = toLocal(frameOf(s), to);
  const fixed = (-sign * (axis === "x" ? s.width : s.height)) / 2;
  const along = clamp(
    axis === "x" ? local.x : local.y,
    fixed - SIZE_RANGE.max,
    fixed + SIZE_RANGE.max,
  );
  const extent = Math.max(LEAST_SIZE, Math.abs(along - fixed));
  const mid = (along + fixed) / 2;
  const centre = toWorld(frameOf(s), axis === "x" ? { x: mid, y: 0 } : { x: 0, y: mid });
  if (axis === "x") {
    return { ...s, centre, width: extent, height: mods.constrain ? extent : s.height };
  }
  return { ...s, centre, height: extent, width: mods.constrain ? extent : s.width };
}

const RECT: ShapeSpec<RectShape> = {
  label: "Rectangle",
  hint: "Lay systems in a rectangle or a square.",
  glyph: "M2.5 4.5h11v7h-11Z",
  initial: { kind: "rect", centre: ORIGIN, width: 300, height: 200, rotation: 0 },
  fills: () => ALL_FILLS,
  extras: CLOSED_EXTRAS,
  spokes: null,
  edgeRow: true,
  connected: false,
  thinning: null,
  islands: false,
  fields: [
    {
      key: "width",
      label: "Width",
      hint: "Set the rectangle's width, in game units.",
      range: SIZE_RANGE,
      step: 1,
      unit: "",
      exact: true,
      when: "always",
    },
    {
      key: "height",
      label: "Height",
      hint: "Set the rectangle's height, in game units.",
      range: SIZE_RANGE,
      step: 1,
      unit: "",
      exact: true,
      when: "always",
    },
    ROTATION_FIELD,
  ],
  fromDrag: (anchor, to, mods, prev) => spanned(prev, anchor, to, mods, [1, 1]),
  handles(s) {
    const corners = rectCorners(s);
    return [
      handle(CENTRE_HANDLE, s.centre, "centre"),
      ...corners.map((at, i) => handle(`corner${i}`, at, "size")),
      ...corners.map((at, i) => handle(`side${i}`, lerp(at, corners[(i + 1) % 4], 0.5), "size")),
      turnHandle(s, s.width / 2, RECT.size(s)),
    ];
  },
  dragHandle(s, id, to, mods) {
    if (id === CENTRE_HANDLE) return { ...s, centre: to };
    if (id === TURN_HANDLE) return { ...s, rotation: heldAngle(s.centre, to, mods) };
    const corner = /^corner([0-3])$/.exec(id);
    if (corner) {
      const k = Number(corner[1]);
      return spanned(s, rectCorners(s)[(k + 2) % 4], to, mods, CORNER_SIGNS[k]);
    }
    const side = /^side([0-3])$/.exec(id);
    return side ? sideDragged(s, Number(side[1]), to, mods) : s;
  },
  size: (s) => Math.hypot(s.width, s.height) / 2,
  resized(s, size) {
    const now = RECT.size(s);
    if (now === 0) return { ...s, width: size * Math.SQRT2, height: size * Math.SQRT2 };
    const k = size / now;
    return { ...s, width: s.width * k, height: s.height * k };
  },
  moved: (s, by) => ({ ...s, centre: added(s.centre, by) }),
  contains(s, p) {
    const local = toLocal(frameOf(s), p);
    return Math.abs(local.x) <= s.width / 2 && Math.abs(local.y) <= s.height / 2;
  },
  bounds: (s) => boxOf(rectCorners(s)),
  area: (s) => s.width * s.height,
  outline: (s, n) => oneRun(cornersThenSides(rectCorners(s), true, n), true),
  edge: (s, n) => RECT.outline(s, n),
  noun: (s) => (s.width === s.height ? "a square" : "a rectangle"),
};

// --- Star ---

const INNER_RANGE = { min: 10, max: 90 };

/** The tips and notches in turn, the first tip at the rotation. */
function starCorners(s: StarShape): Pt[] {
  return Array.from({ length: 2 * s.points }, (_, i) => {
    const r = i % 2 === 0 ? s.radius : (s.radius * s.inner) / 100;
    const d = dir((i * 180) / s.points);
    return toWorld(frameOf(s), { x: r * d.x, y: r * d.y });
  });
}

const STAR: ShapeSpec<StarShape> = {
  label: "Star",
  hint: "Lay systems in a star with 4 to 12 points.",
  glyph: "M8 2.5 9.4 6.1 13.2 6.3 10.2 8.7 11.2 12.4 8 10.3 4.8 12.4 5.8 8.7 2.8 6.3 6.6 6.1Z",
  initial: {
    kind: "star",
    centre: ORIGIN,
    radius: 200,
    rotation: 90,
    points: 5,
    inner: 50,
    hollow: 0,
  },
  fills: () => ALL_FILLS,
  extras: CLOSED_EXTRAS,
  spokes: null,
  edgeRow: true,
  connected: false,
  thinning: null,
  islands: false,
  fields: [
    {
      key: "points",
      label: "Points",
      hint: "Set how many points the star has.",
      range: { min: 4, max: 12 },
      step: 1,
      unit: "",
      exact: false,
      when: "always",
    },
    {
      key: "inner",
      label: "Inner radius",
      hint: "Pull the dips between the points in for a sharper star, or out for a blunter one.",
      range: INNER_RANGE,
      step: 1,
      unit: "%",
      exact: false,
      when: "always",
    },
    HOLLOW_FIELD,
    RADIUS_FIELD,
    ROTATION_FIELD,
  ],
  ...radialRow<StarShape>(),
  handles(s) {
    const corners = starCorners(s);
    return [
      handle(CENTRE_HANDLE, s.centre, "centre"),
      handle(RIM_HANDLE, corners[0], "size"),
      handle("inner", corners[1], "size"),
      turnHandle(s, s.radius, s.radius),
    ];
  },
  dragHandle(s, id, to, mods) {
    const radial = radialDragged(s, id, to, mods);
    if (radial) return radial;
    if (id !== "inner") return s;
    const inner = (100 * distance(s.centre, to)) / s.radius;
    return { ...s, inner: clamp(inner, INNER_RANGE.min, INNER_RANGE.max) };
  },
  contains: hollowContains((s: StarShape, p: Pt) => inRing(p, starCorners(s))),
  bounds: (s) => boxOf(starCorners(s)),
  area: (s) =>
    s.points *
    s.radius *
    ((s.radius * s.inner) / 100) *
    Math.sin(Math.PI / s.points) *
    filledShare(s),
  outline: (s, n) => oneRun(cornersThenSides(starCorners(s), true, n), true),
  edge: (s, n, copies = 1) => hollowEdge(s, n, copies, STAR.outline),
  noun: (s, fill) => hollowed("a star", s, fill),
};

// --- Spiral ---

/** The square box round the disc `radius` about `centre`, which a spiral's arms and a galaxy stay inside. */
function discBounds(s: { centre: Pt; radius: number }): Rect {
  return {
    x0: s.centre.x - s.radius,
    y0: s.centre.y - s.radius,
    x1: s.centre.x + s.radius,
    y1: s.centre.y + s.radius,
  };
}

const ARMS_RANGE = { min: 1, max: 6 };
const TURNS_RANGE = { min: 0.25, max: 3 };
const SPIRAL_INNER_RANGE = { min: 5, max: 90 };
/** Every point of an arm is spread along at least this many chords. */
const ARM_CHORDS = 256;

/** The point `t` of the way along arm `arm`, from its inner end (0) to its outer end (1), its radius growing evenly with its angle. */
function spiralPoint(s: SpiralShape, arm: number, t: number): Pt {
  const from = s.inner / 100;
  const r = s.radius * (from + (1 - from) * t);
  const d = dir((arm * 360) / s.arms - s.turns * 360 * (1 - t));
  return toWorld(frameOf(s), { x: r * d.x, y: r * d.y });
}

/** Points close together along arm `arm` from its inner end to its outer end, enough to spread `n` along. */
function denseArm(s: SpiralShape, arm: number, n: number): Pt[] {
  const chords = Math.max(ARM_CHORDS, 4 * n);
  return Array.from({ length: chords + 1 }, (_, i) => spiralPoint(s, arm, i / chords));
}

/** How many of `n` points each of `arms` arms takes: an even share, the first arms taking one each of what is left over. */
function armCounts(arms: number, n: number): number[] {
  const each = Math.floor(n / arms);
  return Array.from({ length: arms }, (_, a) => each + (a < n % arms ? 1 : 0));
}

const SPIRAL: ShapeSpec<SpiralShape> = {
  label: "Swirl",
  hint: "Lay systems along arms that wind out from the centre.",
  glyph:
    "M8.7 6.09C9.33 5.85 10.38 6.28 10.62 7.28C10.86 8.29 10.09 9.68 8.71 9.92C7.34 10.16 5.6 9.05 5.36 7.3C5.12 5.55 6.57 3.47 8.7 3.23C10.82 2.99 13.23 4.78 13.48 7.28C13.72 9.77 11.59 12.53 8.72 12.77C5.85 13.02 2.75 10.55 2.5 7.3",
  initial: {
    kind: "spiral",
    centre: ORIGIN,
    radius: 250,
    rotation: 0,
    arms: 2,
    turns: 1,
    inner: 15,
  },
  fills: () => OUTLINE_ONLY,
  extras: OPEN_EXTRAS,
  spokes: "arms",
  edgeRow: true,
  connected: false,
  thinning: null,
  islands: false,
  fields: [
    {
      key: "arms",
      label: "Arms",
      hint: "Set how many arms the swirl has.",
      range: ARMS_RANGE,
      step: 1,
      unit: "",
      exact: false,
      when: "always",
    },
    {
      key: "turns",
      label: "Turns",
      hint: "Set how far round each arm winds.",
      range: TURNS_RANGE,
      step: 0.25,
      unit: "",
      exact: false,
      when: "always",
    },
    {
      key: "inner",
      label: "Inner radius",
      hint: "Start the arms further out to leave the middle of the swirl open.",
      range: SPIRAL_INNER_RANGE,
      step: 1,
      unit: "%",
      exact: false,
      when: "always",
    },
    {
      ...RADIUS_FIELD,
      label: "Outer radius",
      hint: "Set how far the arms reach from the centre, in game units.",
    },
    ROTATION_FIELD,
  ],
  ...radialRow<SpiralShape>(),
  handles: (s) => [
    handle(CENTRE_HANDLE, s.centre, "centre"),
    handle(RIM_HANDLE, spiralPoint(s, 0, 1), "size"),
    handle("inner", spiralPoint(s, 0, 0), "size"),
    turnHandle(s, s.radius, s.radius),
  ],
  dragHandle(s, id, to, mods) {
    const radial = radialDragged(s, id, to, mods);
    if (radial) return radial;
    if (id !== "inner") return s;
    const inner = (100 * distance(s.centre, to)) / s.radius;
    return { ...s, inner: clamp(inner, SPIRAL_INNER_RANGE.min, SPIRAL_INNER_RANGE.max) };
  },
  contains: () => false,
  bounds: discBounds,
  area: () => 0,
  outline: (s, n) =>
    joined(
      armCounts(s.arms, n).map((k, arm) =>
        oneRun(alongPolyline(denseArm(s, arm, k), false, k), false),
      ),
    ),
  edge: (s, n) => SPIRAL.outline(s, n),
  noun: () => "a swirl",
};

// --- Galaxy ---

const SCATTERED_ONLY: readonly FillKind[] = ["scattered"];

const GALAXY: ShapeSpec<GalaxyShape> = {
  label: "Galaxy",
  hint: "Lay systems out like one of the game's galaxy shapes, at any size.",
  glyph:
    "M6.75 8a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0-2.5 0M9.25 8C9.25 5 6 4 2.5 5.5M6.75 8C6.75 11 10 12 13.5 10.5",
  initial: { kind: "galaxy", centre: ORIGIN, radius: 300, rotation: 0, form: "spiral_2" },
  fills: () => SCATTERED_ONLY,
  extras: [],
  spokes: null,
  edgeRow: false,
  connected: true,
  islands: true,
  thinning: {
    at(s, p) {
      const local = toLocal(frameOf(s), p);
      return galaxyDensity(s.form, { x: local.x / s.radius, y: local.y / s.radius });
    },
    mean: (s) => keptShare(s.form),
  },
  fields: [RADIUS_FIELD, ROTATION_FIELD],
  ...radialRow<GalaxyShape>(),
  handles: (s) => [
    handle(CENTRE_HANDLE, s.centre, "centre"),
    handle(RIM_HANDLE, toWorld(frameOf(s), { x: s.radius, y: 0 }), "size"),
    turnHandle(s, s.radius, s.radius),
  ],
  dragHandle: (s, id, to, mods) => radialDragged(s, id, to, mods) ?? s,
  contains: (s, p) => distance(s.centre, p) <= s.radius,
  bounds: discBounds,
  area: (s) => Math.PI * s.radius ** 2,
  outline: (s, n) => oneRun(arcPoints(s.centre, s.radius, s.rotation, 360, n), true),
  edge: (s, n) => GALAXY.outline(s, n),
  noun: () => "a galaxy",
};

/** Every kind of shape, and all that differs between them. */
export const SHAPE_SPECS: ShapeSpecs = {
  line: LINE,
  circle: CIRCLE,
  polygon: POLYGON,
  rect: RECT,
  star: STAR,
  spiral: SPIRAL,
  galaxy: GALAXY,
};

/** Every shape kind, in the picker's order. */
export const SHAPE_KINDS = Object.keys(SHAPE_SPECS) as ShapeKind[];

/** The row for `shape`'s kind, typed so that it takes `shape` itself. */
export function specOf<S extends Shape>(shape: S): ShapeSpec<S> {
  return SHAPE_SPECS[shape.kind] as unknown as ShapeSpec<S>;
}

/** The row for `kind`. */
export function specFor<K extends ShapeKind>(kind: K): ShapeSpec<ShapeOf<K>> {
  return SHAPE_SPECS[kind];
}

/** Where `shape` is centred: a line's midpoint, or the centre the other kinds hold. */
export function centreOf(shape: Shape): Pt {
  return shape.kind === "line" ? lerp(shape.a, shape.b, 0.5) : shape.centre;
}

/** `s` with each of its kind's fields held to its range, and its rotation to a whole degree in [0, 360); `s` itself when all are. */
export function heldShape<S extends Shape>(s: S): S {
  const values = s as unknown as Record<string, number>;
  let held: Record<string, number> | null = null;
  for (const { key, range } of specOf(s).fields) {
    const k = key as string;
    const v = values[k];
    const want = k === ROTATION_FIELD.key ? wholeDegrees(v) : clamp(v, range.min, range.max);
    if (want !== v) (held ??= { ...values })[k] = want;
  }
  return (held ?? s) as unknown as S;
}

/** Which fills each kind of field shows with: any, or one that fills the shape. */
const FIELD_FILLS: Record<FieldWhen, (fill: Fill) => boolean> = {
  always: () => true,
  filled: (fill) => fill.kind !== "outline",
};

/** Whether `field` shows in the options with `fill`. */
export function fieldShows(field: ShapeField<Shape>, fill: Fill): boolean {
  return FIELD_FILLS[field.when](fill);
}

/**
 * `shape` as `fill` lays it: each field the fill doesn't show at its kind's initial value, so a
 * hollow centre set for a fill leaves an outline's inside whole; `shape` itself when none
 * differs.
 */
export function laidShape<S extends Shape>(shape: S, fill: Fill): S {
  const spec = specOf(shape);
  const values = shape as unknown as Record<string, number>;
  const initial = spec.initial as unknown as Record<string, number>;
  let laid: Record<string, number> | null = null;
  for (const field of spec.fields as unknown as readonly ShapeField<Shape>[]) {
    const key = field.key as string;
    if (!fieldShows(field, fill) && values[key] !== initial[key]) {
      (laid ??= { ...values })[key] = initial[key];
    }
  }
  return (laid ?? shape) as unknown as S;
}
