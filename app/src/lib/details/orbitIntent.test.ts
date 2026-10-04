import { describe, expect, it } from "vitest";
import { orbitClasses, orbitSystem } from "../../test/builders";
import { VANILLA_MOON_SCALE } from "./discs";
import { bodyOrbit, defaultBeltKind, fieldIntent, inspectedBody, nudged } from "./orbitIntent";
import { systemLayout } from "./orbits";

const SYSTEM = 140;
const STAR = 1;
const PLANET = 2;
const MOON = 3;
const LONE = 5;

const planetClasses = orbitClasses();
const layout = systemLayout(orbitSystem(), null, planetClasses, VANILLA_MOON_SCALE);

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

describe("what an intent reads of the layout", () => {
  it("reads a body's orbit about its parent, and none for a star", () => {
    expect(bodyOrbit(layout, MOON)).toEqual({
      parent: PLANET,
      radius: 15,
      angle: expect.closeTo(90, 9),
    });
    expect(bodyOrbit(layout, STAR)).toBeNull();
  });

  it("finds the body the inspector shows among the system's", () => {
    expect(inspectedBody(layout, SYSTEM, { kind: "body", system: SYSTEM, id: LONE })).toBe(LONE);
    expect(inspectedBody(layout, SYSTEM, { kind: "body", system: SYSTEM, id: 99 })).toBeNull();
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
