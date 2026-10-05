import { describe, expect, it } from "vitest";
import { VANILLA_SYSTEM_RADII } from "../../generated/constants";
import { ORBIT_SYSTEM_AT, orbitClasses, orbitSystem, saveBody } from "../../test/builders";
import { VANILLA_MOON_SCALE } from "./discs";
import { ASTEROID, frameOf, LONE, MOON, move, op, PLANET, reparent, STAR, SYSTEM } from "./fixture";
import { GEOMETRY_REASONS, type GeometryFrame, type GeometryIntent } from "./orbitIntent";
import { systemLayout } from "./orbits";
import { SAVE_GEOMETRY } from "./saveGeometry";

describe("an asteroid with a moon of its own", () => {
  const withMoon = orbitSystem();
  withMoon.planets.push(saveBody(7, "pc_barren", ORBIT_SYSTEM_AT.asteroid, 5, 2, ASTEROID));

  it("gives the asteroid's reason for hosting, and its moons' for being given a parent", () => {
    const frame = frameOf(withMoon);
    expect(SAVE_GEOMETRY.editing(frame).bodies.get(ASTEROID)?.refusal).toBe("asteroidHost");
    expect(op(reparent(LONE, ASTEROID), frame)).toEqual({
      refused: GEOMETRY_REASONS.asteroidHost,
    });
    expect(op(reparent(ASTEROID, LONE), frame)).toEqual({ refused: GEOMETRY_REASONS.hasMoons });
  });
});

describe("a body that orbits a planet without being a moon", () => {
  const HABITAT = 7;
  const details = orbitSystem();
  details.planets.push({
    ...saveBody(HABITAT, "pc_habitat", ORBIT_SYSTEM_AT.firstMoon, 10, 4, PLANET),
    moon: false,
    role: "planet",
  });
  const frame = frameOf(details);

  it("cannot be a parent, as Add moon refuses it", () => {
    const editing = SAVE_GEOMETRY.editing(frame).bodies.get(HABITAT);
    expect(editing).toMatchObject({ host: false, hostRefusal: "aboutPlanet" });
    expect(editing?.moonRing).toBeUndefined();
  });

  it("refuses a planet and a moon dropped on it, saying why", () => {
    const refused = { refused: GEOMETRY_REASONS.aboutPlanet };
    expect(op(reparent(LONE, HABITAT), frame)).toEqual(refused);
    expect(op(reparent(MOON, HABITAT), frame)).toEqual(refused);
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
    const refusal = "starMoon";
    expect(editing.get(STAR)).toEqual({ ...star, moonRing: 30, refusal });
    expect(editing.get(COMPANION)).toEqual({ ...star, moonRing: 65, refusal });
  });

  it("are moved by the save's move, and refused a parent", () => {
    expect(op(move(COMPANION, 250, 90), frame)).toEqual({
      op: { type: "MoveBody", system: SYSTEM, body: COMPANION, radius: 250, angle: 90 },
    });
    expect(op(reparent(STAR, null, 20, 10), frame)).toMatchObject({
      op: { type: "MoveBody", body: STAR, radius: 20 },
    });
    expect(op(reparent(COMPANION, LONE), frame)).toEqual({ refused: GEOMETRY_REASONS.starMoon });
  });

  it("take a planet, with its moons, as a star's planet", () => {
    const toStar = (body: number) => ({
      op: {
        type: "SetBodyParent",
        system: SYSTEM,
        body,
        parent: { Body: COMPANION },
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
      op: { type: "SetBodyParent", parent: { Body: ITS_PLANET } },
    });
    expect(op(reparent(PLANET, ITS_PLANET, 15, 0), frame)).toEqual({
      refused: GEOMETRY_REASONS.hasMoons,
    });
    expect(op(reparent(ITS_PLANET, null, 200, 0), frame)).toMatchObject({
      op: { type: "SetBodyParent", parent: "Centre" },
    });
  });

  it("detach a moon of a star's planet to that star", () => {
    const moon = saveBody(10, "pc_barren", [-200, 15], 15, 5, ITS_PLANET);
    const withMoon = frameOf({ ...details, planets: [...details.planets, moon] });
    expect(SAVE_GEOMETRY.editing(withMoon).bodies.get(10)?.detachTo).toBe(COMPANION);
    expect(op(reparent(10, COMPANION, 70, 10), withMoon)).toMatchObject({
      op: { type: "SetBodyParent", parent: { Body: COMPANION } },
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
    expect(op(move(NAMED, 150, 90), frame)).toMatchObject({ op: { type: "MoveBody" } });
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
      refusal: "ringworld",
      hostRefusal: "ringworld",
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

describe("a save's wormholes", () => {
  const wormhole = { id: 30, bypass: 31, kind: "wormhole", partner: 8, x: 0, y: 100 };
  const tunnel = { id: 32, bypass: 33, kind: "shroud_tunnel", partner: null, x: 50, y: 0 };
  const frame = frameOf({ ...orbitSystem(), wormholes: [wormhole, tunnel] });
  const moveTo = (id: number, radius: number, angle: number): GeometryIntent => ({
    kind: "moveWormhole",
    system: SYSTEM,
    wormhole: id,
    radius,
    angle,
  });

  it("move a natural wormhole about the centre, and keep a shroud tunnel where it is", () => {
    expect(SAVE_GEOMETRY.editing(frame).wormholes).toEqual(new Set([30]));
    expect(op(moveTo(30, 150, 405), frame)).toEqual({
      op: { type: "MoveWormhole", wormhole: 30, radius: 150, angle: 45 },
    });
    expect(SAVE_GEOMETRY.preview(moveTo(30, 100, 0), frame).wormholes?.get(30)).toEqual({
      x: 100,
      y: 0,
    });
    expect(op(moveTo(30, 100, 90), frame)).toBeNull();
    expect(op(moveTo(32, 80, 0), frame)).toEqual({ refused: GEOMETRY_REASONS.lockedWormhole });
    expect(op(moveTo(30, 0, 0), frame)).toEqual({ refused: GEOMETRY_REASONS.wormholeAtCentre });
    expect(op(moveTo(99, 80, 0), frame)).toEqual({ refused: GEOMETRY_REASONS.wormholeElsewhere });
  });
});
