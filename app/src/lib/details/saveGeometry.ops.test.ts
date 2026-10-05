import { describe, expect, it } from "vitest";
import { ORBIT_SYSTEM_AT, orbitSystem, saveBody } from "../../test/builders";
import {
  ASTEROID,
  drawnOff,
  frameOf,
  LONE,
  MOON,
  move,
  op,
  PLANET,
  reparent,
  STAR,
  SYSTEM,
} from "./fixture";
import { bodyOrbit, GEOMETRY_REASONS, innerTooSmall, type GeometryIntent } from "./orbitIntent";

describe("the op each intent makes", () => {
  it("moves a body, its angle turned into [0, 360)", () => {
    expect(op(move(LONE, 110, -30))).toEqual({
      op: { type: "MoveBody", system: SYSTEM, body: LONE, radius: 110, angle: 330 },
    });
  });

  it("makes a planet a moon, and a moon a planet", () => {
    expect(op(reparent(LONE, PLANET, 25, 0))).toEqual({
      op: {
        type: "SetBodyParent",
        system: SYSTEM,
        body: LONE,
        parent: { Body: PLANET },
        radius: 25,
        angle: 0,
      },
    });
    expect(op(reparent(MOON, null, 140, 10))).toEqual({
      op: {
        type: "SetBodyParent",
        system: SYSTEM,
        body: MOON,
        parent: "Centre",
        radius: 140,
        angle: 10,
      },
    });
  });

  it("moves a body given the parent it has", () => {
    expect(op(reparent(MOON, PLANET, 18, 90))).toEqual(op(move(MOON, 18, 90)));
  });

  it("takes the star at the centre for the centre", () => {
    expect(op(reparent(LONE, STAR, 110, 90))).toEqual(op(move(LONE, 110, 90)));
    expect(op(reparent(MOON, STAR, 140, 10))).toMatchObject({
      op: { type: "SetBodyParent", body: MOON, parent: "Centre" },
    });
  });

  it("adds, retypes and removes a belt, and sets the inner radius", () => {
    const addBelt = { kind: "addBelt", system: SYSTEM, beltKind: "icy_asteroid_belt", radius: 90 };
    expect(op(addBelt as GeometryIntent)).toEqual({
      op: { type: "AddBelt", system: SYSTEM, kind: "icy_asteroid_belt", radius: 90 },
    });
    expect(
      op({ kind: "setBeltKind", system: SYSTEM, index: 1, beltKind: "rocky_asteroid_belt" }),
    ).toEqual({
      op: { type: "SetBeltKind", system: SYSTEM, index: 1, kind: "rocky_asteroid_belt" },
    });
    expect(op({ kind: "removeBelt", system: SYSTEM, index: 0 })).toEqual({
      op: { type: "RemoveBelt", system: SYSTEM, index: 0 },
    });
    expect(op({ kind: "innerRadius", system: SYSTEM, radius: 250 })).toEqual({
      op: { type: "SetInnerRadius", system: SYSTEM, radius: 250 },
    });
  });

  it("moves a belt with no asteroids near it alone", () => {
    expect(op({ kind: "setBeltRadius", system: SYSTEM, index: 1, radius: 180 })).toEqual({
      op: { type: "SetBeltRadius", system: SYSTEM, index: 1, radius: 180 },
    });
  });

  it("moves a belt's asteroids out with it by the same step, each at its own angle", () => {
    expect(op({ kind: "setBeltRadius", system: SYSTEM, index: 0, radius: 130 })).toEqual({
      op: {
        type: "Batch",
        description: "Moved the belt at radius 120 in system #140 to 130, with 1 asteroid",
        ops: [
          { type: "SetBeltRadius", system: SYSTEM, index: 0, radius: 130 },
          {
            type: "MoveBody",
            system: SYSTEM,
            body: ASTEROID,
            radius: expect.closeTo(134, 9),
            angle: expect.closeTo(300, 9),
          },
        ],
      },
    });
  });

  it("makes nothing of an intent that changes nothing", () => {
    const frame = frameOf();
    const here = bodyOrbit(frame.layout, LONE)!;
    expect(op(move(LONE, here.radius, here.angle), frame)).toBeNull();
    expect(op(move(LONE, here.radius, here.angle + 360), frame)).toBeNull();
    expect(op({ kind: "setBeltRadius", system: SYSTEM, index: 0, radius: 120 })).toBeNull();
    const retype = {
      kind: "setBeltKind",
      system: SYSTEM,
      index: 0,
      beltKind: "rocky_asteroid_belt",
    };
    expect(op(retype as GeometryIntent)).toBeNull();
    expect(op({ kind: "removeBelt", system: SYSTEM, index: 2 })).toBeNull();
    expect(op({ kind: "innerRadius", system: SYSTEM, radius: 200 })).toBeNull();
  });

  it("refuses what the body or its new parent cannot do, saying why", () => {
    expect(op(move(STAR, 10, 0))).toEqual({ refused: GEOMETRY_REASONS.star });
    expect(op(reparent(PLANET, LONE))).toEqual({ refused: GEOMETRY_REASONS.hasMoons });
    expect(op(reparent(LONE, MOON))).toEqual({ refused: GEOMETRY_REASONS.moonHost });
    expect(op(reparent(LONE, ASTEROID))).toEqual({ refused: GEOMETRY_REASONS.asteroidHost });
    expect(op(reparent(STAR, null, 10, 0))).toEqual({ refused: GEOMETRY_REASONS.star });
    expect(op(reparent(LONE, LONE))).toEqual({ refused: GEOMETRY_REASONS.itself });
    expect(op(reparent(LONE, 99))).toEqual({ refused: GEOMETRY_REASONS.elsewhere });
    expect(op({ kind: "innerRadius", system: SYSTEM, radius: 100 })).toEqual({
      refused: innerTooSmall(170),
    });
    expect(innerTooSmall(154)).toBe("The inner radius can't go below 154");
  });

  it("refuses to move a moon whose planet is missing", () => {
    const orphan = orbitSystem({ planets: [saveBody(58, "pc_barren", [100, 20], 10, 6, 57)] });
    expect(op(move(58, 12, 0), frameOf(orphan))).toEqual({ refused: GEOMETRY_REASONS.noOrbit });
    expect(op(reparent(58, null, 102, 11), frameOf(orphan))).toMatchObject({
      op: { type: "SetBodyParent", parent: "Centre" },
    });
  });
});

describe("refusals before any op", () => {
  it("refuses a range, and takes a range of one value as that value", () => {
    expect(op(move(LONE, { min: 40, max: 60 }, 90))).toEqual({ refused: GEOMETRY_REASONS.range });
    expect(op(move(LONE, { min: 90, max: 90 }, 90))).toEqual(op(move(LONE, 90, 90)));
    expect(op(move(LONE, { min: 90, max: 90 }, 90))).toMatchObject({
      op: { type: "MoveBody", radius: 90 },
    });
  });

  it("refuses a radius or angle that is not a number", () => {
    const refused = { refused: GEOMETRY_REASONS.notANumber };
    expect(op(move(LONE, Number.NaN, 0))).toEqual(refused);
    expect(op(move(LONE, 110, Number.POSITIVE_INFINITY))).toEqual(refused);
    expect(op(reparent(LONE, PLANET, 25, Number.NaN))).toEqual(refused);
    expect(
      op({ kind: "addBelt", system: SYSTEM, beltKind: "icy_asteroid_belt", radius: Infinity }),
    ).toEqual(refused);
    expect(op({ kind: "setBeltRadius", system: SYSTEM, index: 0, radius: Number.NaN })).toEqual(
      refused,
    );
    expect(op({ kind: "innerRadius", system: SYSTEM, radius: Number.NaN })).toEqual(refused);
  });

  it("refuses a belt radius that would put one of its asteroids at or past the centre", () => {
    const inside = orbitSystem();
    inside.planets[5] = saveBody(ASTEROID, "pc_asteroid", [112, 0], 112, 3);
    expect(
      op({ kind: "setBeltRadius", system: SYSTEM, index: 0, radius: 8 }, frameOf(inside)),
    ).toEqual({ refused: GEOMETRY_REASONS.asteroidPast });
    expect(
      op({ kind: "setBeltRadius", system: SYSTEM, index: 0, radius: 9 }, frameOf(inside)),
    ).toMatchObject({ op: { type: "Batch" } });
  });
});

describe("a belt moved with its asteroids", () => {
  /** The asteroid move a belt moved to `radius` makes, with the asteroid stored at `stored` and drawn at `drawn`. */
  function carried(stored: number, drawn: number, radius: number) {
    const [x, y] = ORBIT_SYSTEM_AT.asteroid;
    const off = drawn / 124;
    const planets = orbitSystem().planets.map((p) =>
      p.id === 6 ? drawnOff(saveBody(6, "pc_asteroid", [x * off, y * off], stored, 3), drawn) : p,
    );
    const made = op(
      { kind: "setBeltRadius", system: SYSTEM, index: 0, radius },
      frameOf(orbitSystem({ planets })),
    );
    return made && "op" in made && made.op.type === "Batch" ? made.op.ops[1] : null;
  }

  it("carries a belt's asteroid on from the orbit it stores, not where it is drawn", () => {
    expect(carried(124, 124.3, 130)).toMatchObject({ type: "MoveBody", body: 6, radius: 134 });
  });

  it("carries an asteroid stored off any whole orbit by the belt's own step", () => {
    const moved = carried(124.3, 124.3, 120.3);
    expect(moved).toMatchObject({ type: "MoveBody", body: 6 });
    expect(moved?.type === "MoveBody" && moved.radius).toBeCloseTo(124.6);
  });
});
