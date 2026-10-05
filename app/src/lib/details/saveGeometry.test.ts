import { describe, expect, it } from "vitest";
import { orbitSystem, saveBody } from "../../test/builders";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../capabilities";
import { ASTEROID, frameOf, LONE, MOON, move, PLANET, reparent, STAR, SYSTEM } from "./fixture";
import type { GeometryIntent } from "./orbitIntent";
import { geometryAdapterFor, NO_GEOMETRY, SAVE_GEOMETRY } from "./saveGeometry";

describe("what a save lets the system view edit", () => {
  const editing = SAVE_GEOMETRY.editing(frameOf());
  const flags = (id: number) => editing.bodies.get(id);

  it.each([
    [
      "a planet, which can host moons on its first moon ring and become one",
      LONE,
      { move: true, host: true, reparent: true, asMoon: true, moonRing: 15 },
    ],
    [
      "a moon, which detaches to its planet's parent and cannot host",
      MOON,
      {
        move: true,
        host: false,
        reparent: true,
        asMoon: true,
        detachTo: null,
        refusal: "moonHost",
        hostRefusal: "moonHost",
      },
    ],
    [
      "the central star, which stays fixed",
      STAR,
      {
        move: false,
        host: false,
        reparent: false,
        asMoon: false,
        refusal: "star",
        hostRefusal: "orbitsCentre",
      },
    ],
    [
      "a planet with moons, which can be given a star but not become a moon",
      PLANET,
      {
        move: true,
        host: true,
        reparent: true,
        asMoon: false,
        moonRing: 25,
        refusal: "hasMoons",
      },
    ],
  ])("flags %s", (_, id, expected) => {
    expect(flags(id)).toEqual(expected);
  });

  it("moves an asteroid, which cannot host", () => {
    expect(flags(ASTEROID)).toMatchObject({ move: true, host: false, reparent: true });
    expect(flags(ASTEROID)?.refusal).toBe("asteroidHost");
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
      refusal: "noOrbit",
      hostRefusal: "moonHost",
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
    expect(geometryAdapterFor("save", SAVE_CAPABILITIES, SYSTEM)).toBe(SAVE_GEOMETRY);
    expect(geometryAdapterFor("scenario", SCENARIO_CAPABILITIES, SYSTEM)).toBe(NO_GEOMETRY);
    expect(geometryAdapterFor("save", SAVE_CAPABILITIES, null)).toBe(NO_GEOMETRY);
  });

  it("on a scenario, lets nothing move, previews nothing and makes no op", () => {
    const adapter = geometryAdapterFor("scenario", SCENARIO_CAPABILITIES, SYSTEM);
    const editing = adapter.editing(frameOf());
    expect(editing.bodies.size).toBe(0);
    expect(editing).toMatchObject({ belts: false, innerRadius: false });
    expect(adapter.preview(move(LONE, 110, 90), frameOf())).toEqual({});
    expect(adapter.op(move(LONE, 110, 90), frameOf())).toBeNull();
  });
});

describe("the preview of an intent", () => {
  it("draws a range at its middle", () => {
    const preview = SAVE_GEOMETRY.preview(move(LONE, { min: 40, max: 60 }, 90), frameOf());
    expect(preview.bodies?.get(LONE)).toEqual({ parent: null, radius: 50, angle: 90 });
  });

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
