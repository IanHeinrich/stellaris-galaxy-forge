import { describe, expect, it } from "vitest";
import type { Pt } from "../geometry/pt";
import { placeLabel, placeLead, shapeReadout, shapeStatus } from "./shapeCopy";
import { NO_EXTRAS } from "./extras";
import { SHAPE_SPECS } from "./specs";
import type { PendingShape, Shape, ShapePreview } from "./types";

const FRAME = { centre: { x: 0, y: 0 }, radius: 500 };

function pending(
  shape: Shape,
  fill: PendingShape["fill"] = { kind: "outline", count: 24 },
): PendingShape {
  return {
    purpose: { kind: "add" },
    shape,
    fill,
    lanes: { follow: true, mode: "off", islands: false },
    extras: NO_EXTRAS,
    skipNear: true,
    seed: 1,
    stars: { kind: "random" },
  };
}

function preview(over: Partial<ShapePreview> = {}): ShapePreview {
  const points: Pt[] = Array.from({ length: 22 }, (_, i) => ({ x: i, y: 0 }));
  return {
    points,
    pairs: Array.from({ length: 22 }, (_, i) => [-(i + 1), -(((i + 1) % 22) + 1)]),
    left: [],
    outside: [],
    overlaps: 0,
    crowded: 0,
    capped: false,
    interleaved: null,
    classes: null,
    arranged: null,
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
    expect(shapeStatus(ring, preview(), "statements")).toEqual({
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
      crowded: 5,
      capped: true,
      interleaved: 4,
    });
    expect(shapeStatus(ring, crowded, "statements").warnings).toEqual([
      "2 left out, too close to existing systems",
      "3 past the edge",
      "5 left out, too close to each other",
      "1 system overlap others on the map",
      "Stopped at 1,000 systems, the most one shape adds",
      "Symmetry's 4 copies fall between the points: use a count that divides by 4",
    ]);
    expect(shapeStatus(ring, preview({ capped: true }), "rolled").warnings).toEqual([
      "Stopped at 200 systems, the most one shape adds to a save",
    ]);
  });

  it("names what was placed and what the button places", () => {
    expect(placeLead(pending(SHAPE_SPECS.circle.initial))).toBe("Placed a ring of");
    expect(
      placeLead(
        pending(SHAPE_SPECS.circle.initial, { kind: "scattered", spacing: 20, edge: true }),
      ),
    ).toBe("Placed a disc of");
    expect(placeLead(pending(SHAPE_SPECS.polygon.initial))).toBe("Placed a hexagon of");
    const arc = (sweep: number, squash = 100) => ({ ...SHAPE_SPECS.circle.initial, sweep, squash });
    const scattered = { kind: "scattered", spacing: 20, edge: true } as const;
    expect(placeLead(pending(arc(90)))).toBe("Placed an arc of");
    expect(placeLead(pending(arc(90, 50)))).toBe("Placed an oval arc of");
    expect(placeLead(pending(arc(180), scattered))).toBe("Placed a half disc of");
    expect(placeLead(pending(arc(90), scattered))).toBe("Placed a quarter disc of");
    expect(placeLead(pending(arc(180, 50), scattered))).toBe("Placed a half oval of");
    expect(placeLead(pending(arc(120), scattered))).toBe("Placed a wedge of");
    expect(placeLabel(preview())).toBe("Place 22 systems");
    expect(placeLabel(preview({ points: [{ x: 0, y: 0 }] }))).toBe("Place 1 system");
  });
});
