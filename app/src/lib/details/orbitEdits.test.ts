import { describe, expect, it } from "vitest";
import type { SystemDetails } from "../../generated/SystemDetails";
import { ORBIT_SYSTEM_AT, orbitClasses, orbitSystem, saveBody } from "../../test/builders";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../capabilities";
import { VANILLA_MOON_SCALE } from "./discs";
import {
  bodyOrbit,
  defaultBeltKind,
  fieldIntent,
  GEOMETRY_REASONS,
  geometryAdapterFor,
  grownInner,
  innerTooSmall,
  inspectedBody,
  NO_GEOMETRY,
  nextMoonRing,
  nudged,
  overlapOf,
  SAVE_GEOMETRY,
  type GeometryFrame,
  type GeometryIntent,
} from "./orbitEdits";
import { systemLayout } from "./orbits";

const SYSTEM = 140;
const STAR = 1;
const PLANET = 2;
const MOON = 3;
const LONE = 5;
const ASTEROID = 6;

function frameOf(details: SystemDetails = orbitSystem()): GeometryFrame {
  const planetClasses = orbitClasses();
  const layout = systemLayout(details, null, planetClasses, VANILLA_MOON_SCALE);
  return { layout, details, planetClasses };
}

const op = (intent: GeometryIntent, frame = frameOf()) => SAVE_GEOMETRY.op(intent, frame);
const move = (body: number, radius: number, angle: number): GeometryIntent => ({
  kind: "move",
  system: SYSTEM,
  body,
  radius,
  angle,
});
const reparent = (body: number, parent: number | null, radius = 25, angle = 0): GeometryIntent => ({
  kind: "reparent",
  system: SYSTEM,
  body,
  parent,
  radius,
  angle,
});

describe("what a save lets the system view edit", () => {
  const editing = SAVE_GEOMETRY.editing(frameOf());
  const flags = (id: number) => editing.bodies.get(id);

  it("moves a planet, which can host moons and become one", () => {
    expect(flags(LONE)).toEqual({ move: true, host: true, reparent: true });
  });

  it("moves a moon, which detaches to its planet's parent and cannot host", () => {
    expect(flags(MOON)).toEqual({
      move: true,
      host: false,
      reparent: true,
      detachTo: null,
      reason: GEOMETRY_REASONS.moonHost,
    });
  });

  it("moves an asteroid, which cannot host", () => {
    expect(flags(ASTEROID)).toMatchObject({ move: true, host: false, reparent: true });
    expect(flags(ASTEROID)?.reason).toBe(GEOMETRY_REASONS.asteroidHost);
  });

  it("keeps the central star fixed", () => {
    expect(flags(STAR)).toEqual({
      move: false,
      host: false,
      reparent: false,
      reason: GEOMETRY_REASONS.star,
    });
  });

  it("does not make a planet with moons a moon", () => {
    expect(flags(PLANET)).toEqual({
      move: true,
      host: true,
      reparent: false,
      reason: GEOMETRY_REASONS.hasMoons,
    });
  });

  it("edits belts and the inner radius, down to the rule's floor or the system's own below it", () => {
    expect(editing).toMatchObject({ belts: true, innerRadius: true, innerFloor: 124 + 30 });
    const low = SAVE_GEOMETRY.editing(frameOf(orbitSystem({ inner_radius: 140 })));
    expect(low.innerFloor).toBe(140);
  });

  it("edits nothing before the system's details are in", () => {
    const frame = { ...frameOf(), details: null };
    expect(SAVE_GEOMETRY.editing(frame)).toMatchObject({ belts: false, innerRadius: false });
    expect(SAVE_GEOMETRY.editing(frame).bodies.size).toBe(0);
  });
});

describe("the adapter a document gets", () => {
  it("is the save's for a save system, and edits nothing on a scenario or with no system", () => {
    expect(geometryAdapterFor(SAVE_CAPABILITIES, SYSTEM)).toBe(SAVE_GEOMETRY);
    expect(geometryAdapterFor(SCENARIO_CAPABILITIES, SYSTEM)).toBe(NO_GEOMETRY);
    expect(geometryAdapterFor(SAVE_CAPABILITIES, null)).toBe(NO_GEOMETRY);
  });

  it("on a scenario, lets nothing move, previews nothing and makes no op", () => {
    const adapter = geometryAdapterFor(SCENARIO_CAPABILITIES, SYSTEM);
    const editing = adapter.editing(frameOf());
    expect(editing.bodies.size).toBe(0);
    expect(editing).toMatchObject({ belts: false, innerRadius: false });
    expect(adapter.preview(move(LONE, 110, 90), frameOf())).toEqual({});
    expect(adapter.op(move(LONE, 110, 90), frameOf())).toBeNull();
  });
});

describe("the op each intent makes", () => {
  it("moves a body, its angle turned into [0, 360)", () => {
    expect(op(move(LONE, 110, -30))).toEqual({
      op: { type: "MoveSaveBody", system: SYSTEM, body: LONE, radius: 110, angle: 330 },
    });
  });

  it("makes a planet a moon, and a moon a planet", () => {
    expect(op(reparent(LONE, PLANET, 25, 0))).toEqual({
      op: {
        type: "SetSaveBodyParent",
        system: SYSTEM,
        body: LONE,
        parent: PLANET,
        radius: 25,
        angle: 0,
      },
    });
    expect(op(reparent(MOON, null, 140, 10))).toEqual({
      op: {
        type: "SetSaveBodyParent",
        system: SYSTEM,
        body: MOON,
        parent: null,
        radius: 140,
        angle: 10,
      },
    });
  });

  it("moves a body given the parent it has", () => {
    expect(op(reparent(MOON, PLANET, 18, 90))).toEqual(op(move(MOON, 18, 90)));
  });

  it("adds, retypes and removes a belt, and sets the inner radius", () => {
    const addBelt = { kind: "addBelt", system: SYSTEM, beltKind: "icy_asteroid_belt", radius: 90 };
    expect(op(addBelt as GeometryIntent)).toEqual({
      op: { type: "AddSaveBelt", system: SYSTEM, kind: "icy_asteroid_belt", radius: 90 },
    });
    expect(
      op({ kind: "setBeltKind", system: SYSTEM, index: 1, beltKind: "rocky_asteroid_belt" }),
    ).toEqual({
      op: { type: "SetSaveBeltKind", system: SYSTEM, index: 1, kind: "rocky_asteroid_belt" },
    });
    expect(op({ kind: "removeBelt", system: SYSTEM, index: 0 })).toEqual({
      op: { type: "RemoveSaveBelt", system: SYSTEM, index: 0 },
    });
    expect(op({ kind: "innerRadius", system: SYSTEM, radius: 250 })).toEqual({
      op: { type: "SetSaveInnerRadius", system: SYSTEM, radius: 250 },
    });
  });

  it("moves a belt with no asteroids near it alone", () => {
    expect(op({ kind: "setBeltRadius", system: SYSTEM, index: 1, radius: 180 })).toEqual({
      op: { type: "SetSaveBeltRadius", system: SYSTEM, index: 1, radius: 180 },
    });
  });

  it("moves a belt's asteroids out with it by the same step, each at its own angle", () => {
    expect(op({ kind: "setBeltRadius", system: SYSTEM, index: 0, radius: 130 })).toEqual({
      op: {
        type: "Batch",
        description: "Moved the belt at radius 120 in system #140 to 130, with 1 asteroid",
        ops: [
          { type: "SetSaveBeltRadius", system: SYSTEM, index: 0, radius: 130 },
          {
            type: "MoveSaveBody",
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
    expect(op(reparent(LONE, STAR))).toEqual({ refused: GEOMETRY_REASONS.starHost });
    expect(op(reparent(STAR, null, 10, 0))).toEqual({ refused: GEOMETRY_REASONS.star });
    expect(op(reparent(LONE, LONE))).toEqual({ refused: GEOMETRY_REASONS.itself });
    expect(op(reparent(LONE, 99))).toEqual({ refused: GEOMETRY_REASONS.elsewhere });
    expect(op({ kind: "innerRadius", system: SYSTEM, radius: 100 })).toEqual({
      refused: innerTooSmall(154),
    });
    expect(innerTooSmall(154)).toBe("The inner radius can't go below 154");
  });

  it("refuses to move a moon whose planet is missing", () => {
    const orphan = orbitSystem({ planets: [saveBody(58, "pc_barren", [100, 20], 10, 6, 57)] });
    expect(op(move(58, 12, 0), frameOf(orphan))).toEqual({ refused: GEOMETRY_REASONS.noOrbit });
    expect(op(reparent(58, null, 102, 11), frameOf(orphan))).toMatchObject({
      op: { type: "SetSaveBodyParent", parent: null },
    });
  });
});

describe("an asteroid with a moon of its own", () => {
  const withMoon = orbitSystem();
  withMoon.planets.push(saveBody(7, "pc_barren", ORBIT_SYSTEM_AT.asteroid, 5, 2, ASTEROID));

  it("gives the asteroid's reason for hosting, and its moons' for being given a parent", () => {
    const frame = frameOf(withMoon);
    expect(SAVE_GEOMETRY.editing(frame).bodies.get(ASTEROID)?.reason).toBe(
      GEOMETRY_REASONS.asteroidHost,
    );
    expect(op(reparent(LONE, ASTEROID), frame)).toEqual({
      refused: GEOMETRY_REASONS.asteroidHost,
    });
    expect(op(reparent(ASTEROID, LONE), frame)).toEqual({ refused: GEOMETRY_REASONS.hasMoons });
  });
});

describe("refusals before any op", () => {
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

describe("the preview of an intent", () => {
  it("grows the inner radius when a planet made a moon reaches past the system", () => {
    const preview = SAVE_GEOMETRY.preview(reparent(LONE, PLANET, 170, 0), frameOf());
    expect(preview.bodies?.get(LONE)).toEqual({ parent: PLANET, radius: 170, angle: 0 });
    expect(preview.innerRadius).toBe(60 + 170 + 30);
  });

  it("moves the body, growing the inner radius once it reaches past the system", () => {
    const frame = frameOf();
    const near = SAVE_GEOMETRY.preview(move(LONE, 110, 90), frame);
    expect(near).toEqual({ bodies: new Map([[LONE, { parent: null, radius: 110, angle: 90 }]]) });
    const far = SAVE_GEOMETRY.preview(move(LONE, 190, 90), frame);
    expect(far.innerRadius).toBe(220);
  });

  it("moves a belt's asteroids with it, and replaces the belts", () => {
    const preview = SAVE_GEOMETRY.preview(
      { kind: "setBeltRadius", system: SYSTEM, index: 0, radius: 130 },
      frameOf(),
    );
    expect(preview.belts?.map((b) => b.radius)).toEqual([130, 170]);
    expect(preview.bodies?.get(ASTEROID)?.radius).toBeCloseTo(134);
    const removed = SAVE_GEOMETRY.preview(
      { kind: "removeBelt", system: SYSTEM, index: 0 },
      frameOf(),
    );
    expect(removed.belts).toEqual([{ kind: "icy_asteroid_belt", radius: 170 }]);
  });
});

describe("grownInner", () => {
  const { layout } = frameOf();
  const moved = (id: number, parent: number | null, radius: number, angle: number) =>
    grownInner(layout, { bodies: new Map([[id, { parent, radius, angle }]]) });

  it("grows the inner radius to reach 30 past a body moved beyond the system's reach", () => {
    expect(moved(LONE, null, 190, 0)).toBe(220);
    expect(moved(LONE, null, 110, 0)).toBe(200);
  });

  it("counts a moved planet's moons, and a moon by its planet's distance too", () => {
    expect(moved(PLANET, null, 180, 0)).toBe(180 + 20 + 30);
    expect(moved(MOON, PLANET, 170, 0)).toBe(60 + 170 + 30);
  });

  it("grows a system below the rule to the rule's floor, as the core does", () => {
    const small = frameOf(
      orbitSystem({
        planets: [saveBody(LONE, "pc_arid", [80, 0], 80, 12)],
        belts: [],
        inner_radius: 100,
      }),
    );
    const grow = (radius: number) =>
      grownInner(small.layout, { bodies: new Map([[LONE, { parent: null, radius, angle: 0 }]]) });
    expect(grow(90)).toBe(150);
    expect(grow(60)).toBe(100);
  });

  it("never shrinks it", () => {
    expect(moved(ASTEROID, null, 20, 0)).toBe(200);
  });
});

describe("nudged", () => {
  const at = { parent: null, radius: 45.3, angle: 45.3 };

  it("lands on whole degrees and units", () => {
    expect(nudged(at, { turn: 1, out: 0 })).toEqual({ ...at, angle: 46 });
    expect(nudged(at, { turn: -1, out: 0 })).toEqual({ ...at, angle: 45 });
    expect(nudged(at, { turn: 0, out: 1 })).toEqual({ ...at, radius: 46 });
    expect(nudged(at, { turn: 0, out: -10 })).toEqual({ ...at, radius: 36 });
    expect(nudged({ ...at, angle: 29.9999999999 }, { turn: 1, out: 0 }).angle).toBe(31);
  });

  it("wraps the angle and stops the radius at 1", () => {
    expect(nudged({ ...at, angle: 359.5 }, { turn: 1, out: 0 }).angle).toBe(0);
    expect(nudged({ ...at, angle: 0 }, { turn: -1, out: 0 }).angle).toBe(359);
    expect(nudged({ ...at, radius: 1.5 }, { turn: 0, out: -5 }).radius).toBe(1);
  });
});

describe("fieldIntent", () => {
  const at = { parent: 2, radius: 15.25, angle: 90.4 };

  it("takes the typed value, the other kept exact, the angle turned into [0, 360)", () => {
    expect(fieldIntent(at, "angle", 370)).toEqual({ ...at, angle: 10 });
    expect(fieldIntent(at, "angle", -30)).toEqual({ ...at, angle: 330 });
    expect(fieldIntent(at, "radius", 52.25)).toEqual({ ...at, radius: 52.25 });
  });

  it("takes no radius at or below 0, and nothing that is not a number", () => {
    expect(fieldIntent(at, "radius", 0)).toBeNull();
    expect(fieldIntent(at, "radius", -5)).toBeNull();
    expect(fieldIntent(at, "angle", Number.NaN)).toBeNull();
  });
});

describe("helpers", () => {
  const { layout } = frameOf();

  it("puts a new moon on the first moon ring, or one step past the outermost", () => {
    expect(nextMoonRing(layout, LONE)).toBe(15);
    expect(nextMoonRing(layout, PLANET)).toBe(25);
  });

  it("reads a body's orbit about its parent, and none for a star", () => {
    expect(bodyOrbit(layout, MOON)).toEqual({
      parent: PLANET,
      radius: 15,
      angle: expect.closeTo(90, 9),
    });
    expect(bodyOrbit(layout, STAR)).toBeNull();
  });

  it("finds the body another would stand on, about the same parent", () => {
    expect(overlapOf(layout, LONE, null, 60.4, 30.3)).toBe(PLANET);
    expect(overlapOf(layout, LONE, null, 60, 31)).toBeNull();
    expect(overlapOf(layout, LONE, PLANET, 15, 90)).toBe(MOON);
    expect(overlapOf(layout, PLANET, null, 60, 30)).toBeNull();
  });

  it("lets two asteroids of one belt stand together", () => {
    const [x, y] = ORBIT_SYSTEM_AT.asteroid;
    const second = saveBody(7, "pc_asteroid", [x, y], 124, 3);
    const withTwo = orbitSystem();
    withTwo.planets.push(second);
    expect(overlapOf(frameOf(withTwo).layout, 7, null, 124, 300)).toBeNull();
    const beltless = { ...withTwo, belts: [] };
    expect(overlapOf(frameOf(beltless).layout, 7, null, 124, 300)).toBe(ASTEROID);
  });

  it("finds the body the inspector shows among the system's", () => {
    expect(inspectedBody(layout, SYSTEM, { kind: "planet", id: LONE })).toBe(LONE);
    expect(inspectedBody(layout, SYSTEM, { kind: "planet", id: 99 })).toBeNull();
    expect(inspectedBody(layout, SYSTEM, { kind: "body", system: SYSTEM, id: MOON })).toBe(MOON);
    expect(inspectedBody(layout, SYSTEM, { kind: "body", system: 1, id: MOON })).toBeNull();
    expect(inspectedBody(layout, SYSTEM, { kind: "system", id: SYSTEM })).toBeNull();
    expect(inspectedBody(layout, SYSTEM, null)).toBeNull();
  });

  it("gives a new belt the system's first belt's kind, else rocky", () => {
    expect(
      defaultBeltKind(orbitSystem({ belts: [{ kind: "icy_asteroid_belt", inner_radius: 9 }] })),
    ).toBe("icy_asteroid_belt");
    expect(defaultBeltKind(orbitSystem({ belts: [] }))).toBe("rocky_asteroid_belt");
    expect(defaultBeltKind(null)).toBe("rocky_asteroid_belt");
  });
});
