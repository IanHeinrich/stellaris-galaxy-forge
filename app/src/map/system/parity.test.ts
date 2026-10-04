import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/gamedata", () => import("../../test/textures"));

import { BitmapText, Container, Graphics, Sprite } from "pixi.js";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { StarClassView } from "../../generated/StarClassView";
import {
  bodyLayout,
  byId,
  placedNode,
  planetClassView,
  planetSummary,
  starClassView,
  systemDetails,
} from "../../test/builders";
import { rolledBody, systemRoll } from "../../test/rolls";
import { textureFetch } from "../../test/textures";
import { systemContext, type SceneBody, type SystemContext } from "./context";
import { blankSceneTextures, stubTextMeasurement, viewport } from "./drawFixture";
import { BodiesLayer } from "./layers/BodiesLayer";
import { LabelsLayer } from "./layers/LabelsLayer";
import { NO_SOURCES, placeIn } from "./sources";

stubTextMeasurement();
textureFetch.mode = "never";

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
    ...["pc_g_star", "pc_a_star", "pc_b_star", "pc_pulsar", "pc_black_hole"].map((key) =>
      planetClassView(key),
    ),
    { ...planetClassView("pc_t_star"), draws_as_planet: true },
    ...["pc_continental", "pc_barren", "pc_broken"].map(iconed),
    { ...iconed("pc_asteroid"), asteroid: true },
  ].map((view) => [view.key, view]),
);

/**
 * A body as the core resolves it from either source: its class, the star class a star draws as,
 * and where it stands, both as the orbit and angle a scenario's roll gives and as the point a save
 * holds, written out by hand.
 */
interface Placed {
  id: number;
  planetClass: string;
  starClass?: string;
  orbit: number;
  angle: number;
  at: [number, number];
  size: number;
  parent?: number;
  ring?: boolean;
  deposits?: PlanetSummary["deposits"];
}

function summary(body: Placed, over: Partial<PlanetSummary>): PlanetSummary {
  return planetSummary({
    id: body.id,
    class: body.planetClass,
    star_class: body.starClass,
    parent: body.parent ?? null,
    moon: body.parent !== undefined,
    ring: body.ring ?? false,
    deposits: body.deposits ?? [],
    ...over,
  });
}

const sources = {
  ...NO_SOURCES,
  id: SYSTEM,
  starClasses: STAR_CLASSES,
  planetClasses: PLANET_CLASSES,
  gameDataReady: true,
  sceneLayers: { ...NO_SOURCES.sceneLayers, details: true },
};

/** The system as a save holds it: the star class on the system and every body at its point. */
function asSave(starClass: string, bodies: readonly Placed[]): SystemContext {
  const planets = bodies.map((b) =>
    summary(b, {
      layout: bodyLayout({ orbit: fixed(b.orbit), at: b.at, size: fixed(b.size) }),
    }),
  );
  return systemContext({
    ...sources,
    ...placeIn(
      byId({ ...placedNode(SYSTEM, 0, 0), star_class: starClass, initializer: INITIALIZER }),
      SYSTEM,
    ),
    details: systemDetails({ id: SYSTEM, planets }),
  });
}

/**
 * The same system as a scenario holds it: the star class the core draws from its initializer,
 * every body on a fixed orbit naming its angle, and a roll landing each where the save has it.
 */
function asScenario(starClass: string, bodies: readonly Placed[]): SystemContext {
  const planets = bodies.map((b) =>
    summary(b, {
      layout: bodyLayout({
        orbit: fixed(b.orbit),
        size: fixed(b.size),
        orbit_step: fixed(b.orbit),
        angle_step: fixed(b.angle),
      }),
    }),
  );
  const roll = systemRoll({
    system: SYSTEM,
    bodies: bodies.map((b) => rolledBody({ id: b.id, orbit: b.orbit, angle: b.angle })),
  });
  return systemContext({
    ...sources,
    ...placeIn(
      byId({ ...placedNode(SYSTEM, 0, 0), star_class: starClass, initializer: INITIALIZER }),
      SYSTEM,
    ),
    details: systemDetails({ id: SYSTEM, planets, with_game_data: true }),
    rolledLayout: true,
    roll,
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
 * A body as the scene resolved it, without the source record it was resolved from, which its
 * marks keep too for their tooltips, or the steps and turn from the body before it that only a
 * scenario gives.
 */
function resolved(body: SceneBody): unknown {
  const { placement, marks } = body;
  const radius = placement.radius && { ...placement.radius, step: null, base: null };
  return rounded({
    ...body,
    planet: null,
    marks: { ...marks, icons: { ...marks.icons, planets: null } },
    placement: { ...placement, radius, turn: null },
  });
}

/** What the bodies layer draws for each body: where, and each part's look. */
function drawn(ctx: SystemContext): unknown {
  const layer = new BodiesLayer(blankSceneTextures());
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

const star = (planetClass: string, starClass: string, size = 20): Placed => ({
  id: 1,
  planetClass,
  starClass,
  orbit: 0,
  angle: 0,
  at: [0, 0],
  size,
});

describe("a scenario body on a fixed orbit and angle is drawn as a save body at the matching point", () => {
  it("for a G star, a ringed planet with its moon and an asteroid", () => {
    expectParity("sc_g", [
      star("pc_g_star", "sc_g"),
      {
        id: 2,
        planetClass: "pc_continental",
        orbit: 90,
        angle: 0,
        at: [90, 0],
        size: 16,
        ring: true,
        deposits: [{ resource: "food", amount: 3 }],
      },
      {
        id: 3,
        planetClass: "pc_barren",
        orbit: 12,
        angle: 180,
        at: [78, 0],
        size: 5,
        parent: 2,
      },
      {
        id: 4,
        planetClass: "pc_asteroid",
        orbit: 130,
        angle: 90,
        at: [0, 130],
        size: 5,
      },
    ]);
  });

  it("for a pulsar, surface bake and beams included", () => {
    const planet: Placed = {
      id: 2,
      planetClass: "pc_barren",
      orbit: 70,
      angle: 270,
      at: [0, -70],
      size: 12,
    };
    const bodies = [star("pc_pulsar", "sc_pulsar"), planet];
    expectParity("sc_pulsar", bodies);
    const [pulsar] = asScenario("sc_pulsar", bodies).bodies;
    expect(pulsar.look.surfaceKeys).toEqual(["star_disc:pc_pulsar"]);
    expect(pulsar.look.flare).toBe("pulsar");
  });

  it("for a black hole, black with its planet out on its orbit", () => {
    const broken: Placed = {
      id: 2,
      planetClass: "pc_broken",
      orbit: 60,
      angle: 0,
      at: [60, 0],
      size: 10,
    };
    const bodies = [star("pc_black_hole", "sc_black_hole", 30), broken];
    expectParity("sc_black_hole", bodies);
    const [hole, planet] = asScenario("sc_black_hole", bodies).bodies;
    expect(hole.look.blackHole).toBe(true);
    expect(hole.look.surfaceKeys).toEqual([]);
    expect(Math.hypot(planet.placement.x, planet.placement.y)).toBeGreaterThan(
      hole.placement.disc + planet.placement.disc,
    );
  });

  it("for a binary, each star as its own class", () => {
    const binary: Placed[] = [
      { ...star("pc_a_star", "sc_a", 30), orbit: 25, at: [25, 0] },
      { ...star("pc_b_star", "sc_b"), id: 2, orbit: 25, angle: 180, at: [-25, 0] },
    ];
    expectParity("sc_binary_ab", binary);
    const stars = asScenario("sc_binary_ab", binary).bodies;
    expect(stars.map((b) => [b.surfaceClass, b.starClass])).toEqual([
      ["pc_a_star", "sc_a"],
      ["pc_b_star", "sc_b"],
    ]);
  });

  it("for a brown dwarf, sized as a planet", () => {
    expectParity("sc_t", [star("pc_t_star", "sc_t", 16)]);
  });
});
