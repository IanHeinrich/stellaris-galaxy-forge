import { describe, expect, it } from "vitest";
import type { BodyLayout } from "../../generated/BodyLayout";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemRoll } from "../../generated/SystemRoll";
import {
  bodyLayout,
  ORBIT_SYSTEM_AT,
  orbitClasses,
  orbitSystem,
  planetClassView,
  planetSummary,
  saveBody,
  systemDetails,
} from "../../test/builders";
import { rolledBody, systemRoll } from "../../test/rolls";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../geometry/geometry";
import { MIN_INNER_RADIUS } from "../../generated/constants";
import { discRadius, VANILLA_MOON_SCALE } from "./discs";
import {
  FIT_MARGIN,
  exitBearing,
  placeholderPlanets,
  polar,
  systemLayout,
  type BodyPlacement,
  type LayoutOverride,
  type SystemLayout,
} from "./orbits";

const NO_CLASSES: ReadonlyMap<string, PlanetClassView> = new Map();

const laid = (details: SystemDetails | null, roll: SystemRoll | null = null) =>
  systemLayout(details, roll, NO_CLASSES, VANILLA_MOON_SCALE);

function body(layout: SystemLayout, id: number): BodyPlacement {
  const found = layout.bodies.find((b) => b.id === id);
  if (!found) throw new Error(`no body ${id}`);
  return found;
}

/** The on-screen rotation of the save-frame direction (dx, dy). */
function screen(dx: number, dy: number): number {
  return Math.atan2(SAVE_Y_SIGN * dy, SAVE_X_SIGN * dx);
}

const EARTH_AT = polar(0, 0, 90, 30);
const LUNA_AT = polar(EARTH_AT.x, EARTH_AT.y, 12, 200);

/** Sol (217) of the 4.4 sample: the Sun, Earth (3) at 90 and Luna (4) at 12 about Earth. */
function sol(): SystemLayout {
  return laid(
    systemDetails({
      id: 217,
      planets: [
        saveBody(1, "pc_g_star", [0, 0], 0, 30),
        saveBody(3, "pc_continental", [EARTH_AT.x, EARTH_AT.y], 90, 16),
        saveBody(4, "pc_barren_cold", [LUNA_AT.x, LUNA_AT.y], 12, 5, 3),
      ],
      belts: [
        { kind: "rocky_asteroid_belt", inner_radius: 145 },
        { kind: "icy_asteroid_belt", inner_radius: 290 },
      ],
      inner_radius: 350,
    }),
  );
}

describe("systemLayout on a save", () => {
  it("draws Sol's Sun at the centre, Earth on its orbit of 90 and Luna on a ring of 12 about Earth", () => {
    const layout = sol();
    const sun = body(layout, 1);
    expect([sun.x, sun.y]).toEqual([0, 0]);
    expect(sun.ring).toBeNull();

    const earth = body(layout, 3);
    expect([earth.x, earth.y]).toEqual([EARTH_AT.x, EARTH_AT.y]);
    expect(earth.ring).toEqual({ cx: 0, cy: 0, radius: 90 });

    const luna = body(layout, 4);
    expect([luna.x, luna.y]).toEqual([LUNA_AT.x, LUNA_AT.y]);
    expect(luna.parent).toBe(3);
    expect(luna.moon).toBe(true);
    expect(luna.ring).toEqual({ cx: EARTH_AT.x, cy: EARTH_AT.y, radius: 12 });
    expect(luna.disc).toBeLessThan(earth.disc);
    expect(earth.disc + luna.disc).toBeLessThan(12);
  });

  it("puts Baxom's two stars on one ring of 25 either side of an empty centre", () => {
    const layout = laid(
      systemDetails({
        id: 33,
        planets: [
          saveBody(1, "pc_k_star", [25, 0], 25, 30),
          saveBody(2, "pc_k_star", [-25, 0], 25, 30),
          saveBody(3, "pc_barren", [80, 0], 80, 12),
        ],
        inner_radius: 299.11,
      }),
    );
    for (const id of [1, 2]) expect(body(layout, id).ring).toEqual({ cx: 0, cy: 0, radius: 25 });
    expect(layout.bodies.some((b) => b.x === 0 && b.y === 0)).toBe(false);
    expect(body(layout, 3).light).toBeCloseTo(screen(-1, 0));
  });

  it("follows Carmenekke's three levels: a companion star, its planet and the planet's moon", () => {
    const layout = laid(
      systemDetails({
        id: 53,
        planets: [
          saveBody(1, "pc_m_star", [0, 0], 0, 30),
          saveBody(4, "pc_barren", [8 + 230, 30], 8, 5, 3),
          { ...saveBody(3, "pc_arid", [230, 30], 30, 18, 2), moon: false },
          saveBody(2, "pc_k_star", [230, 0], 230, 25),
        ],
      }),
    );
    expect(body(layout, 2).ring).toEqual({ cx: 0, cy: 0, radius: 230 });
    expect(body(layout, 3).ring).toEqual({ cx: 230, cy: 0, radius: 30 });
    expect(body(layout, 4).ring).toEqual({ cx: 230, cy: 30, radius: 8 });
    expect(body(layout, 3).disc).toBeCloseTo(discRadius(18));
    expect(body(layout, 4).disc).toBeCloseTo(discRadius(5, { moon: true }));
  });

  it("keeps the point of a body whose parent is gone and draws no circle for it", () => {
    const layout = laid(
      systemDetails({ planets: [saveBody(58, "pc_barren", [100, 20], 10, 6, 57)] }),
    );
    const orphan = body(layout, 58);
    expect([orphan.x, orphan.y]).toEqual([100, 20]);
    expect(orphan.ring).toBeNull();
    expect(orphan.parent).toBeNull();
  });

  it("falls back to the centre for a self-parent", () => {
    const layout = laid(systemDetails({ planets: [saveBody(7, "pc_barren", [0, 40], 40, 6, 7)] }));
    expect(body(layout, 7).ring).toEqual({ cx: 0, cy: 0, radius: 40 });
  });

  it("gives a save body its radius from what it orbits with no step, and a star at the centre none", () => {
    const layout = sol();
    expect(body(layout, 1).radius).toBeNull();
    expect(body(layout, 3).radius).toEqual({ min: 90, max: 90, step: null, base: null });
    expect(body(layout, 4).radius).toEqual({ min: 12, max: 12, step: null, base: null });
  });
});

describe("angles", () => {
  it("measures a body's angle about its parent as polar places it", () => {
    const at = polar(0, 0, 90, 0);
    expect(at).toEqual({ x: 90, y: 0 });
    const layout = laid(systemDetails({ planets: [saveBody(1, "pc_arid", [at.x, at.y], 90, 10)] }));
    expect(body(layout, 1).angle).toBe(0);
    expect(body(sol(), 3).angle).toBeCloseTo(30);
    expect(body(sol(), 4).angle).toBeCloseTo(200);
  });

  it("turns each body's lit side to the star it orbits, a moon's to the star and not its planet", () => {
    const layout = sol();
    expect(body(layout, 1).light).toBeNull();
    expect(body(layout, 3).light).toBeCloseTo(screen(-EARTH_AT.x, -EARTH_AT.y));
    expect(body(layout, 4).light).toBeCloseTo(screen(-LUNA_AT.x, -LUNA_AT.y));
  });

  it("turns a companion star's planet and its moon to the companion", () => {
    const layout = laid(
      systemDetails({
        planets: [
          saveBody(1, "pc_m_star", [0, 0], 0, 30),
          saveBody(2, "pc_k_star", [230, 0], 230, 25),
          saveBody(3, "pc_arid", [230, 30], 30, 18, 2),
          saveBody(4, "pc_barren", [238, 30], 8, 5, 3),
        ],
      }),
    );
    expect(body(layout, 3).light).toBeCloseTo(screen(0, -30));
    expect(body(layout, 4).light).toBeCloseTo(screen(-8, -30));
  });
});

describe("scenario bodies", () => {
  const fixed = (value: number) => ({ min: value, max: value });
  const scenario = (
    id: number,
    layout: Partial<BodyLayout>,
    parent: number | null = null,
  ): PlanetSummary => planetSummary({ id, parent, layout: bodyLayout(layout) });

  /** A star, a planet with a moon, a planet turning on from it, and a planet naming no angle. */
  const walk = systemDetails({
    planets: [
      scenario(1, { orbit: fixed(0), orbit_step: fixed(0) }),
      scenario(2, {
        orbit: { min: 40, max: 60 },
        orbit_step: { min: 40, max: 60 },
        angle_step: { min: 90, max: 270 },
        turns_from: 1,
      }),
      scenario(3, { orbit: fixed(5), orbit_step: fixed(5), angle_step: { min: 30, max: 60 } }, 2),
      scenario(4, {
        orbit: { min: 70, max: 100 },
        orbit_step: { min: 30, max: 40 },
        angle_step: { min: 90, max: 270 },
        turns_from: 2,
      }),
      scenario(5, { orbit: { min: 110, max: 150 }, orbit_step: { min: 40, max: 50 } }),
    ],
  });
  /** A roll of the walk as the core answers it. */
  const roll = systemRoll({
    bodies: [
      rolledBody({ id: 1 }),
      rolledBody({ id: 2, orbit: 50, angle: 90, base: 0, from: 180 }),
      rolledBody({ id: 3, orbit: 5, angle: 220, base: 0, from: 180 }),
      rolledBody({ id: 4, orbit: 85, angle: 270, base: 50, from: 90 }),
      rolledBody({ id: 5, orbit: 130, angle: 10, base: 85, from: 180 }),
    ],
  });

  it("places each body where the roll lands it about its parent, with its orbit's band", () => {
    const layout = laid(walk, roll);
    expect(body(layout, 1)).toMatchObject({ x: 0, y: 0, ring: null, radius: null });
    const two = body(layout, 2);
    expect([two.x, two.y].map(Math.round)).toEqual([0, 50]);
    expect(two).toMatchObject({ band: { inner: 40, outer: 60 }, ring: { cx: 0, cy: 0 } });
    const moon = body(layout, 3);
    expect(moon.ring).toEqual({ cx: two.x, cy: two.y, radius: 5 });
    expect(moon.angle).toBe(220);
    expect(body(layout, 4).ring?.radius).toBe(85);
  });

  it("turns each body on from the angle the roll turned it from, marking the body before it only where that one stands out from the centre", () => {
    const layout = laid(walk, roll);
    expect(body(layout, 2).turn).toEqual({ from: 180, step: { min: 90, max: 270 }, anchor: null });
    expect(body(layout, 3).turn).toEqual({ from: 180, step: { min: 30, max: 60 }, anchor: null });
    expect(body(layout, 4).turn).toEqual({ from: 90, step: { min: 90, max: 270 }, anchor: 2 });
    expect(body(layout, 5).turn).toEqual({ from: 0, step: { min: 0, max: 360 }, anchor: null });
  });

  it("reads each body's step out and the running orbit the roll stepped it out from", () => {
    const layout = laid(walk, roll);
    expect(body(layout, 4).radius).toEqual({
      min: 70,
      max: 100,
      step: { min: 30, max: 40 },
      base: 50,
    });
    expect(body(layout, 5).radius?.base).toBe(85);
  });

  it("stands each body at the middle of its orbit, at angle 0, until its roll is in", () => {
    const layout = laid(walk);
    expect(body(layout, 2)).toMatchObject({ x: 50, y: 0, turn: null });
    expect(body(layout, 2).radius?.step).toBeNull();
  });

  it("lays out the same details, roll and classes once, and again for another roll", () => {
    expect(laid(walk, roll)).toBe(laid(walk, roll));
    expect(laid(walk, systemRoll({ ...roll, roll: 1 }))).not.toBe(laid(walk, roll));
  });

  it("draws a ranged size at the middle of its range", () => {
    const layout = laid(
      systemDetails({ planets: [scenario(1, { orbit: fixed(50), size: { min: 10, max: 20 } })] }),
    );
    expect(body(layout, 1).disc).toBeCloseTo(discRadius(15));
  });
});

describe("disc sizes", () => {
  it("draws a moon smaller than its planet and a star larger, by class a star drawn as a planet at a planet's size and an asteroid larger", () => {
    const planet = discRadius(20);
    expect(discRadius(20, { moon: true })).toBeLessThan(planet);
    expect(discRadius(20, { star: true })).toBeGreaterThan(planet);
    const brownDwarf = { ...planetClassView("pc_t_star"), draws_as_planet: true };
    expect(discRadius(20, { star: true, view: brownDwarf })).toBe(planet);
    const rock = { ...planetClassView("pc_cutholoid", false), asteroid: true };
    expect(discRadius(20, { view: rock })).toBeGreaterThan(planet);
  });
});

describe("belts and fit", () => {
  it("centres each belt's band on its radius", () => {
    const belts = sol().belts;
    expect(belts.map((b) => [b.kind, b.radius])).toEqual([
      ["rocky_asteroid_belt", 145],
      ["icy_asteroid_belt", 290],
    ]);
    for (const belt of belts) {
      expect(belt.outer).toBeGreaterThan(belt.inner);
      expect((belt.inner + belt.outer) / 2).toBe(belt.radius);
    }
  });

  it("fits to the inner radius, the outermost belt or the outermost body, whichever reaches furthest", () => {
    expect(sol().fitRadius).toBe(350 + FIT_MARGIN);
    const noInner = laid(
      systemDetails({ belts: [{ kind: "rocky_asteroid_belt", inner_radius: 290 }] }),
    );
    expect(noInner.fitRadius).toBe(noInner.belts[0].outer + FIT_MARGIN);
    const far = laid(
      systemDetails({
        planets: [
          saveBody(1, "pc_k_star", [230, 0], 230, 20),
          saveBody(2, "pc_arid", [230, 30], 30, 18, 1),
        ],
        inner_radius: 200,
      }),
    );
    expect(far.fitRadius).toBe(230 + 30 + FIT_MARGIN);
    expect(laid(null).fitRadius).toBe(MIN_INNER_RADIUS + FIT_MARGIN);
  });
});

describe("an override", () => {
  const classes = orbitClasses();
  const system = orbitSystem();
  const drawn = (override?: LayoutOverride) =>
    systemLayout(system, null, classes, VANILLA_MOON_SCALE, override);
  const moved = (id: number, parent: number | null, radius: number, angle: number) => ({
    bodies: new Map([[id, { parent, radius, angle }]]),
  });

  it("puts an overridden body at its radius and angle about its parent, its disc kept", () => {
    const layout = drawn(moved(5, null, 110, 90));
    const lone = body(layout, 5);
    expect(lone.x).toBeCloseTo(0);
    expect(lone.y).toBeCloseTo(110);
    expect(lone).toMatchObject({ angle: 90, parent: null, moon: false });
    expect(lone.ring).toEqual({ cx: 0, cy: 0, radius: 110 });
    expect(lone.disc).toBe(body(drawn(), 5).disc);
  });

  it("carries a moved planet's save moons with it, each keeping its radius and angle about it", () => {
    const layout = drawn(moved(2, null, 80, 45));
    const planet = body(layout, 2);
    for (const [id, radius, angle] of [
      [3, 15, 90],
      [4, 20, 200],
    ]) {
      const moon = body(layout, id);
      expect(moon.ring).toEqual({ cx: planet.x, cy: planet.y, radius });
      expect(moon.angle).toBeCloseTo(angle);
      expect(Math.hypot(moon.x - planet.x, moon.y - planet.y)).toBeCloseTo(radius);
    }
  });

  it("carries a rolled planet's moons with it", () => {
    const fixed = (value: number) => ({ min: value, max: value });
    const walk = systemDetails({
      planets: [
        planetSummary({ id: 2, layout: bodyLayout({ orbit: fixed(50) }) }),
        planetSummary({ id: 3, parent: 2, moon: true, layout: bodyLayout({ orbit: fixed(5) }) }),
      ],
    });
    const roll = systemRoll({
      bodies: [
        rolledBody({ id: 2, orbit: 50, angle: 0 }),
        rolledBody({ id: 3, orbit: 5, angle: 90 }),
      ],
    });
    const layout = systemLayout(
      walk,
      roll,
      NO_CLASSES,
      VANILLA_MOON_SCALE,
      moved(2, null, 70, 180),
    );
    const planet = body(layout, 2);
    expect(planet.x).toBeCloseTo(-70);
    const moon = body(layout, 3);
    expect(moon.ring).toEqual({ cx: planet.x, cy: planet.y, radius: 5 });
    expect(moon.angle).toBe(90);
  });

  it("draws a planet given a parent as a moon about its host", () => {
    const layout = drawn(moved(5, 2, 25, 0));
    const host = body(layout, 2);
    const moon = body(layout, 5);
    expect(moon).toMatchObject({ parent: 2, moon: true, angle: 0 });
    expect(moon.ring).toEqual({ cx: host.x, cy: host.y, radius: 25 });
    expect(moon.x).toBeCloseTo(host.x + 25);
    expect(moon.y).toBeCloseTo(host.y);
  });

  it("draws a moon given the centre as a planet about it", () => {
    const layout = drawn(moved(3, null, 140, 10));
    expect(body(layout, 3)).toMatchObject({ parent: null, moon: false });
    expect(body(layout, 3).ring).toEqual({ cx: 0, cy: 0, radius: 140 });
  });

  it("draws the belts and the inner radius it names in place of the system's", () => {
    const layout = drawn({ belts: [{ kind: "icy_asteroid_belt", radius: 90 }], innerRadius: 260 });
    expect(layout.belts).toEqual([
      { kind: "icy_asteroid_belt", radius: 90, inner: 80, outer: 100 },
    ]);
    expect(layout.innerRadius).toBe(260);
    expect(body(layout, 2)).toEqual(body(drawn(), 2));
  });

  it("that names nothing returns the kept layout", () => {
    expect(drawn({})).toBe(drawn());
    expect(drawn({ bodies: new Map() })).not.toBe(drawn());
  });

  it("is laid out afresh each time, while the layout without one stays the kept one", () => {
    const base = drawn();
    expect(drawn()).toBe(base);
    const once = drawn(moved(5, null, 110, 90));
    expect(drawn(moved(5, null, 110, 90))).not.toBe(once);
    expect(drawn()).toBe(base);
    expect(body(base, 5).ring?.radius).toBe(100);
    expect([body(base, 2).x, body(base, 2).y]).toEqual(ORBIT_SYSTEM_AT.planet);
  });
});

describe("placeholderPlanets", () => {
  it("draws the planets a roll stands in for the game's on rings about the centre, none without them", () => {
    const roll = systemRoll({
      rolls_planets: true,
      placeholders: [{ class: "pc_barren", size: 10, orbit: 60, angle: 90 }],
    });
    const [planet] = placeholderPlanets(roll, NO_CLASSES);
    expect([Math.round(planet.x), Math.round(planet.y)]).toEqual([0, 60]);
    expect(planet.ring).toEqual({ cx: 0, cy: 0, radius: 60 });
    expect(planet.disc).toBe(discRadius(10));
    expect(placeholderPlanets(null, NO_CLASSES)).toEqual([]);
  });
});

describe("exitBearing", () => {
  it("points from this system's galaxy position to the neighbour's", () => {
    const sol = { x: 397, y: -180 };
    const east = exitBearing(sol, { x: 407, y: -180 });
    expect(east).toMatchObject({ dx: 1, dy: 0, angle: 0 });
    expect(east.rotation).toBeCloseTo(screen(1, 0));
    const diagonal = exitBearing(sol, { x: 367, y: -140 });
    expect(diagonal.dx).toBeCloseTo(-0.6);
    expect(diagonal.dy).toBeCloseTo(0.8);
    expect(diagonal.angle).toBeCloseTo((Math.atan2(0.8, -0.6) * 180) / Math.PI);
    expect(diagonal.rotation).toBeCloseTo(screen(-0.6, 0.8));
  });
});
