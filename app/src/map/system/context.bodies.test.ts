import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/gamedata", () => import("../../test/textures"));

import type { PlanetSummary } from "../../generated/PlanetSummary";
import { PLANET_ICON_KEYS } from "../../lib/details/icons";
import {
  bodyLayout,
  countryNode,
  planetClassView,
  planetSummary,
  systemDetails,
} from "../../test/builders";
import { systemContext } from "./context";
import { body, save, scenario, scenarioNode, scenarioSun, sources, sun } from "./contextFixture";
import { fixed, rollOf, SYSTEM } from "./fixture";

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

  it("marks a colony with its owner's plate and flag and a pre-FTL world with its icon", () => {
    const owned = (id: number, preFtl: boolean) =>
      planetSummary({
        id,
        class: "pc_continental",
        owner: 9,
        colonised: true,
        pre_ftl: preFtl,
        layout: bodyLayout({ orbit: fixed(40 * id), at: [40 * id, 0], size: fixed(16) }),
      });
    const country = countryNode({
      id: 9,
      colors: ["red", "black"],
      flag_icon: { category: "human", file: "flag_human_9.dds" },
      flag_background: { category: "backgrounds", file: "00_solid.dds" },
    });
    const ctx = save([sun, owned(2, false), owned(3, true)], {
      countries: new Map([[9, country]]),
    });
    const preFtl = (b: (typeof ctx.bodies)[number]) =>
      b.marks.slots.some((slot) => slot.kind === "preFtl");
    expect(
      ctx.bodies.map((b) => [
        b.marks.emblem?.plate ?? null,
        Boolean(b.marks.emblem?.flag),
        preFtl(b),
      ]),
    ).toEqual([
      [null, false, false],
      ["sprite:GFX_map_icon_bg", true, false],
      [null, false, true],
    ]);
  });

  it("marks a body with the megastructures and dig sites on it and its anomaly by the game's name", () => {
    const at = (id: number) =>
      bodyLayout({ orbit: fixed(40 * id), at: [40 * id, 0], size: fixed(16) });
    const holding = planetSummary({
      id: 2,
      class: "pc_barren",
      anomaly: "AIANOM_RESEARCHDEPO_CAT",
      layout: at(2),
    });
    const other = planetSummary({ id: 3, class: "pc_barren", layout: at(3) });
    const planets = [sun, holding, other];
    const ctx = save(planets, {
      details: systemDetails({
        id: SYSTEM,
        planets,
        megastructures: [
          { id: 50, kind: "dyson_sphere_2", owner: null, planet: 2 },
          { id: 51, kind: "gateway_final", owner: null, planet: 2 },
        ],
        sites: [{ id: 60, kind: "site_zroni_ruins", planet: 3 }],
      }),
      names: new Map([["AIANOM_RESEARCHDEPO_CAT", "Research Depot"]]),
    });
    expect(
      ctx.bodies.map(({ marks }) => [
        marks.icons.megastructures.map((m) => m.id),
        marks.icons.sites.map((site) => site.id),
        marks.icons.anomaly,
      ]),
    ).toEqual([
      [[], [], null],
      [[50, 51], [], "Research Depot"],
      [[], [60], null],
    ]);
    expect(ctx.bodies[1].marks.slots.map((slot) => slot.kind)).toEqual([
      "megastructures",
      "anomaly",
    ]);
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

  it("draws a class the install has no surface for from its icon alone, unshaded, and a world as its baked disc", () => {
    const planet = (id: number, planetClass: string) =>
      planetSummary({
        id,
        class: planetClass,
        layout: bodyLayout({ orbit: fixed(40 * id), at: [40 * id, 0], size: fixed(10) }),
      });
    const habitat = { ...planetClassView("pc_habitat", false), flat_art: true };
    const planetClasses = new Map(sources.planetClasses).set(habitat.key, habitat);
    const ctx = save([sun, planet(2, "pc_habitat"), planet(3, "pc_continental")], {
      planetClasses,
    });
    const looks = [2, 3].map((id) => {
      const { flat, irregular, surfaceKeys } = ctx.bodyById.get(id)!.look;
      return { flat, irregular, surfaceKeys };
    });
    expect(looks).toEqual([
      { flat: true, irregular: true, surfaceKeys: [] },
      { flat: false, irregular: false, surfaceKeys: ["planet_disc:pc_continental"] },
    ]);
  });

  it("draws a class whose model draws nothing from its icon, or the planet marker without one", () => {
    const planet = (id: number, planetClass: string) =>
      planetSummary({
        id,
        class: planetClass,
        layout: bodyLayout({ orbit: fixed(40 * id), at: [40 * id, 0], size: fixed(10) }),
      });
    const site = { ...planetClassView("pc_orbital_site", false), hidden_model: true };
    const planetClasses = new Map(sources.planetClasses).set(site.key, site);
    const ctx = save([sun, planet(2, "pc_orbital_site")], { planetClasses });
    const body = ctx.bodyById.get(2)!;
    expect(body.look.surfaceKeys).toEqual([]);
    expect(body.look.flat).toBe(true);
    expect(body.iconKeys).toEqual(PLANET_ICON_KEYS);
  });

  it("draws a shattered class broken apart as its planet's id says, with no haze, and every other class whole", () => {
    const layout = (id: number) =>
      bodyLayout({ orbit: fixed(40 * id), at: [40 * id, 0], size: fixed(10) });
    const shattered = {
      ...planetClassView("pc_shattered", false),
      shattered: true,
      atmosphere_color: "#b39b6b",
      atmosphere_intensity: 1,
      atmosphere_width: 0.5,
    };
    const planetClasses = new Map(sources.planetClasses).set(shattered.key, shattered);
    const broken = (id: number) =>
      planetSummary({
        id,
        class: "pc_shattered",
        entity_name: "shattered_planet_01_entity",
        layout: layout(id),
      });
    const whole = planetSummary({ id: 4, class: "pc_continental", layout: layout(4) });
    const scene = () => save([sun, broken(2), broken(3), whole], { planetClasses });
    const ctx = scene();
    const looks = [2, 3, 4].map((id) => {
      const { look, atmosphere } = ctx.bodyById.get(id)!;
      const { shattered, flat, irregular, surfaceKeys } = look;
      return { shattered, flat, irregular, surfaceKeys, haze: atmosphere !== null };
    });
    expect(looks).toEqual([
      {
        shattered: true,
        flat: false,
        irregular: false,
        surfaceKeys: ["planet_disc_shattered:pc_shattered:2"],
        haze: false,
      },
      {
        shattered: true,
        flat: false,
        irregular: false,
        surfaceKeys: ["planet_disc_shattered:pc_shattered:3"],
        haze: false,
      },
      {
        shattered: false,
        flat: false,
        irregular: false,
        surfaceKeys: ["planet_disc:pc_continental"],
        haze: false,
      },
    ]);
    expect(scene().bodyById.get(2)!.look.surfaceKeys).toEqual(
      ctx.bodyById.get(2)!.look.surfaceKeys,
    );
  });

  it("draws a save planet's own model before its class's disc, and draws it afresh when the model changes", () => {
    const layout = bodyLayout({ orbit: fixed(40), at: [40, 0], size: fixed(10) });
    const plain = planetSummary({ id: 2, class: "pc_continental", layout });
    const paradise = { ...plain, entity_name: "ocean_paradise_planet_01_entity" };
    const keys = (planet: PlanetSummary) => save([sun, planet]).bodyById.get(2)!.look.surfaceKeys;
    expect(keys(paradise)).toEqual([
      "planet_model:ocean_paradise_planet_01_entity",
      "planet_disc:pc_continental",
    ]);
    expect(keys(plain)).toEqual(["planet_disc:pc_continental"]);
    const star = save([{ ...sun, entity_name: "star_entity" }]).bodyById.get(1)!;
    expect(star.look.surfaceKeys).toEqual(["star_disc:pc_g_star"]);

    const shown = save([sun, plain]);
    const given = systemContext({
      ...shown,
      details: systemDetails({ id: SYSTEM, planets: [sun, paradise] }),
    });
    expect(given.bodyById.get(2)!.look).not.toBe(shown.bodyById.get(2)!.look);
  });

  it("draws both stars of a binary scenario system still loading", () => {
    const ctx = scenario(null, null, scenarioNode("sc_binary_ab"));
    expect(ctx.bodies.map((b) => [b.surfaceClass, b.starClass])).toEqual([
      ["pc_a_star", "sc_a"],
      ["pc_b_star", "sc_b"],
    ]);
  });

  it("draws a scenario system still loading as its initializer's star, with no question mark", () => {
    const ctx = scenario(null, null, scenarioNode("sc_pulsar"));
    const [pulsar] = ctx.bodies;
    expect(pulsar.starClass).toBe("sc_pulsar");
    expect(pulsar.surfaceClass).toBe("pc_pulsar");
    expect(pulsar.chance.planetClass).toBe(false);
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
