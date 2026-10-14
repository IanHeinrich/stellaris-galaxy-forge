import { boxOf, inRing } from "../geometry/polygon";
import type { Pt } from "../geometry/pt";
import { ANGLE_STEP, draggedRotation, snapAngle } from "./drag";
import { clamp } from "../geometry/geometry";
import { angleOf, dir, distance, lerp, norm360, toLocal, toWorld, type ShapeFrame } from "./frame";
import { alongPolyline, arcPoints, cornersThenPieces, cornersThenSides } from "./outline";
import type {
  CircleShape,
  FillKind,
  LineShape,
  PolygonShape,
  RectShape,
  Shape,
  ShapeDragMods,
  ShapeHandle,
  ShapeKind,
  ShapeOf,
  ShapeSpec,
  ShapeSpecs,
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
  range: SIZE_RANGE,
  step: 1,
  unit: "",
  exact: true,
} as const;
const ROTATION_FIELD = {
  key: "rotation",
  label: "Rotation",
  range: ROTATION_RANGE,
  step: 1,
  unit: "°",
  exact: true,
} as const;

/** What the circle, polygon and star share: a centre, a radius and a rotation. */
type Radial = CircleShape | PolygonShape | StarShape;

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
  glyph: "M2.5 13.5 13.5 2.5",
  initial: { kind: "line", a: { x: -200, y: 0 }, b: { x: 200, y: 0 } },
  fills: () => OUTLINE_ONLY,
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
  outline: (s, n) => ({ points: alongPolyline([s.a, s.b], false, n), closed: false }),
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
  glyph: "M2.5 8a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0Z",
  initial: { kind: "circle", centre: ORIGIN, radius: 200, rotation: 0, sweep: 360, squash: 100 },
  fills: () => ALL_FILLS,
  fields: [
    { key: "sweep", label: "Arc", range: SWEEP_RANGE, step: 1, unit: "°", exact: false },
    { key: "squash", label: "Roundness", range: SQUASH_RANGE, step: 1, unit: "%", exact: false },
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
  contains(s, p) {
    const local = toLocal(frameOf(s), p);
    if ((local.x / s.radius) ** 2 + (local.y / halfHeight(s)) ** 2 > 1) return false;
    return !isArc(s) || ellipseAngle(s, p) <= s.sweep;
  },
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
  area: (s) => (Math.PI * s.radius * halfHeight(s) * Math.min(s.sweep, 360)) / 360,
  outline(s, n) {
    const closed = !isArc(s);
    if (s.squash >= 100) {
      return { points: arcPoints(s.centre, s.radius, s.rotation, s.sweep, n), closed };
    }
    return { points: alongPolyline(denseEllipse(s, n), closed, n), closed };
  },
  edge(s, n) {
    if (!isArc(s)) return CIRCLE.outline(s, n);
    const arc = denseEllipse(s, n);
    const pieces = [arc, [arc[arc.length - 1], s.centre], [s.centre, arc[0]]];
    return { points: cornersThenPieces(pieces, true, n), closed: true };
  },
  noun(s, fill) {
    const round = s.squash >= 100;
    if (fill.kind === "outline") {
      if (isArc(s)) return round ? "an arc" : "an oval arc";
      return round ? "a ring" : "an oval ring";
    }
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
  glyph: "M8 2.5 13 5.25v5.5L8 13.5 3 10.75v-5.5Z",
  initial: { kind: "polygon", centre: ORIGIN, radius: 200, rotation: 90, sides: 6 },
  fills: () => ALL_FILLS,
  fields: [
    { key: "sides", label: "Sides", range: { min: 3, max: 12 }, step: 1, unit: "", exact: false },
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
  contains: (s, p) => inRing(p, polygonCorners(s)),
  bounds: (s) => boxOf(polygonCorners(s)),
  area: (s) => (s.sides * s.radius ** 2 * Math.sin((2 * Math.PI) / s.sides)) / 2,
  outline: (s, n) => ({ points: cornersThenSides(polygonCorners(s), true, n), closed: true }),
  edge: (s, n) => POLYGON.outline(s, n),
  noun: (s) => POLYGON_NOUNS[s.sides] ?? `a ${s.sides}-sided polygon`,
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
  glyph: "M2.5 4.5h11v7h-11Z",
  initial: { kind: "rect", centre: ORIGIN, width: 300, height: 200, rotation: 0 },
  fills: () => ALL_FILLS,
  fields: [
    { key: "width", label: "Width", range: SIZE_RANGE, step: 1, unit: "", exact: true },
    { key: "height", label: "Height", range: SIZE_RANGE, step: 1, unit: "", exact: true },
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
  outline: (s, n) => ({ points: cornersThenSides(rectCorners(s), true, n), closed: true }),
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
  glyph: "M8 2.5 9.4 6.1 13.2 6.3 10.2 8.7 11.2 12.4 8 10.3 4.8 12.4 5.8 8.7 2.8 6.3 6.6 6.1Z",
  initial: { kind: "star", centre: ORIGIN, radius: 200, rotation: 90, points: 5, inner: 50 },
  fills: () => ALL_FILLS,
  fields: [
    { key: "points", label: "Points", range: { min: 4, max: 12 }, step: 1, unit: "", exact: false },
    { key: "inner", label: "Inner radius", range: INNER_RANGE, step: 1, unit: "%", exact: false },
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
  contains: (s, p) => inRing(p, starCorners(s)),
  bounds: (s) => boxOf(starCorners(s)),
  area: (s) => s.points * s.radius * ((s.radius * s.inner) / 100) * Math.sin(Math.PI / s.points),
  outline: (s, n) => ({ points: cornersThenSides(starCorners(s), true, n), closed: true }),
  edge: (s, n) => STAR.outline(s, n),
  noun: () => "a star",
};

/** Every kind of shape, and all that differs between them. */
export const SHAPE_SPECS: ShapeSpecs = {
  line: LINE,
  circle: CIRCLE,
  polygon: POLYGON,
  rect: RECT,
  star: STAR,
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
