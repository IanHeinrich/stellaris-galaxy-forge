import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/textures", () => ({ getTextures: () => new Promise(() => {}) }));

import { BitmapText, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { BodyLayout } from "../../generated/BodyLayout";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarClassView } from "../../generated/StarClassView";
import {
  byId,
  placedNode,
  planetClassView,
  planetSummary,
  starClassView,
  systemDetails,
} from "../../test/builders";
import { NO_SOURCES, systemContext, type SceneBody, type SystemContext } from "./context";
import { stubTextMeasurement, viewport } from "./fixture";
import { BodiesLayer } from "./layers/BodiesLayer";
import { LabelsLayer } from "./layers/LabelsLayer";
import type { SceneTextures } from "./layers/textures";

stubTextMeasurement();

const SYSTEM = 5;
const INITIALIZER = "parity_init";

const fixed = (value: number) => ({ min: value, max: value });

const STAR_CLASSES: ReadonlyMap<string, StarClassView> = new Map(
  [
    starClassView("sc_g", "pc_g_star"),
    starClassView("sc_a", "pc_a_star"),
    starClassView("sc_b", "pc_b_star"),
    starClassView("sc_pulsar", "pc_pulsar"),
    starClassView("sc_black_hole", "pc_black_hole"),
    starClassView("sc_t", "pc_t_star"),
    starClassView("sc_binary_ab", "pc_a_star", "pc_b_star"),
  ].map((view) => [view.key, view]),
);

const iconed = (key: string): PlanetClassView => ({
  ...planetClassView(key, false),
  icon_sprite: `GFX_${key}`,
});

const PLANET_CLASSES: ReadonlyMap<string, PlanetClassView> = new Map(
  [
    ...["pc_g_star", "pc_a_star", "pc_b_star", "pc_pulsar", "pc_black_hole", "pc_t_star"].map(
      (key) => planetClassView(key),
    ),
    ...["pc_continental", "pc_barren", "pc_broken", "pc_asteroid"].map(iconed),
  ].map((view) => [view.key, view]),
);

/** A body as a save writes it: its own class, its point and its orbit. */
interface Placed {
  id: number;
  saveClass: string;
  /** The class an initializer writes for it: the system's star class for its star. */
  scenarioClass: string;
  orbit: number;
  angle: number;
  size: number;
  parent?: number;
  ring?: boolean;
  deposits?: PlanetSummary["deposits"];
}

function pointOf(body: Placed, bodies: readonly Placed[]): [number, number] {
  const parent = bodies.find((b) => b.id === body.parent);
  const [cx, cy] = parent ? pointOf(parent, bodies) : [0, 0];
  const a = (body.angle * Math.PI) / 180;
  return [cx + body.orbit * Math.cos(a), cy + body.orbit * Math.sin(a)];
}

function summary(body: Placed, planetClass: string, layout: BodyLayout): PlanetSummary {
  return planetSummary({
    id: body.id,
    class: planetClass,
    parent: body.parent ?? null,
    moon: body.parent !== undefined,
    layout,
    ring: body.ring ?? false,
    deposits: body.deposits ?? [],
  });
}

const sources = {
  ...NO_SOURCES,
  id: SYSTEM,
  starClasses: STAR_CLASSES,
  planetClasses: PLANET_CLASSES,
  gameDataReady: true,
  detailsShown: true,
};

/** The system as a save holds it: the star class on the system and every body at its point. */
function asSave(starClass: string, bodies: readonly Placed[]): SystemContext {
  const planets = bodies.map((b) =>
    summary(b, b.saveClass, {
      orbit: fixed(b.orbit),
      angle: null,
      at: pointOf(b, bodies),
      size: fixed(b.size),
    }),
  );
  return systemContext({
    ...sources,
    kind: "save",
    systems: byId({ ...placedNode(SYSTEM, 0, 0), star_class: starClass, initializer: INITIALIZER }),
    details: systemDetails({ id: SYSTEM, planets }),
  });
}

/**
 * The same system as a scenario holds it: no star class of its own, the initializer's, and
 * every body at a fixed orbit and angle about its parent.
 */
function asScenario(starClass: string, bodies: readonly Placed[]): SystemContext {
  const planets = bodies.map((b) =>
    summary(b, b.scenarioClass, {
      orbit: fixed(b.orbit),
      angle: fixed(b.angle),
      at: null,
      size: fixed(b.size),
    }),
  );
  return systemContext({
    ...sources,
    kind: "scenario",
    systems: byId({ ...placedNode(SYSTEM, 0, 0), star_class: "", initializer: INITIALIZER }),
    details: systemDetails({ id: SYSTEM, planets, with_game_data: true }),
    initializerClasses: new Map([[INITIALIZER, starClass]]),
  });
}

/** Every number rounded, so a point placed by angle and one saved by coordinate compare equal. */
function rounded(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 1e6) / 1e6 + 0;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  }
  return value;
}

/**
 * A body as the scene resolved it, without the source record it was resolved from, or the steps
 * from the body before it that only a scenario gives.
 */
function resolved(body: SceneBody): unknown {
  const { placement } = body;
  const radius = placement.radius && { ...placement.radius, step: null };
  return rounded({ ...body, planet: null, placement: { ...placement, radius, turn: null } });
}

function blankTextures(): SceneTextures {
  const t = () => new Texture();
  return {
    disc: t(),
    nebula: t(),
    glow: t(),
    corona: t(),
    beam: t(),
    plume: t(),
    halo: t(),
    swirl: t(),
    wisps: t(),
    shade: t(),
    gloss: t(),
    rock: t(),
    ringBack: t(),
    ringFront: t(),
  };
}

/** What the bodies layer draws for each body: where, and each part's look. */
function drawn(ctx: SystemContext): unknown {
  const layer = new BodiesLayer(blankTextures());
  layer.rebuild(ctx);
  viewport(layer, 2);
  const parts = layer.container.children.map((holder) => ({
    at: [holder.x, holder.y],
    parts: (holder as Container).children.map((c) => ({
      label: c.label,
      kind:
        c instanceof Sprite ? "sprite" : c instanceof Graphics ? "graphics" : c.constructor.name,
      text: c instanceof BitmapText ? c.text : null,
      tint: c instanceof Sprite ? c.tint : null,
      alpha: c.alpha,
      visible: c.visible,
      blend: c.blendMode,
      width: c.width,
      rotation: c.rotation,
    })),
  }));
  layer.destroy();
  return rounded(parts);
}

/** The plates the labels layer shows: each body's name and its resource cells. */
function plates(ctx: SystemContext): unknown {
  const layer = new LabelsLayer();
  layer.rebuild(ctx);
  viewport(layer, 2);
  const shown = layer.container.children.map((holder) =>
    (holder as Container).children.map((c) => c.label),
  );
  layer.destroy();
  return shown;
}

function expectParity(starClass: string, bodies: readonly Placed[]): void {
  const save = asSave(starClass, bodies);
  const scenario = asScenario(starClass, bodies);
  expect(scenario.bodies.map(resolved)).toEqual(save.bodies.map(resolved));
  expect(drawn(scenario)).toEqual(drawn(save));
  expect(plates(scenario)).toEqual(plates(save));
}

const star = (saveClass: string, starClass: string, size = 20): Placed => ({
  id: 1,
  saveClass,
  scenarioClass: starClass,
  orbit: 0,
  angle: 0,
  size,
});

describe("a system drawn from a save and from a scenario", () => {
  it("resolves and draws a G star, a ringed planet with its moon and an asteroid alike", () => {
    expectParity("sc_g", [
      star("pc_g_star", "sc_g"),
      {
        id: 2,
        saveClass: "pc_continental",
        scenarioClass: "pc_continental",
        orbit: 90,
        angle: 0,
        size: 16,
        ring: true,
        deposits: [{ resource: "food", amount: 3 }],
      },
      {
        id: 3,
        saveClass: "pc_barren",
        scenarioClass: "pc_barren",
        orbit: 12,
        angle: 0,
        size: 5,
        parent: 2,
      },
      {
        id: 4,
        saveClass: "pc_asteroid",
        scenarioClass: "pc_asteroid",
        orbit: 130,
        angle: 90,
        size: 5,
      },
    ]);
  });

  it("resolves and draws a pulsar alike, surface bake and beams included", () => {
    const planet: Placed = {
      id: 2,
      saveClass: "pc_barren",
      scenarioClass: "pc_barren",
      orbit: 70,
      angle: 45,
      size: 12,
    };
    expectParity("sc_pulsar", [star("pc_pulsar", "sc_pulsar"), planet]);
    const [pulsar] = asScenario("sc_pulsar", [star("pc_pulsar", "sc_pulsar"), planet]).bodies;
    expect(pulsar.look.surfaceKey).toBe("star_disc:pc_pulsar");
    expect(pulsar.look.flare).toBe("pulsar");
  });

  it("resolves and draws a black hole alike, black with its planet out on its orbit", () => {
    const broken: Placed = {
      id: 2,
      saveClass: "pc_broken",
      scenarioClass: "pc_broken",
      orbit: 60,
      angle: 0,
      size: 10,
    };
    expectParity("sc_black_hole", [star("pc_black_hole", "sc_black_hole", 30), broken]);
    const [hole, planet] = asScenario("sc_black_hole", [
      star("pc_black_hole", "sc_black_hole", 30),
      broken,
    ]).bodies;
    expect(hole.look.blackHole).toBe(true);
    expect(hole.look.surfaceKey).toBeNull();
    expect(Math.hypot(planet.placement.x, planet.placement.y)).toBeGreaterThan(
      hole.placement.disc + planet.placement.disc,
    );
  });

  it("resolves and draws a binary alike, each star as the class's planet in turn", () => {
    const binary = [
      { ...star("pc_a_star", "sc_binary_ab", 30), orbit: 25 },
      { ...star("pc_b_star", "sc_binary_ab", 20), id: 2, orbit: 25, angle: 180 },
    ];
    expectParity("sc_binary_ab", binary);
    const stars = asScenario("sc_binary_ab", binary).bodies;
    expect(stars.map((b) => [b.surfaceClass, b.starClass])).toEqual([
      ["pc_a_star", "sc_a"],
      ["pc_b_star", "sc_b"],
    ]);
  });

  it("leaves a save body with no class a planet, not a star", () => {
    const ctx = asSave("sc_g", [
      star("pc_g_star", "sc_g"),
      { id: 2, saveClass: "", scenarioClass: "", orbit: 50, angle: 0, size: 10 },
    ]);
    expect(ctx.bodies.map((b) => [b.placement.star, b.starClass])).toEqual([
      [true, "sc_g"],
      [false, null],
    ]);
  });

  it("resolves and draws a brown dwarf alike, sized as a planet", () => {
    expectParity("sc_t", [star("pc_t_star", "sc_t", 16)]);
  });
});

describe("what a scenario leaves to chance", () => {
  const scenario = (planets: PlanetSummary[], starClass = "sc_g") =>
    systemContext({
      ...sources,
      kind: "scenario",
      systems: byId({ ...placedNode(SYSTEM, 0, 0), star_class: "", initializer: INITIALIZER }),
      details: systemDetails({ id: SYSTEM, planets, with_game_data: true }),
      initializerClasses: new Map([[INITIALIZER, starClass]]),
    });
  const body = (id: number, planetClass: string, layout: Partial<BodyLayout>) =>
    planetSummary({
      id,
      class: planetClass,
      layout: { orbit: null, angle: null, at: null, size: fixed(12), ...layout },
      ring: false,
    });
  const sun = body(1, "sc_g", { orbit: fixed(0), angle: fixed(0) });

  it("stands the bodies a count spawns with no angle apart, each with one plate showing its deposits once", () => {
    const twin = (id: number) => ({
      ...body(id, "pc_barren", { orbit: fixed(45) }),
      deposits: [
        { resource: "food", amount: 3 },
        { resource: "energy", amount: 1 },
      ],
    });
    const ctx = scenario([sun, twin(2), twin(3)]);
    const [, a, b] = ctx.bodies;
    expect(
      Math.hypot(a.placement.x - b.placement.x, a.placement.y - b.placement.y),
    ).toBeGreaterThan(a.placement.disc + b.placement.disc);
    const layer = new LabelsLayer();
    layer.rebuild(ctx);
    viewport(layer, 2);
    const labelled = (holder: Container, label: string) =>
      holder.children.filter((c) => c.label === label).length;
    const holders = layer.container.children as Container[];
    expect(holders.map((h) => [labelled(h, "plate"), labelled(h, "resource")])).toEqual([
      [1, 0],
      [1, 2],
      [1, 2],
    ]);
    expect(new Set(layer.plates().map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)).size).toBe(
      layer.plates().length,
    );
    layer.destroy();
  });

  it("marks a class the install does not define, a planet list or the empire's ideal class, as a draw", () => {
    const ctx = scenario([
      sun,
      body(2, "rl_unhabitable_planets", { orbit: fixed(60), angle: fixed(0) }),
      body(3, "ideal_planet_class", { orbit: fixed(90), angle: fixed(0) }),
      body(4, "pc_barren", { orbit: fixed(120), angle: fixed(0) }),
    ]);
    expect(ctx.bodies.map((b) => b.chance.planetClass)).toEqual([false, true, true, false]);
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(ctx);
    viewport(layer, 2);
    const glyphs = (layer.container.children as Container[]).map(
      (h) => h.children.filter((c) => c instanceof BitmapText).length,
    );
    expect(glyphs.sort()).toEqual([0, 0, 1, 1]);
    layer.destroy();
  });

  it("leaves a drawn class's ring to its question mark, and dashes a known class's ring left to chance", () => {
    const unset = (id: number, planetClass: string) => ({
      ...body(id, planetClass, { orbit: fixed(40 * id), angle: fixed(0) }),
      ring: null,
    });
    const ctx = scenario([sun, unset(2, "random"), unset(3, "pc_barren")]);
    const [, drawnClass, known] = ctx.bodies;
    expect([drawnClass.ring, drawnClass.chance.ring]).toEqual([false, false]);
    expect([known.ring, known.chance.ring]).toEqual([true, true]);
  });

  it("draws a scenario system still loading as its initializer's star, with no question mark", () => {
    const ctx = systemContext({
      ...sources,
      kind: "scenario",
      systems: byId({ ...placedNode(SYSTEM, 0, 0), star_class: "", initializer: INITIALIZER }),
      details: null,
      loading: true,
      initializerClasses: new Map([[INITIALIZER, "sc_pulsar"]]),
    });
    const [pulsar] = ctx.bodies;
    expect(pulsar.surfaceClass).toBe("pc_pulsar");
    expect(pulsar.chance.planetClass).toBe(false);
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(ctx);
    viewport(layer, 2);
    const holder = layer.container.children[0] as Container;
    expect(holder.children.some((c) => c instanceof BitmapText)).toBe(false);
    expect(holder.children.map((c) => c.label)).toContain("beams");
    layer.destroy();
  });
});

describe("orbit radius readouts", () => {
  it("reads a save body's radius rounded", () => {
    const ctx = asSave("sc_g", [
      star("pc_g_star", "sc_g"),
      {
        id: 2,
        saveClass: "pc_barren",
        scenarioClass: "pc_barren",
        orbit: 120.43,
        angle: 0,
        size: 10,
      },
    ]);
    expect(ctx.bodies.map((b) => b.readout?.text ?? null)).toEqual([null, "120"]);
  });

  it("reads a scenario body's radius alone, a range's two ends, and a moon's from its planet", () => {
    const body = (id: number, orbit: { min: number; max: number }, parent: number | null = null) =>
      planetSummary({
        id,
        class: id === 1 ? "sc_g" : "pc_barren",
        parent,
        layout: { orbit, angle: fixed(0), at: null, size: fixed(10) },
        ring: false,
      });
    const ctx = systemContext({
      ...sources,
      kind: "scenario",
      systems: byId({ ...placedNode(SYSTEM, 0, 0), star_class: "", initializer: INITIALIZER }),
      details: systemDetails({
        id: SYSTEM,
        with_game_data: true,
        planets: [
          body(1, fixed(0)),
          body(2, { min: 65, max: 80 }),
          body(3, fixed(10), 2),
          body(4, fixed(18), 2),
          body(5, { min: 85, max: 105 }),
        ],
      }),
      initializerClasses: new Map([[INITIALIZER, "sc_g"]]),
    });
    expect(ctx.bodies.map((b) => b.readout?.text ?? null)).toEqual([
      null,
      "65–80",
      "10",
      "18",
      "85–105",
    ]);
    const [sun, planet, moon] = ctx.bodies;
    expect(planet.readout?.hub).toBe(sun.placement.disc);
    expect(moon.readout?.hub).toBe(planet.placement.disc);
  });
});

describe("a scenario system drawn as one roll of its initializer", () => {
  const turning = (
    id: number,
    orbit: { min: number; max: number },
    angle: { min: number; max: number },
  ) =>
    planetSummary({
      id,
      class: id === 1 ? "sc_g" : "pc_barren",
      layout: { orbit, angle, at: null, size: fixed(10) },
      ring: false,
    });
  const rolled = (roll: number) =>
    systemContext({
      ...sources,
      kind: "scenario",
      roll,
      systems: byId({ ...placedNode(SYSTEM, 0, 0), star_class: "", initializer: INITIALIZER }),
      details: systemDetails({
        id: SYSTEM,
        with_game_data: true,
        planets: [
          turning(1, fixed(0), fixed(0)),
          turning(2, { min: 40, max: 60 }, { min: 90, max: 270 }),
          turning(3, { min: 70, max: 100 }, { min: 180, max: 540 }),
        ],
      }),
      initializerClasses: new Map([[INITIALIZER, "sc_g"]]),
    });
  const points = (ctx: SystemContext) => ctx.bodies.map((b) => [b.placement.x, b.placement.y]);

  it("draws the same roll for the same counter, and another once Roll again moves it", () => {
    expect(points(rolled(0))).toEqual(points(rolled(0)));
    expect(points(rolled(1))).not.toEqual(points(rolled(0)));
  });
});

describe("planets the game rolls", () => {
  /** A scenario system whose initializer, read with the install, gave no record. */
  const rolling = (over: Partial<typeof sources> = {}) =>
    systemContext({
      ...sources,
      kind: "scenario",
      systems: byId(
        ...[SYSTEM, SYSTEM + 1, SYSTEM + 2].map((id) => ({
          ...placedNode(id, 0, 0),
          star_class: "sc_g",
          initializer: "",
        })),
      ),
      details: null,
      missing: true,
      ...over,
    });

  it("draws three to six on rings inside the inner radius for a scenario system whose initializer gives no record, the same for the same system", () => {
    for (const id of [SYSTEM, SYSTEM + 1, SYSTEM + 2]) {
      const { rolled, layout } = rolling({ id });
      expect(rolled.length).toBeGreaterThanOrEqual(3);
      expect(rolled.length).toBeLessThanOrEqual(6);
      for (const planet of rolled) {
        expect(Math.hypot(planet.x, planet.y)).toBeCloseTo(planet.ring.radius);
        expect(planet.ring.radius + planet.disc).toBeLessThan(layout.innerRadius);
      }
    }
    expect(rolling().rolled).toEqual(rolling().rolled);
    expect(rolling({ id: SYSTEM + 1 }).rolled).not.toEqual(rolling().rolled);
  });

  it("draws none for a save, for an initializer the install defines, or before game data is read", () => {
    expect(rolling({ kind: "save" }).rolled).toEqual([]);
    expect(rolling({ gameDataReady: false }).rolled).toEqual([]);
    const known = rolling({
      missing: false,
      details: systemDetails({
        id: SYSTEM,
        with_game_data: true,
        planets: [planetSummary({ id: 1, class: "sc_g", layout: null })],
      }),
    });
    expect(known.rolled).toEqual([]);
  });

  it("never counts them among the bodies, which picking and the labels read", () => {
    const ctx = rolling();
    expect(ctx.rolled.length).toBeGreaterThan(0);
    expect(ctx.bodies).toHaveLength(1);
    expect(ctx.bodies[0].placement.star).toBe(true);
  });
});
