import { describe, expect, it } from "vitest";
import type { Pt } from "../geometry/pt";
import { placeLabel, placeLead, shapeReadout, shapeStatus } from "./shapeCopy";
import { SHAPE_SPECS } from "./specs";
import type { PendingShape, Shape, ShapePreview } from "./types";

const FRAME = { centre: { x: 0, y: 0 }, radius: 500 };

function pending(
  shape: Shape,
  fill: PendingShape["fill"] = { kind: "outline", count: 24 },
): PendingShape {
  return { shape, fill, lanes: { follow: true, mode: "off" }, skipNear: true, seed: 1 };
}

function preview(over: Partial<ShapePreview> = {}): ShapePreview {
  const points: Pt[] = Array.from({ length: 22 }, (_, i) => ({ x: i, y: 0 }));
  return {
    points,
    pairs: Array.from({ length: 22 }, (_, i) => [-(i + 1), -(((i + 1) % 22) + 1)]),
    left: [],
    outside: [],
    overlaps: 0,
    capped: false,
    interleaved: null,
    ...over,
  };
}

describe("the shape's words", () => {
  it("reads a shape's size against the galaxy, and a line's as how far across it reaches", () => {
    const ring = pending(SHAPE_SPECS.circle.initial);
    expect(shapeReadout(ring, preview(), FRAME)).toBe("40% of the galaxy · 22 systems");
    const line = (half: number) =>
      pending({ kind: "line", a: { x: -half, y: 0 }, b: { x: half, y: 0 } });
    expect(shapeReadout(line(500 / 3), preview(), FRAME)).toBe(
      "a third of the way across · 22 systems",
    );
    expect(shapeReadout(line(250), preview(), FRAME)).toBe("halfway across · 22 systems");
    expect(shapeReadout(line(200), preview(), FRAME)).toBe("40% of the way across · 22 systems");
  });

  it("sums up the shape, then says what it leaves out", () => {
    const ring = pending(SHAPE_SPECS.circle.initial);
    expect(shapeStatus(ring, preview())).toEqual({
      summary: "Circle · 22 systems, 22 lanes",
      warnings: [],
    });
    const at = { x: 0, y: 0 };
    const crowded = preview({
      left: [
        { at, blocker: 1 },
        { at, blocker: 2 },
      ],
      outside: [at, at, at],
      overlaps: 1,
      capped: true,
      interleaved: 4,
    });
    expect(shapeStatus(ring, crowded).warnings).toEqual([
      "2 left out, too close to existing systems",
      "3 past the edge",
      "1 system overlap others on the map",
      "Stopped at 1,000 systems, the most one shape adds",
      "Symmetry's 4 copies fall between the points: use a count that divides by 4",
    ]);
  });

  it("names what was placed and what the button places", () => {
    expect(placeLead(pending(SHAPE_SPECS.circle.initial))).toBe("Placed a ring of");
    expect(placeLead(pending(SHAPE_SPECS.circle.initial, { kind: "scattered", spacing: 20 }))).toBe(
      "Placed a disc of",
    );
    expect(placeLead(pending(SHAPE_SPECS.polygon.initial))).toBe("Placed a hexagon of");
    expect(placeLead(pending({ ...SHAPE_SPECS.circle.initial, sweep: 90 }))).toBe(
      "Placed an arc of",
    );
    expect(placeLabel(preview())).toBe("Place 22 systems");
    expect(placeLabel(preview({ points: [{ x: 0, y: 0 }] }))).toBe("Place 1 system");
  });
});
