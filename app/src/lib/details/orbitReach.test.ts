import { describe, expect, it } from "vitest";
import { ORBIT_SYSTEM_AT, orbitSystem, saveBody } from "../../test/builders";
import rules from "../../../../testdata/orbit_rules.json";
import { ASTEROID, drawnOff, frameOf, LONE, MOON, PLANET, STAR } from "./fixture";
import { grownInner, grownRadius, innerFloor, nextMoonRing, overlapOf } from "./orbitReach";
import { polar, type BodyPlacement, type Point, type SystemLayout } from "./orbits";

describe("grownInner", () => {
  const frame = frameOf();
  const moved = (id: number, parent: number | null, radius: number, angle: number) =>
    grownInner(frame, { bodies: new Map([[id, { parent, radius, angle }]]) });

  it("counts a moved planet's moons", () => {
    expect(moved(PLANET, null, 180, 0)).toBe(180 + 20 + 30);
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

  it("grows past what is put outside it but inside a belt the game wrote past it, as the core does", () => {
    const beltPast = frameOf(
      orbitSystem({
        planets: [
          saveBody(STAR, "pc_g_star", [0, 0], 0, 30),
          saveBody(LONE, "pc_arid", [110, 0], 110, 12),
        ],
        belts: [{ kind: "rocky_asteroid_belt", inner_radius: 230 }],
        inner_radius: 150,
      }),
    );
    const grow = (radius: number) =>
      grownInner(beltPast, { bodies: new Map([[LONE, { parent: null, radius, angle: 0 }]]) });
    expect(grow(200)).toBe(230);
    expect(grow(120)).toBe(150);
    const belt = (radius: number) =>
      grownInner(beltPast, {
        belts: [...beltPast.layout.belts, { kind: "rocky_asteroid_belt", radius }],
      });
    expect(belt(200)).toBe(230);
    expect(belt(140)).toBe(150);
  });

  it("never shrinks it", () => {
    expect(moved(ASTEROID, null, 20, 0)).toBe(200);
  });
});

describe("where a new moon goes and what a body stands on", () => {
  const { layout } = frameOf();

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
});

/** A body of a case `radius` from its parent, or from the centre without one, at `angle` degrees. */
interface Placed {
  id: number;
  parent: number | null;
  radius: number;
  angle: number;
}

/** The layout of `placed` and `belts`, each body's point about its parent's, parents listed first. */
function layoutOf(placed: readonly Placed[], belts: readonly number[]): SystemLayout {
  const points = new Map<number, Point>();
  const bodies = placed.map(({ id, parent, radius, angle }): BodyPlacement => {
    const centre = parent === null ? { x: 0, y: 0 } : points.get(parent)!;
    const point = polar(centre.x, centre.y, radius, angle);
    points.set(id, point);
    return {
      id,
      ...point,
      disc: 1,
      star: false,
      moon: parent !== null,
      parent,
      ring: radius > 0 ? { cx: centre.x, cy: centre.y, radius } : null,
      angle,
      light: null,
      band: null,
      turn: null,
      radius: null,
    };
  });
  const bands = belts.map((radius) => ({
    kind: "rocky_asteroid_belt",
    radius,
    inner: radius,
    outer: radius,
  }));
  return { bodies, belts: bands, innerRadius: 0, fitRadius: 0, largestDisc: 0 };
}

describe("the orbit rules the core holds too, on testdata/orbit_rules.json", () => {
  it.each(rules.overlap)("finds the body one stands on: $name", (rule) => {
    const { body } = rule;
    const layout = layoutOf([...rule.bodies, body], rule.belts);
    expect(overlapOf(layout, body.id, body.parent, body.radius, body.angle)).toBe(rule.overlaps);
  });

  it.each(rules.growth)("grows the inner radius: $name", (rule) => {
    expect(grownRadius(rules.radii, rule)).toBe(rule.inner);
  });

  it.each(rules.inner_floor)("floors the inner radius: $name", (rule) => {
    expect(innerFloor(rules.radii, rule.reach, rule.current)).toBe(rule.floor);
  });
});
