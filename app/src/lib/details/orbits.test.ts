import { describe, expect, it } from "vitest";
import type { BodyLayout } from "../../generated/BodyLayout";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import { planetSummary, systemDetails } from "../../test/builders";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../geometry/geometry";
import {
  BELT_BAND_WIDTH,
  FALLBACK_INNER_RADIUS,
  FIT_MARGIN,
  MOON_SCALE,
  ASTEROID_SCALE,
  STAR_SCALE,
  discRadius,
  exitBearing,
  fitScale,
  polar,
  systemLayout,
  zoomLimits,
  type BodyPlacement,
  type SystemLayout,
} from "./orbits";

/** A save body: at `at`, `orbit` from its parent, of `size`. */
function saveBody(
  id: number,
  planetClass: string,
  at: [number, number],
  orbit: number,
  size: number,
  parent: number | null = null,
): PlanetSummary {
  const layout: BodyLayout = {
    orbit: { min: orbit, max: orbit },
    angle: null,
    at,
    size: { min: size, max: size },
  };
  return planetSummary({ id, class: planetClass, parent, moon: parent !== null, orbit, layout });
}

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
  return systemLayout(
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
    expect(luna.ring).toEqual({ cx: EARTH_AT.x, cy: EARTH_AT.y, radius: 12 });
    expect(luna.disc).toBeCloseTo(discRadius(5, true));
    expect(luna.disc).toBeLessThan(earth.disc);
    expect(earth.disc + luna.disc).toBeLessThan(12);
  });

  it("puts Baxom's two stars on one ring of 25 either side of an empty centre", () => {
    const layout = systemLayout(
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
    const layout = systemLayout(
      systemDetails({
        id: 53,
        planets: [
          saveBody(1, "pc_m_star", [0, 0], 0, 30),
          saveBody(4, "pc_barren", [8 + 230, 30], 8, 5, 3),
          saveBody(3, "pc_arid", [230, 30], 30, 18, 2),
          saveBody(2, "pc_k_star", [230, 0], 230, 25),
        ],
      }),
    );
    expect(body(layout, 2).ring).toEqual({ cx: 0, cy: 0, radius: 230 });
    expect(body(layout, 3).ring).toEqual({ cx: 230, cy: 0, radius: 30 });
    expect(body(layout, 4).ring).toEqual({ cx: 230, cy: 30, radius: 8 });
    expect(body(layout, 3).disc).toBeCloseTo(discRadius(18, false));
    expect(body(layout, 4).disc).toBeCloseTo(discRadius(5, true));
  });

  it("keeps the point of a body whose parent is gone and draws no circle for it", () => {
    const layout = systemLayout(
      systemDetails({ planets: [saveBody(58, "pc_barren", [100, 20], 10, 6, 57)] }),
    );
    const orphan = body(layout, 58);
    expect([orphan.x, orphan.y]).toEqual([100, 20]);
    expect(orphan.ring).toBeNull();
    expect(orphan.parent).toBeNull();
  });

  it("falls back to the centre for a self-parent", () => {
    const layout = systemLayout(
      systemDetails({ planets: [saveBody(7, "pc_barren", [0, 40], 40, 6, 7)] }),
    );
    expect(body(layout, 7).ring).toEqual({ cx: 0, cy: 0, radius: 40 });
  });
});

describe("angles", () => {
  it("measures a body's angle about its parent as polar places it", () => {
    const at = polar(0, 0, 90, 0);
    expect(at).toEqual({ x: 90, y: 0 });
    const layout = systemLayout(
      systemDetails({ planets: [saveBody(1, "pc_arid", [at.x, at.y], 90, 10)] }),
    );
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
    const layout = systemLayout(
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
  const scenario = (
    id: number,
    layout: Partial<BodyLayout>,
    parent: number | null = null,
  ): PlanetSummary =>
    planetSummary({
      id,
      parent,
      layout: { orbit: null, angle: null, at: null, size: null, ...layout },
    });

  it("places a body at its orbit and angle about its parent, with bands, arcs and ghosts", () => {
    const layout = systemLayout(
      systemDetails({
        planets: [
          scenario(1, { orbit: null, angle: { min: 0, max: 0 } }),
          scenario(2, { orbit: { min: 50, max: 50 }, angle: { min: 90, max: 90 } }),
          scenario(3, { orbit: { min: 10, max: 10 }, angle: { min: 0, max: 0 } }, 2),
          scenario(4, { orbit: { min: 80, max: 120 }, angle: { min: 90, max: 270 } }),
          scenario(5, { orbit: { min: 150, max: 150 } }),
        ],
      }),
    );
    expect(body(layout, 1)).toMatchObject({ x: 0, y: 0, ring: null, ghost: false });
    const two = body(layout, 2);
    expect(two.x).toBeCloseTo(0);
    expect(two.y).toBeCloseTo(50);
    const three = body(layout, 3);
    expect(three.x).toBeCloseTo(10);
    expect(three.y).toBeCloseTo(50);
    expect(three.ring?.radius).toBe(10);
    expect(body(layout, 4)).toMatchObject({
      band: { inner: 80, outer: 120 },
      arc: { from: 90, to: 270 },
      ring: { cx: 0, cy: 0, radius: 100 },
    });
    expect(body(layout, 5)).toMatchObject({ ghost: true, ring: { radius: 150 } });
  });

  it("sits a body with no distance, or a distance of 0, on its parent's point, with no ring and no ghost", () => {
    const layout = systemLayout(
      systemDetails({
        planets: [
          scenario(1, {}),
          scenario(2, { orbit: { min: 0, max: 0 } }),
          scenario(3, { orbit: { min: 40, max: 40 }, angle: { min: 0, max: 0 } }),
          scenario(4, {}, 3),
          scenario(5, { orbit: { min: 0, max: 20 } }, 3),
        ],
      }),
    );
    expect(body(layout, 1)).toMatchObject({ x: 0, y: 0, ring: null, ghost: false });
    expect(body(layout, 2)).toMatchObject({ x: 0, y: 0, ring: null, ghost: false });
    expect(body(layout, 4)).toMatchObject({ x: 40, y: 0, ring: null, ghost: false });
    expect(body(layout, 5)).toMatchObject({
      band: { inner: 0, outer: 20 },
      ring: { cx: 40, cy: 0, radius: 10 },
      ghost: true,
    });
  });

  it("draws a ghost opposite the body placed on its ring, and ghosts sharing a ring evenly round it", () => {
    const layout = systemLayout(
      systemDetails({
        planets: [
          scenario(1, { orbit: { min: 25, max: 25 }, angle: { min: 0, max: 0 } }),
          scenario(2, { orbit: { min: 25, max: 25 } }),
          scenario(3, { orbit: { min: 60, max: 60 } }),
          scenario(4, { orbit: { min: 60, max: 60 } }),
          scenario(5, { orbit: { min: 60, max: 60 } }),
        ],
      }),
      { scenario: true },
    );
    const at = (id: number) => [body(layout, id).x, body(layout, id).y];
    const near = (a: number[], b: { x: number; y: number }) => {
      expect(a[0]).toBeCloseTo(b.x);
      expect(a[1]).toBeCloseTo(b.y);
    };
    near(at(2), polar(0, 0, 25, 180));
    near(at(3), polar(0, 0, 60, 0));
    near(at(4), polar(0, 0, 60, 120));
    near(at(5), polar(0, 0, 60, 240));
    expect(body(layout, 4).angle).toBeCloseTo(120);
  });

  it("shares a ring out between bodies whose angle ranges over a turn or more, as between ghosts", () => {
    const layout = systemLayout(
      systemDetails({
        planets: [
          scenario(1, { orbit: { min: 95, max: 95 }, angle: { min: 271, max: 811 } }),
          scenario(2, { orbit: { min: 95, max: 95 }, angle: { min: 91, max: 991 } }),
        ],
      }),
      { scenario: true },
    );
    const [a, b] = [body(layout, 1), body(layout, 2)];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(190);
    expect(a.ghost).toBe(false);
    expect(a.arc).toEqual({ from: 271, to: 811 });
  });

  it("puts a ghost in the widest gap the placed bodies on its ring leave, never on one of them", () => {
    const layout = systemLayout(
      systemDetails({
        planets: [
          scenario(1, { orbit: { min: 40, max: 40 }, angle: { min: 0, max: 0 } }),
          scenario(2, { orbit: { min: 40, max: 40 }, angle: { min: 240, max: 240 } }),
          scenario(3, { orbit: { min: 40, max: 40 } }),
        ],
      }),
      { scenario: true },
    );
    expect(body(layout, 3).angle).toBeCloseTo(120);
  });

  it("leaves a save's bodies with no point where they were drawn before, at angle 0 on their orbit", () => {
    const pointless = (id: number) =>
      planetSummary({
        id,
        orbit: 50,
        layout: { orbit: { min: 50, max: 50 }, angle: null, at: null, size: null },
      });
    const layout = systemLayout(systemDetails({ planets: [pointless(1), pointless(2)] }));
    for (const id of [1, 2]) {
      expect(body(layout, id).x).toBeCloseTo(50);
      expect(body(layout, id).y).toBeCloseTo(0);
    }
  });

  it("draws a ranged size at the middle of its range", () => {
    const layout = systemLayout(
      systemDetails({
        planets: [
          scenario(1, {
            orbit: { min: 50, max: 50 },
            angle: { min: 0, max: 0 },
            size: { min: 10, max: 20 },
          }),
        ],
      }),
    );
    expect(body(layout, 1).disc).toBeCloseTo(discRadius(15, false));
  });
});

describe("belts, fit and zoom", () => {
  it("centres each belt's band on its radius", () => {
    expect(sol().belts).toEqual([
      {
        kind: "rocky_asteroid_belt",
        radius: 145,
        inner: 145 - BELT_BAND_WIDTH / 2,
        outer: 145 + BELT_BAND_WIDTH / 2,
      },
      {
        kind: "icy_asteroid_belt",
        radius: 290,
        inner: 290 - BELT_BAND_WIDTH / 2,
        outer: 290 + BELT_BAND_WIDTH / 2,
      },
    ]);
  });

  it("fits to the inner radius, the outermost belt or the outermost body, whichever reaches furthest", () => {
    expect(sol().fitRadius).toBe(350 + FIT_MARGIN);
    const noInner = systemLayout(
      systemDetails({ belts: [{ kind: "rocky_asteroid_belt", inner_radius: 290 }] }),
    );
    expect(noInner.fitRadius).toBe(
      Math.max(FALLBACK_INNER_RADIUS, 290 + BELT_BAND_WIDTH / 2) + FIT_MARGIN,
    );
    const far = systemLayout(
      systemDetails({
        planets: [
          saveBody(1, "pc_k_star", [230, 0], 230, 20),
          saveBody(2, "pc_arid", [230, 30], 30, 18, 1),
        ],
        inner_radius: 200,
      }),
    );
    expect(far.fitRadius).toBe(230 + 30 + FIT_MARGIN);
    expect(systemLayout(null).fitRadius).toBe(FALLBACK_INNER_RADIUS + FIT_MARGIN);
  });

  it("zooms out to half the fit and in until the largest disc fills the short side", () => {
    expect(fitScale(200, 800, 600)).toBe(1.5);
    expect(zoomLimits(200, 800, 600, 9)).toEqual({ minScale: 0.75, maxScale: 600 / 18 });
    expect(sol().largestDisc).toBe(discRadius(30, false, "pc_g_star", true));
  });

  it("draws a star STAR_SCALE times a planet of its size, and a brown dwarf as a planet", () => {
    expect(discRadius(20, false, "pc_m_star", true)).toBeCloseTo(
      discRadius(20, false) * STAR_SCALE,
    );
    // The game draws a brown dwarf with a planet's model, at a planet's size.
    expect(discRadius(20, false, "pc_t_star", true)).toBeCloseTo(discRadius(20, false));
  });

  it("scales a moon's disc by MOON_SCALE", () => {
    expect(discRadius(10, true)).toBeCloseTo(discRadius(10, false) * MOON_SCALE);
  });

  it("draws an asteroid larger than its size gives, whatever its asteroid class", () => {
    expect(discRadius(5, false, "pc_asteroid")).toBeCloseTo(discRadius(5, false) * ASTEROID_SCALE);
    expect(discRadius(5, false, "pc_ice_asteroid")).toBeCloseTo(
      discRadius(5, false) * ASTEROID_SCALE,
    );
    expect(discRadius(5, false, "pc_barren")).toBe(discRadius(5, false));
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
