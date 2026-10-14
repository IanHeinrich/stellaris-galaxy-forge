import type { Shape, ShapeKind, ShapeOf, ShapeSpec, ShapeSpecs } from "./types";

// stub: W1 fills this
function notYet(): never {
  throw new Error("not implemented");
}

/** A row whose geometry is still to come, around the parts the store needs to start. */
function stubRow<S extends Shape>(glyph: string, initial: S): ShapeSpec<S> {
  return {
    glyph,
    initial,
    fills: notYet,
    fields: [],
    fromDrag: notYet,
    handles: notYet,
    dragHandle: notYet,
    size: notYet,
    resized: notYet,
    moved: notYet,
    contains: notYet,
    bounds: notYet,
    outline: notYet,
    noun: notYet,
  };
}

const ORIGIN = { x: 0, y: 0 };

/** Every kind of shape, and all that differs between them. */
export const SHAPE_SPECS: ShapeSpecs = {
  line: stubRow("M2.5 13.5 13.5 2.5", { kind: "line", a: { x: -200, y: 0 }, b: { x: 200, y: 0 } }),
  circle: stubRow("M2.5 8a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0Z", {
    kind: "circle",
    centre: ORIGIN,
    radius: 200,
    rotation: 0,
    sweep: 360,
    squash: 100,
  }),
  polygon: stubRow("M8 2.5 13 5.25v5.5L8 13.5 3 10.75v-5.5Z", {
    kind: "polygon",
    centre: ORIGIN,
    radius: 200,
    rotation: 90,
    sides: 6,
  }),
  rect: stubRow("M2.5 4.5h11v7h-11Z", {
    kind: "rect",
    centre: ORIGIN,
    width: 300,
    height: 200,
    rotation: 0,
  }),
  star: stubRow(
    "M8 2.5 9.4 6.1 13.2 6.3 10.2 8.7 11.2 12.4 8 10.3 4.8 12.4 5.8 8.7 2.8 6.3 6.6 6.1Z",
    {
      kind: "star",
      centre: ORIGIN,
      radius: 200,
      rotation: 90,
      points: 5,
      inner: 50,
    },
  ),
};

/** The row for `shape`'s kind, typed so that it takes `shape` itself. */
export function specOf<S extends Shape>(shape: S): ShapeSpec<S> {
  return SHAPE_SPECS[shape.kind] as unknown as ShapeSpec<S>;
}

/** The row for `kind`. */
export function specFor<K extends ShapeKind>(kind: K): ShapeSpec<ShapeOf<K>> {
  return SHAPE_SPECS[kind];
}
