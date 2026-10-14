import { describe, expect, it } from "vitest";
import type { Pt } from "../geometry/pt";
import { ANGLE_STEP, galaxyFrame, snapAngle } from "./drag";
import { dir, distance } from "./frame";
import { centreOf, heldShape, SHAPE_SPECS, specOf } from "./specs";
import type { Shape, ShapeDragMods, StarShape } from "./types";

const FREE: ShapeDragMods = { snap: true, constrain: false };
const SHIFT: ShapeDragMods = { snap: true, constrain: true };

const ALL: Shape[] = [
  ...Object.values(SHAPE_SPECS).map((spec) => spec.initial),
  { kind: "circle", centre: { x: 40, y: -30 }, radius: 120, rotation: 30, sweep: 200, squash: 60 },
  { kind: "rect", centre: { x: -50, y: 20 }, width: 180, height: 90, rotation: 25 },
];

/** Every number in `s`, rounded so float noise compares equal. */
function rounded(s: Shape): unknown {
  return JSON.parse(JSON.stringify(s), (_, v) =>
    typeof v === "number" ? Math.round(v * 1e6) / 1e6 + 0 : v,
  );
}

function gaps(points: readonly Pt[], closed: boolean): number[] {
  const n = closed ? points.length : points.length - 1;
  return Array.from({ length: n }, (_, i) => distance(points[i], points[(i + 1) % points.length]));
}

describe("each kind's outline", () => {
  it("spaces a circle's n points with n equal chords, and puts an arc's at both its ends", () => {
    const ring = specOf(SHAPE_SPECS.circle.initial).outline(SHAPE_SPECS.circle.initial, 24);
    expect(ring.closed).toBe(true);
    expect(ring.points).toHaveLength(24);
    for (const d of gaps(ring.points, true)) expect(d).toBeCloseTo(gaps(ring.points, true)[0]);

    const arc = { ...SHAPE_SPECS.circle.initial, rotation: 90, sweep: 180 };
    const { points, closed } = SHAPE_SPECS.circle.outline(arc, 7);
    expect(closed).toBe(false);
    expect(points[0].x).toBeCloseTo(0);
    expect(points[0].y).toBeCloseTo(200);
    expect(points[6].y).toBeCloseTo(-200);
  });

  it("spreads an ellipse's points evenly along it, not by angle", () => {
    const oval = { ...SHAPE_SPECS.circle.initial, squash: 40 };
    const d = gaps(SHAPE_SPECS.circle.outline(oval, 30).points, true);
    expect(Math.max(...d) / Math.min(...d)).toBeLessThan(1.05);
  });

  it("puts a line's points from one end to the other", () => {
    const line = SHAPE_SPECS.line.initial;
    const { points, closed } = SHAPE_SPECS.line.outline(line, 5);
    expect(closed).toBe(false);
    expect(points).toEqual([-200, -100, 0, 100, 200].map((x) => ({ x, y: 0 })));
  });

  it("keeps every corner of a polygon, a rectangle and a star, and a star alternates its radii", () => {
    const hexagon = SHAPE_SPECS.polygon.initial;
    const corners = SHAPE_SPECS.polygon.outline(hexagon, 6).points;
    const points = SHAPE_SPECS.polygon.outline(hexagon, 20).points;
    for (const c of corners) expect(points.some((p) => distance(p, c) < 1e-9)).toBe(true);
    expect(points).toHaveLength(20);

    const rect = { ...SHAPE_SPECS.rect.initial, width: 400, height: 100 };
    const along = SHAPE_SPECS.rect.outline(rect, 10).points;
    for (const c of SHAPE_SPECS.rect.outline(rect, 4).points) {
      expect(along.some((p) => distance(p, c) < 1e-9)).toBe(true);
    }
    // The long sides take the extra points, so the steps stay close to even.
    expect(Math.max(...gaps(along, true))).toBeLessThanOrEqual(100 + 1e-9);

    const star: StarShape = { ...SHAPE_SPECS.star.initial, points: 5, inner: 40 };
    const tips = SHAPE_SPECS.star.outline(star, 10).points;
    tips.forEach((p, i) => expect(distance(p, star.centre)).toBeCloseTo(i % 2 ? 80 : 200));
  });
});

describe("drawing and handles", () => {
  it("draws each kind from its anchor to the point that sets its size", () => {
    const anchor = { x: 10, y: 10 };
    const to = { x: 70, y: 90 };
    const sized = (s: Shape) => specOf(s).size(s);
    expect(sized(SHAPE_SPECS.circle.fromDrag(anchor, to, FREE, SHAPE_SPECS.circle.initial))).toBe(
      100,
    );
    expect(sized(SHAPE_SPECS.line.fromDrag(anchor, to, FREE, SHAPE_SPECS.line.initial))).toBe(50);
    const rect = SHAPE_SPECS.rect.fromDrag(anchor, to, FREE, SHAPE_SPECS.rect.initial);
    expect(rounded(rect)).toEqual(
      rounded({ ...rect, centre: { x: 40, y: 50 }, width: 60, height: 80 }),
    );
    const square = SHAPE_SPECS.rect.fromDrag(anchor, to, SHIFT, SHAPE_SPECS.rect.initial);
    expect([square.width, square.height]).toEqual([80, 80]);
    const hexagon = SHAPE_SPECS.polygon.fromDrag(anchor, to, FREE, SHAPE_SPECS.polygon.initial);
    expect(hexagon.sides).toBe(6);
  });

  it("holds drawn and turned angles to 15° steps under Shift", () => {
    const anchor = { x: 0, y: 0 };
    const to = { x: 100, y: 37 };
    const drawn = SHAPE_SPECS.polygon.fromDrag(anchor, to, SHIFT, SHAPE_SPECS.polygon.initial);
    expect(drawn.rotation % ANGLE_STEP).toBeCloseTo(0);
    expect(drawn.rotation).toBeCloseTo(15);
    const turned = SHAPE_SPECS.star.dragHandle(
      SHAPE_SPECS.star.initial,
      "turn",
      { x: -3, y: 50 },
      SHIFT,
    );
    expect(turned.rotation).toBeCloseTo(90);
    const line = SHAPE_SPECS.line.fromDrag(anchor, to, SHIFT, SHAPE_SPECS.line.initial);
    expect(distance(line.a, line.b)).toBeCloseTo(distance(anchor, to));
    expect(snapAngle(anchor, { x: 0, y: -10 })).toEqual({ x: expect.closeTo(0), y: -10 });
  });

  it("catches a turn within a few degrees of a multiple of 45° on it, unless snapping is off", () => {
    const star = SHAPE_SPECS.star.initial;
    const at = (degrees: number) => ({ x: 100 * dir(degrees).x, y: 100 * dir(degrees).y });
    const turn = (degrees: number, mods: ShapeDragMods) =>
      SHAPE_SPECS.star.dragHandle(star, "turn", at(degrees), mods).rotation;
    expect(turn(43, FREE)).toBe(45);
    expect(turn(30, FREE)).toBe(30);
    expect(turn(43, { snap: false, constrain: false })).toBe(43);
    expect(turn(43, SHIFT) % ANGLE_STEP).toBe(0);
    expect(turn(43, SHIFT)).toBe(45);
    expect(turn(37, SHIFT)).toBe(30);
    const drawn = SHAPE_SPECS.circle.fromDrag(
      { x: 0, y: 0 },
      at(92),
      FREE,
      SHAPE_SPECS.circle.initial,
    );
    expect(drawn.rotation).toBe(90);
  });

  it("leaves a shape as it is when any handle is dragged to where it already is", () => {
    for (const shape of ALL) {
      const spec = specOf(shape);
      const handles = spec.handles(shape);
      expect(new Set(handles.map((h) => h.id)).size).toBe(handles.length);
      for (const h of handles) {
        expect(rounded(spec.dragHandle(shape, h.id, h.at, FREE)), `${shape.kind} ${h.id}`).toEqual(
          rounded(shape),
        );
      }
    }
  });

  it("resizes with the rim handle, keeping the outline's count, and moves with the centre", () => {
    const circle = SHAPE_SPECS.circle.initial;
    const bigger = SHAPE_SPECS.circle.dragHandle(circle, "rim", { x: 0, y: 300 }, FREE);
    expect(bigger.radius).toBe(300);
    expect(SHAPE_SPECS.circle.outline(bigger, 24).points).toHaveLength(24);
    const moved = SHAPE_SPECS.circle.dragHandle(circle, "centre", { x: 50, y: 60 }, FREE);
    expect(moved).toEqual({ ...circle, centre: { x: 50, y: 60 } });
    const corner = SHAPE_SPECS.rect.dragHandle(
      SHAPE_SPECS.rect.initial,
      "corner2",
      { x: -250, y: -100 },
      FREE,
    );
    expect([corner.width, corner.height]).toEqual([400, 200]);
  });

  it("scales each kind about its centre to a size, and moves it by an offset", () => {
    for (const shape of ALL) {
      const spec = specOf(shape);
      const twice = spec.resized(shape, 2 * spec.size(shape));
      expect(spec.size(twice)).toBeCloseTo(2 * spec.size(shape));
      expect(centreOf(twice)).toEqual(centreOf(shape));
      const moved = spec.moved(shape, { x: 5, y: -7 });
      expect(centreOf(moved).x).toBeCloseTo(centreOf(shape).x + 5);
      expect(centreOf(moved).y).toBeCloseTo(centreOf(shape).y - 7);
    }
  });

  it("holds its centre inside it and its edge inside its box, and takes every fill, except a line", () => {
    for (const shape of ALL) {
      const spec = specOf(shape);
      const box = spec.bounds(shape);
      const line = shape.kind === "line";
      expect(spec.contains(shape, centreOf(shape))).toBe(!line);
      for (const p of [...spec.outline(shape, 40).points, ...spec.edge(shape, 40).points]) {
        expect(p.x).toBeGreaterThanOrEqual(box.x0 - 1e-9);
        expect(p.x).toBeLessThanOrEqual(box.x1 + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(box.y0 - 1e-9);
        expect(p.y).toBeLessThanOrEqual(box.y1 + 1e-9);
      }
      expect(spec.fills(shape)).toEqual(line ? ["outline"] : ["outline", "scattered", "grid"]);
    }
  });

  it("fills an arc's sector, its box reaching the ellipse's furthest point within the sweep", () => {
    const quarter = { ...SHAPE_SPECS.circle.initial, radius: 100, sweep: 90 };
    expect(SHAPE_SPECS.circle.contains(quarter, { x: 30, y: 30 })).toBe(true);
    expect(SHAPE_SPECS.circle.contains(quarter, { x: -30, y: 30 })).toBe(false);
    expect(SHAPE_SPECS.circle.contains(quarter, { x: 80, y: 80 })).toBe(false);
    const { x0, y0, x1, y1 } = SHAPE_SPECS.circle.bounds(quarter);
    expect([x0, y0, x1, y1].map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual([0, 0, 100, 100]);
    expect(SHAPE_SPECS.circle.area(quarter)).toBeCloseTo((Math.PI * 100 * 100) / 4);
    const turned = { ...quarter, rotation: 45, squash: 50 };
    const box = SHAPE_SPECS.circle.bounds(turned);
    const along = SHAPE_SPECS.circle.outline(turned, 400).points;
    expect(Math.max(...along.map((p) => p.x))).toBeCloseTo(box.x1, 3);
    expect(Math.max(...along.map((p) => p.y))).toBeCloseTo(box.y1, 3);
  });
});

describe("held to the fields' ranges", () => {
  /** Whether every field of `s` is inside its range. */
  function inRange(s: Shape): boolean {
    const values = s as unknown as Record<string, number>;
    return specOf(s).fields.every(
      ({ key, range }) => values[key] >= range.min && values[key] <= range.max,
    );
  }

  it("holds a drawn or turned angle just short of a full turn, and a size past the most", () => {
    const anchor = { x: 0, y: 0 };
    const nearlyRound = { x: 100 * dir(359.7).x, y: 100 * dir(359.7).y };
    const drawn = SHAPE_SPECS.polygon.fromDrag(
      anchor,
      nearlyRound,
      FREE,
      SHAPE_SPECS.polygon.initial,
    );
    expect(drawn.rotation).toBe(0);
    const turned = SHAPE_SPECS.star.dragHandle(SHAPE_SPECS.star.initial, "turn", nearlyRound, FREE);
    expect(turned.rotation).toBe(0);

    const wide = SHAPE_SPECS.rect.fromDrag(
      anchor,
      { x: 1020, y: 50 },
      FREE,
      SHAPE_SPECS.rect.initial,
    );
    expect([wide.width, wide.height]).toEqual([1000, 50]);
    expect(wide.centre).toEqual({ x: 500, y: 25 });
    const side = SHAPE_SPECS.rect.dragHandle(
      SHAPE_SPECS.rect.initial,
      "side3",
      { x: 1100, y: 0 },
      FREE,
    );
    expect(inRange(side)).toBe(true);
    const rim = SHAPE_SPECS.circle.dragHandle(
      SHAPE_SPECS.circle.initial,
      "rim",
      { x: 0, y: 1500 },
      FREE,
    );
    expect(rim.radius).toBe(1000);
    for (const shape of ALL) {
      const spec = specOf(shape);
      for (const h of spec.handles(shape)) {
        const far = { x: h.at.x * 9 + 0.3, y: h.at.y * 9 - 0.2 };
        expect(inRange(spec.dragHandle(shape, h.id, far, FREE)), `${shape.kind} ${h.id}`).toBe(
          true,
        );
      }
      expect(inRange(spec.fromDrag(anchor, { x: -2000, y: -1 }, FREE, shape))).toBe(true);
    }
  });

  it("holds a remembered shape to its fields' ranges, its rotation to a whole degree", () => {
    const circle = { ...SHAPE_SPECS.circle.initial, radius: 5000, rotation: -30.4, squash: 0 };
    expect(heldShape(circle)).toEqual({ ...circle, radius: 1000, rotation: 330, squash: 10 });
    const polygon = SHAPE_SPECS.polygon.initial;
    expect(heldShape(polygon)).toBe(polygon);
  });
});

describe("galaxyFrame", () => {
  it("measures a scenario against the circle inside its square", () => {
    expect(galaxyFrame({ shape: "square", half: 500 })).toEqual({
      centre: { x: 0, y: 0 },
      radius: 500,
    });
    expect(galaxyFrame({ shape: "circle", radius: 700 }).radius).toBe(700);
  });
});
