import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/textures", () => ({ getTextures: () => new Promise(() => {}) }));

import { BitmapText, Container } from "pixi.js";
import type { BodyLayout } from "../../generated/BodyLayout";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarClassView } from "../../generated/StarClassView";
import type { SystemRoll } from "../../generated/SystemRoll";
import {
  bodyLayout,
  byId,
  placedNode,
  planetClassView,
  planetSummary,
  starClassView,
  systemDetails,
} from "../../test/builders";
import { systemRoll } from "../../test/rolls";
import { systemContext } from "./context";
import {
  blankSceneTextures,
  context as fixtureContext,
  fixed,
  rollOf,
  SYSTEM,
  stubTextMeasurement,
  viewport,
} from "./fixture";
import { BodiesLayer } from "./layers/BodiesLayer";
import { LabelsLayer } from "./layers/LabelsLayer";
import { NO_SOURCES, type SystemSources } from "./sources";

stubTextMeasurement();

const INITIALIZER = "context_init";

const STAR_CLASSES: ReadonlyMap<string, StarClassView> = new Map(
  [
    starClassView("sc_g", "pc_g_star"),
    starClassView("sc_a", "pc_a_star"),
    starClassView("sc_b", "pc_b_star"),
    starClassView("sc_pulsar", "pc_pulsar"),
    starClassView("sc_binary_ab", "pc_a_star", "pc_b_star"),
  ].map((view) => [view.key, view]),
);

const sources: SystemSources = {
  ...NO_SOURCES,
  id: SYSTEM,
  starClasses: STAR_CLASSES,
  planetClasses: new Map(
    ["pc_a_star", "pc_b_star", "pc_g_star", "pc_pulsar"]
      .map((key) => planetClassView(key))
      .concat(["pc_barren", "pc_continental"].map((key) => planetClassView(key, false)))
      .map((view) => [view.key, view]),
  ),
  gameDataReady: true,
  sceneLayers: { ...NO_SOURCES.sceneLayers, details: true },
};

/** A save system: its star at the centre and each body at its point. */
function save(planets: PlanetSummary[], over: Partial<SystemSources> = {}) {
  return systemContext({
    ...sources,
    kind: "save",
    systems: byId({ ...placedNode(SYSTEM, 0, 0), star_class: "sc_g" }),
    details: systemDetails({ id: SYSTEM, planets }),
    ...over,
  });
}

/** A scenario system of `planets` drawn in `roll`, its initializer's star class `sc_g`. */
function scenario(planets: PlanetSummary[] | null, roll: SystemRoll | null, over = {}) {
  return systemContext({
    ...sources,
    kind: "scenario",
    systems: byId({ ...placedNode(SYSTEM, 0, 0), star_class: "", initializer: INITIALIZER }),
    details: planets && systemDetails({ id: SYSTEM, planets, with_game_data: true }),
    initializerClasses: new Map([[INITIALIZER, "sc_g"]]),
    roll,
    ...over,
  });
}

/** A scenario body of size 12 with no ring. */
const body = (id: number, planetClass: string, layout: Partial<BodyLayout>, over = {}) =>
  planetSummary({
    id,
    class: planetClass,
    layout: bodyLayout({ size: fixed(12), ...layout }),
    ring: false,
    ...over,
  });

const sun = planetSummary({
  id: 1,
  class: "pc_g_star",
  star_class: "sc_g",
  layout: bodyLayout({ orbit: fixed(0), at: [0, 0], size: fixed(20) }),
});

const scenarioSun = body(1, "pc_g_star", { orbit: fixed(0) }, { star_class: "sc_g" });

describe("the bodies of a system", () => {
  it("draws a planet a pre-FTL civilisation owns with no colony bar, and a colony with its owner's colour", () => {
    const owned = (id: number, preFtl: boolean) =>
      planetSummary({
        id,
        class: "pc_continental",
        owner: 9,
        colonised: true,
        pre_ftl: preFtl,
        layout: bodyLayout({ orbit: fixed(40 * id), at: [40 * id, 0], size: fixed(16) }),
      });
    const ownership = {
      owners: new Map<number, number>(),
      table: new Map([
        [9, { id: 9, label: "", kind: "country" as const, colors: { outline: 0x123456, fill: 0 } }],
      ]),
    };
    const ctx = save([sun, owned(2, false), owned(3, true)], { ownership });
    expect(ctx.bodies.map((b) => b.colony)).toEqual([null, 0x123456, null]);
  });

  it("draws and sizes a body whose parent is missing as the moon the core says it is", () => {
    const orphan = planetSummary({
      id: 2,
      class: "pc_barren",
      parent: 44,
      moon: true,
      layout: bodyLayout({ orbit: fixed(12), at: [60, 0], size: fixed(10) }),
    });
    const planet = { ...orphan, id: 3, parent: null, moon: false };
    const ctx = save([sun, orphan, planet]);
    const [, moon, world] = ctx.bodies;
    expect([moon.moon, world.moon]).toEqual([true, false]);
    expect([moon.placement.moon, world.placement.moon]).toEqual([true, false]);
    expect(moon.placement.disc).toBeLessThan(world.placement.disc);
  });

  it("leaves a save body with no class a planet, not a star", () => {
    const blank = planetSummary({
      id: 2,
      class: "",
      layout: bodyLayout({ orbit: fixed(50), at: [50, 0], size: fixed(10) }),
    });
    expect(save([sun, blank]).bodies.map((b) => [b.placement.star, b.starClass])).toEqual([
      [true, "sc_g"],
      [false, null],
    ]);
  });

  it("draws both stars of a binary scenario system still loading", () => {
    const ctx = scenario(null, null, {
      initializerClasses: new Map([[INITIALIZER, "sc_binary_ab"]]),
    });
    expect(ctx.bodies.map((b) => [b.surfaceClass, b.starClass])).toEqual([
      ["pc_a_star", "sc_a"],
      ["pc_b_star", "sc_b"],
    ]);
  });

  it("draws a scenario system still loading as its initializer's star, with no question mark", () => {
    const ctx = scenario(null, null, {
      initializerClasses: new Map([[INITIALIZER, "sc_pulsar"]]),
    });
    const [pulsar] = ctx.bodies;
    expect(pulsar.starClass).toBe("sc_pulsar");
    expect(pulsar.surfaceClass).toBe("pc_pulsar");
    expect(pulsar.chance.planetClass).toBe(false);
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(ctx);
    viewport(layer, 2);
    const holder = layer.container.children[0] as Container;
    expect(holder.children.some((c) => c instanceof BitmapText)).toBe(false);
    expect(holder.children.map((c) => c.label)).toContain("beams");
    layer.destroy();
  });

  it("keeps the layout, bodies and exits it drew while nothing they are drawn from changes", () => {
    const planets = [scenarioSun, body(2, "pc_barren", { orbit: fixed(60) })];
    const shown = scenario(planets, rollOf(planets));
    const again = systemContext({
      ...shown,
      sceneLayers: { ...sources.sceneLayers, labels: false },
    });
    expect(again.layout).toBe(shown.layout);
    expect(again.bodies).toBe(shown.bodies);
    expect(again.exits).toBe(shown.exits);
    expect(again.bodyById.get(2)).toBe(shown.bodies[1]);
    const rolled = systemContext({ ...shown, roll: rollOf(planets, { 2: 90 }) });
    expect(rolled.layout).not.toBe(shown.layout);
    expect(rolled.bodies).not.toBe(shown.bodies);
    expect(rolled.exits).toBe(shown.exits);
  });
});

describe("what a scenario leaves to chance", () => {
  it("gives each body a count spawns one plate, showing its deposits once", () => {
    const twin = (id: number) => ({
      ...body(id, "pc_barren", { orbit: fixed(45) }),
      deposits: [
        { resource: "food", amount: 3 },
        { resource: "energy", amount: 1 },
      ],
    });
    const planets = [scenarioSun, twin(2), twin(3)];
    const ctx = scenario(planets, rollOf(planets, { 2: 0, 3: 180 }));
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
    layer.destroy();
  });

  it("marks a class the core says is a draw with a question mark", () => {
    const planets = [
      scenarioSun,
      body(2, "rl_unhabitable_planets", { orbit: fixed(60) }, { drawn: true }),
      body(3, "ideal_planet_class", { orbit: fixed(90) }, { drawn: true }),
      body(4, "pc_barren", { orbit: fixed(120) }),
    ];
    const ctx = scenario(planets, rollOf(planets));
    expect(ctx.bodies.map((b) => b.chance.planetClass)).toEqual([false, true, true, false]);
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(ctx);
    viewport(layer, 2);
    const glyphs = (layer.container.children as Container[]).map(
      (h) => h.children.filter((c) => c instanceof BitmapText).length,
    );
    expect(glyphs.sort()).toEqual([0, 0, 1, 1]);
    layer.destroy();
  });

  it("leaves a drawn class's ring to its question mark, and dashes a known class's ring left to chance", () => {
    const planets = [
      scenarioSun,
      body(2, "random", { orbit: fixed(80) }, { ring: null, drawn: true }),
      body(3, "pc_barren", { orbit: fixed(120) }, { ring: null }),
    ];
    const [, drawnClass, known] = scenario(planets, rollOf(planets)).bodies;
    expect([drawnClass.ring, drawnClass.chance.ring]).toEqual([false, false]);
    expect([known.ring, known.chance.ring]).toEqual([true, true]);
  });
});

describe("orbit radius readouts", () => {
  it("reads a save body's radius rounded", () => {
    const barren = planetSummary({
      id: 2,
      class: "pc_barren",
      layout: bodyLayout({ orbit: fixed(120.43), at: [120.43, 0], size: fixed(10) }),
    });
    expect(save([sun, barren]).bodies.map((b) => b.readout?.text ?? null)).toEqual([null, "120"]);
  });

  it("reads a scenario body's radius alone, a range's two ends, and a moon's from its planet", () => {
    const planets = [
      scenarioSun,
      body(2, "pc_barren", { orbit: { min: 65, max: 80 } }),
      body(3, "pc_barren", { orbit: fixed(10) }, { parent: 2, moon: true }),
      body(4, "pc_barren", { orbit: fixed(18) }, { parent: 2, moon: true }),
      body(5, "pc_barren", { orbit: { min: 85, max: 105 } }),
    ];
    const ctx = scenario(planets, rollOf(planets, { 5: 180 }));
    expect(ctx.bodies.map((b) => b.readout?.text ?? null)).toEqual([
      null,
      "65–80",
      "10",
      "18",
      "85–105",
    ]);
    const [star, planet, moon] = ctx.bodies;
    expect(planet.readout?.hub).toBe(star.placement.disc);
    expect(moon.readout?.hub).toBe(planet.placement.disc);
  });
});

describe("planets the game rolls", () => {
  const rolling = systemRoll({
    system: SYSTEM,
    rolls_planets: true,
    placeholders: [
      { class: "pc_barren", size: 10, orbit: 50, angle: 0 },
      { class: "pc_continental", size: 16, orbit: 90, angle: 120 },
    ],
  });

  it("draws the roll's planets on their rings for a system whose record is not in, never among its bodies", () => {
    const ctx = scenario(null, rolling);
    expect(ctx.rolled.map((p) => Math.round(p.ring.radius))).toEqual([50, 90]);
    expect(ctx.bodies).toHaveLength(1);
    expect(ctx.bodies[0].placement.star).toBe(true);
  });

  it("draws the galaxy's star and the roll's planets for an initializer placing its bodies through an inline_script", () => {
    const ctx = scenario([], rolling, {
      details: systemDetails({
        id: SYSTEM,
        planets: [],
        with_game_data: true,
        unexpanded_scripts: true,
      }),
    });
    expect(ctx.rolled.length).toBeGreaterThan(0);
    expect(ctx.bodies).toHaveLength(1);
    expect(ctx.bodies[0].placement.star).toBe(true);
  });

  it("draws none where the game places the system's planets from its record, or before a roll is in", () => {
    const ctx = scenario([scenarioSun], systemRoll({ system: SYSTEM }));
    expect(ctx.rolled).toEqual([]);
    expect(scenario(null, null).rolled).toEqual([]);
  });
});

describe("the lanes out of a system", () => {
  it("gives one exit per hyperlane, named for the neighbour, along the galaxy bearing to it on the inner radius, and none for a bypass", () => {
    const ctx = fixtureContext({});
    expect(ctx.exits.map((exit) => [exit.neighbour, exit.name])).toEqual([
      [6, "S6"],
      [7, "S7"],
    ]);
    const east = ctx.exits.find((exit) => exit.neighbour === 6);
    expect(east?.dx).toBeCloseTo(1);
    expect(east?.dy).toBeCloseTo(0);
    expect(east?.radius).toBe(160);
  });
});
