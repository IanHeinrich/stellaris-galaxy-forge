import { describe, expect, it } from "vitest";
import { VANILLA_SYSTEM_RADII } from "../../generated/constants";
import type { PlanetSummary } from "../../generated/PlanetSummary";
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
  return { layout, details, planetClasses, radii: VANILLA_SYSTEM_RADII };
}

const op = (intent: GeometryIntent, frame = frameOf()) => SAVE_GEOMETRY.op(intent, frame);

/** `body` as the core sends one the game placed a little off its stored orbit: drawn at `drawn`. */
function drawnOff(body: PlanetSummary, drawn: number): PlanetSummary {
  return { ...body, layout: { ...body.layout!, orbit: { min: drawn, max: drawn } } };
}
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

  it("moves a planet, which can host moons on its first moon ring and become one", () => {
    expect(flags(LONE)).toEqual({
      move: true,
      host: true,
      reparent: true,
      asMoon: true,
      moonRing: 15,
    });
  });

  it("moves a moon, which detaches to its planet's parent and cannot host", () => {
    expect(flags(MOON)).toEqual({
      move: true,
      host: false,
      reparent: true,
      asMoon: true,
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
      asMoon: false,
      reason: GEOMETRY_REASONS.star,
    });
  });

  it("lets a planet with moons be given a star, but not become a moon", () => {
    expect(flags(PLANET)).toEqual({
      move: true,
      host: true,
      reparent: true,
      asMoon: false,
      moonRing: 25,
      reason: GEOMETRY_REASONS.hasMoons,
    });
  });

  it("edits belts and the inner radius, down to the system's reach or its own value below it", () => {
    expect(editing).toMatchObject({ belts: true, innerRadius: true, innerFloor: 170 });
    const low = SAVE_GEOMETRY.editing(frameOf(orbitSystem({ inner_radius: 140 })));
    expect(low.innerFloor).toBe(140);
    const scar = saveBody(8, "pc_arid", [400, 0], 0, 12);
    const scarred = orbitSystem({ planets: [...orbitSystem().planets, scar] });
    expect(SAVE_GEOMETRY.editing(frameOf(scarred)).innerFloor).toBe(170);
    const planets = [...orbitSystem().planets, saveBody(7, "pc_arid", [0, 180], 180, 12)];
    const wide = SAVE_GEOMETRY.editing(frameOf(orbitSystem({ planets, inner_radius: 260 })));
    expect(wide.innerFloor).toBeCloseTo(180);
  });

  it("measures reach as the core does: from the stored orbit, the primary and orbits above 0", () => {
    const planets = [
      ...orbitSystem().planets,
      saveBody(7, "pc_arid", [179.996, 0], 180, 12),
      saveBody(8, "pc_g_star", [250, 0], 0, 20),
    ];
    const frame = frameOf(orbitSystem({ planets, inner_radius: 205 }));
    expect(SAVE_GEOMETRY.editing(frame).innerFloor).toBe(180);
    expect(SAVE_GEOMETRY.preview(move(7, 180, 90), frame)).toEqual({
      bodies: new Map([[7, { parent: null, radius: 180, angle: 90 }]]),
    });
  });

  it("lets a moon whose planet is missing only become a planet of the star", () => {
    const planets = [...orbitSystem().planets, saveBody(58, "pc_barren", [100, 20], 10, 6, 57)];
    const orphan = SAVE_GEOMETRY.editing(frameOf(orbitSystem({ planets }))).bodies.get(58);
    expect(orphan).toEqual({
      move: false,
      host: false,
      reparent: true,
      asMoon: true,
      detachTo: null,
      detachOnly: true,
      reason: GEOMETRY_REASONS.noOrbit,
    });
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
        star: false,
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
        star: false,
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
      op: { type: "SetSaveBodyParent", body: MOON, parent: null, star: false },
    });
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

describe("the stars of a binary system", () => {
  const COMPANION = 8;
  const ITS_PLANET = 9;
  const details = orbitSystem();
  details.planets[0] = saveBody(STAR, "pc_g_star", [15, 0], 15, 30);
  details.planets.push(saveBody(COMPANION, "pc_g_star", [-240, 0], 240, 20));
  details.planets.push(saveBody(ITS_PLANET, "pc_arid", [-200, 0], 40, 10, COMPANION));
  const frame = frameOf(details);
  const editing = SAVE_GEOMETRY.editing(frame).bodies;

  it("move and take planets past their outermost, but keep their parent", () => {
    const star = { move: true, host: true, reparent: false, asMoon: false };
    const reason = GEOMETRY_REASONS.starMoon;
    expect(editing.get(STAR)).toEqual({ ...star, moonRing: 30, reason });
    expect(editing.get(COMPANION)).toEqual({ ...star, moonRing: 65, reason });
  });

  it("are moved by the save's move, and refused a parent", () => {
    expect(op(move(COMPANION, 250, 90), frame)).toEqual({
      op: { type: "MoveSaveBody", system: SYSTEM, body: COMPANION, radius: 250, angle: 90 },
    });
    expect(op(reparent(STAR, null, 20, 10), frame)).toMatchObject({
      op: { type: "MoveSaveBody", body: STAR, radius: 20 },
    });
    expect(op(reparent(COMPANION, LONE), frame)).toEqual({ refused: GEOMETRY_REASONS.starMoon });
  });

  it("take a planet, with its moons, as a star's planet", () => {
    const toStar = (body: number) => ({
      op: {
        type: "SetSaveBodyParent",
        system: SYSTEM,
        body,
        parent: COMPANION,
        star: true,
        radius: 70,
        angle: 10,
      },
    });
    expect(op(reparent(LONE, COMPANION, 70, 10), frame)).toEqual(toStar(LONE));
    expect(op(reparent(PLANET, COMPANION, 70, 10), frame)).toEqual(toStar(PLANET));
    expect(op(reparent(MOON, COMPANION, 70, 10), frame)).toEqual(toStar(MOON));
  });

  it("have planets, which host moons and detach to the centre", () => {
    expect(editing.get(ITS_PLANET)).toEqual({
      move: true,
      host: true,
      reparent: true,
      asMoon: true,
      moonRing: 15,
      detachTo: null,
    });
    expect(op(reparent(LONE, ITS_PLANET, 15, 0), frame)).toMatchObject({
      op: { type: "SetSaveBodyParent", parent: ITS_PLANET, star: false },
    });
    expect(op(reparent(PLANET, ITS_PLANET, 15, 0), frame)).toEqual({
      refused: GEOMETRY_REASONS.hasMoons,
    });
    expect(op(reparent(ITS_PLANET, null, 200, 0), frame)).toMatchObject({
      op: { type: "SetSaveBodyParent", parent: null, star: false },
    });
  });

  it("detach a moon of a star's planet to that star", () => {
    const moon = saveBody(10, "pc_barren", [-200, 15], 15, 5, ITS_PLANET);
    const withMoon = frameOf({ ...details, planets: [...details.planets, moon] });
    expect(SAVE_GEOMETRY.editing(withMoon).bodies.get(10)?.detachTo).toBe(COMPANION);
    expect(op(reparent(10, COMPANION, 70, 10), withMoon)).toMatchObject({
      op: { type: "SetSaveBodyParent", parent: COMPANION, star: true },
    });
  });
});

describe("a planet whose save names the star at the centre as its parent", () => {
  const NAMED = 7;
  const details = orbitSystem();
  details.planets.push(saveBody(NAMED, "pc_arid", [0, 140], 140, 10, STAR));
  const frame = frameOf(details);

  it("orbits the centre, with nothing to detach from", () => {
    expect(SAVE_GEOMETRY.editing(frame).bodies.get(NAMED)).toEqual({
      move: true,
      host: true,
      reparent: true,
      asMoon: true,
      moonRing: 15,
    });
    expect(op(reparent(NAMED, null, 150, 90), frame)).toEqual(op(move(NAMED, 150, 90), frame));
    expect(op(move(NAMED, 150, 90), frame)).toMatchObject({ op: { type: "MoveSaveBody" } });
  });
});

describe("a ring world segment", () => {
  const SEGMENT = 7;
  const details = orbitSystem();
  details.planets.push(saveBody(SEGMENT, "pc_ringworld_seam", [0, 180], 180, 10));
  const planetClasses = new Map(orbitClasses());
  const seam = planetClasses.get("pc_arid")!;
  planetClasses.set("pc_ringworld_seam", { ...seam, key: "pc_ringworld_seam", ringworld: true });
  const layout = systemLayout(details, null, planetClasses, VANILLA_MOON_SCALE);
  const frame: GeometryFrame = { layout, details, planetClasses, radii: VANILLA_SYSTEM_RADII };

  it("stays where it is, takes no moons and keeps its parent", () => {
    expect(SAVE_GEOMETRY.editing(frame).bodies.get(SEGMENT)).toEqual({
      move: false,
      host: false,
      reparent: false,
      asMoon: false,
      reason: GEOMETRY_REASONS.ringworld,
    });
  });

  it("refuses a move, a new parent and a moon, saying why", () => {
    const refused = { refused: GEOMETRY_REASONS.ringworld };
    expect(op(move(SEGMENT, 190, 90), frame)).toEqual(refused);
    expect(op(reparent(SEGMENT, LONE), frame)).toEqual(refused);
    expect(op(reparent(SEGMENT, null, 190, 90), frame)).toEqual(refused);
    expect(op(reparent(LONE, SEGMENT), frame)).toEqual(refused);
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
  const frame = frameOf();
  const moved = (id: number, parent: number | null, radius: number, angle: number) =>
    grownInner(frame, { bodies: new Map([[id, { parent, radius, angle }]]) });

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
      grownInner(small, { bodies: new Map([[LONE, { parent: null, radius, angle: 0 }]]) });
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
    expect(nextMoonRing(frameOf(), LONE)).toBe(15);
    expect(nextMoonRing(frameOf(), PLANET)).toBe(25);
  });

  it("puts a new moon one step past the orbit the moon before it stores, not where it is drawn", () => {
    const [x, y] = ORBIT_SYSTEM_AT.lonePlanet;
    const planets = [
      ...orbitSystem().planets,
      drawnOff(saveBody(7, "pc_barren", [x + 15.06, y], 15, 5, LONE), 15.06),
    ];
    expect(nextMoonRing(frameOf(orbitSystem({ planets })), LONE)).toBe(20);
  });

  it("puts a new moon one step past a moon stored off any whole orbit", () => {
    const [x, y] = ORBIT_SYSTEM_AT.lonePlanet;
    const planets = [
      ...orbitSystem().planets,
      saveBody(7, "pc_barren", [x + 15.3, y], 15.3, 5, LONE),
    ];
    expect(nextMoonRing(frameOf(orbitSystem({ planets })), LONE)).toBeCloseTo(20.3);
  });

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
    expect(carried(124, 124.3, 130)).toMatchObject({ type: "MoveSaveBody", body: 6, radius: 134 });
  });

  it("carries an asteroid stored off any whole orbit by the belt's own step", () => {
    const moved = carried(124.3, 124.3, 120.3);
    expect(moved).toMatchObject({ type: "MoveSaveBody", body: 6 });
    expect(moved?.type === "MoveSaveBody" && moved.radius).toBeCloseTo(124.6);
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

describe("the inner radius a belt grows", () => {
  const addBelt = (radius: number): GeometryIntent => ({
    kind: "addBelt",
    system: SYSTEM,
    beltKind: "rocky_asteroid_belt",
    radius,
  });

  it("grows past a belt added or moved beyond the system's reach, as the core does", () => {
    expect(SAVE_GEOMETRY.preview(addBelt(250), frameOf()).innerRadius).toBe(280);
    expect(SAVE_GEOMETRY.preview(addBelt(150), frameOf()).innerRadius).toBeUndefined();
    const moved = { kind: "setBeltRadius", system: SYSTEM, index: 1, radius: 300 } as const;
    expect(SAVE_GEOMETRY.preview(moved, frameOf()).innerRadius).toBe(330);
  });

  it("sizes the system by the install's radii", () => {
    const radii = { min_inner: 180, inner_offset: 50, outer_offset: 100 };
    const frame = { ...frameOf(), radii };
    expect(SAVE_GEOMETRY.preview(addBelt(250), frame).innerRadius).toBe(300);
    expect(SAVE_GEOMETRY.editing(frame).innerFloor).toBe(180);
  });
});
