import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/gamedata", () => import("../../../test/textures"));

import type { Container, Sprite } from "pixi.js";
import type { MegastructureSummary } from "../../../generated/MegastructureSummary";
import type { MegastructureTypeView } from "../../../generated/MegastructureTypeView";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { StarbaseLevelView } from "../../../generated/StarbaseLevelView";
import type { StarbaseSummary } from "../../../generated/StarbaseSummary";
import { MEGASTRUCTURE_ICON_KEY } from "../../../lib/details/icons";
import { SAVE_GEOMETRY } from "../../../lib/details/saveGeometry";
import { PLANET_SCALED_DISC } from "../../../lib/details/structures";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../../lib/geometry/geometry";
import {
  megastructureSummary,
  megastructureTypeView,
  starbaseLevelView,
  starbaseSummary,
  systemDetails,
} from "../../../test/builders";
import { textureFetch } from "../../../test/textures";
import { until } from "../../../test/wait";
import { systemContext, type SceneStructure, type SystemContext } from "../context";
import { sources } from "../contextFixture";
import { EARTH, LUNA, MARS, SUN, SYSTEM, viewport } from "../fixture";
import { pickTarget } from "../picking";
import type { SystemSources } from "../sources";
import { answerFetch, decodeByKey, resetTextures } from "./bodiesFixture";
import { StructuresLayer } from "./StructuresLayer";

beforeEach(resetTextures);

const NEXUS = megastructureTypeView("think_tank_3", {
  entity: "thinktank_phase_03_entity",
  entity_offset: [0, -20],
});
const RELAY = megastructureTypeView("hyper_relay", { entity: "hyper_relay_entity" });
const FURNACE = megastructureTypeView("orbital_arc_furnace_1", {
  entity: "arc_furnace_entity",
  scales_with_planet: true,
});
const FURNACE_SITE = megastructureTypeView("orbital_arc_furnace_0", {
  entity: null,
  construction_entity: "arc_furnace_construction_entity",
  construction_scale: 1.02,
});
const RING = megastructureTypeView("orbital_ring", { entity: null, scales_with_planet: true });
const ART = megastructureTypeView("art_installation_1", { entity_offset: [-27, -27] });

const STARPORT = starbaseLevelView("starbase_level_starport", {
  icon_frame: 2,
  station_entity: "starbase_starport_section_entity",
});
const ORBITAL_RING = starbaseLevelView("starbase_level_orbital_ring_tier_1", {
  station_entity: "orbital_ring_section_entity",
  scales_with_planet: true,
});
const MARAUDER = starbaseLevelView("starbase_level_marauder", {
  empire_shield: true,
  station_entity: "empty_section_entity",
});

const TYPES = new Map<string, MegastructureTypeView>(
  [NEXUS, RELAY, FURNACE, FURNACE_SITE, RING, ART].map((t) => [t.key, t]),
);
const LEVELS = new Map<string, StarbaseLevelView>(
  [STARPORT, ORBITAL_RING, MARAUDER].map((l) => [l.key, l]),
);

/** A model 10 units wide and 6 tall whose origin is a quarter in and halfway down. */
const PLACEMENT = { width: 10, height: 6, anchor_x: 0.25, anchor_y: 0.5 };

const SAVE_SOURCES: SystemSources = {
  ...sources,
  megastructureTypes: TYPES,
  starbaseLevels: LEVELS,
  geometry: SAVE_GEOMETRY,
};

const BODIES: PlanetSummary[] = [SUN, EARTH, LUNA, MARS];

/** The save system of `BODIES` with these rows and stations. */
function system(
  megastructures: MegastructureSummary[],
  stations: StarbaseSummary[] = [],
  over: Partial<SystemSources> = {},
): SystemContext {
  const [starbase = null, ...others] = stations;
  return systemContext({
    ...SAVE_SOURCES,
    details: systemDetails({
      id: SYSTEM,
      planets: BODIES,
      megastructures,
      starbase,
      other_starbases: others,
    }),
    ...over,
  });
}

function only(ctx: SystemContext): SceneStructure {
  expect(ctx.structures).toHaveLength(1);
  return ctx.structures[0];
}

const holder = (layer: StructuresLayer, label: string): Container => {
  const found = layer.container.children.find((c) => c.label === label);
  if (!found) throw new Error(`no ${label}`);
  return found;
};
const part = (drawn: Container, label: string) =>
  drawn.children.find((c) => c.label === label) as Sprite;

describe("where a megastructure or a starbase is drawn", () => {
  it("draws a row tied to a body where the body is drawn, plus its type's offset, not at the row's own point", () => {
    const nexus = megastructureSummary({
      id: 7,
      kind: "think_tank_3",
      planet: EARTH.id,
      at: [40, 40],
    });
    expect(only(system([nexus]))).toMatchObject({ x: 90, y: -20 });
  });

  it("carries a tied row with its body while a drag moves the body", () => {
    const furnace = megastructureSummary({ kind: "orbital_arc_furnace_1", planet: MARS.id });
    const base = system([furnace]);
    const override = SAVE_GEOMETRY.preview(
      { kind: "move", system: SYSTEM, body: MARS.id, radius: 200, angle: 0 },
      base,
    );
    const moved = systemContext(base, { override, marks: null });
    const mars = moved.bodyById.get(MARS.id)!.placement;
    expect(only(moved)).toMatchObject({ x: mars.x, y: mars.y });
    expect([mars.x, mars.y]).not.toEqual([0, 130]);
  });

  it("draws a free row at its own point plus its type's offset, and a row whose body is missing the same way", () => {
    const relay = megastructureSummary({ id: 1, kind: "hyper_relay", at: [-168, 0] });
    const art = megastructureSummary({ id: 3, kind: "art_installation_1", at: [60, 60] });
    const lost = megastructureSummary({ id: 2, kind: "think_tank_3", planet: 99, at: [30, 30] });
    expect(system([relay, art, lost]).structures.map((s) => [s.x, s.y])).toEqual([
      [-168, 0],
      [33, 33],
      [30, 10],
    ]);
  });

  it("draws a starbase at its station's point, even where its fleet orbits a body", () => {
    const port = starbaseSummary({ id: 3, level: STARPORT.key, at: [21.6, -21.6], planet: SUN.id });
    expect(only(system([], [port]))).toMatchObject({ kind: "starbase", id: 3, x: 21.6, y: -21.6 });
  });

  it("draws an orbital ring starbase on the planet its fleet orbits, wherever that planet is drawn now", () => {
    // The station still stands where the planet was before an edit moved the planet.
    const ring = starbaseSummary({
      id: 4,
      level: ORBITAL_RING.key,
      at: [40, 40],
      planet: EARTH.id,
    });
    const lost = starbaseSummary({ id: 5, level: ORBITAL_RING.key, at: [40, 40], planet: 99 });
    expect(system([], [ring, lost]).structures.map((s) => [s.id, s.x, s.y])).toEqual([
      [4, 90, 0],
      [5, 40, 40],
    ]);
  });

  it("draws nothing for a scenario's starbase, which has no point", () => {
    const synthesised = starbaseSummary({ level: STARPORT.key, at: null });
    expect(system([], [synthesised]).structures).toEqual([]);
  });
});

describe("how large a megastructure or a starbase is drawn", () => {
  it("draws a plain model at its placement's size, and one that grows with its planet by the planet's disc", () => {
    const nexus = megastructureSummary({ id: 1, kind: "think_tank_3", planet: EARTH.id });
    const furnace = megastructureSummary({ id: 2, kind: "orbital_arc_furnace_1", planet: MARS.id });
    const ctx = system([nexus, furnace]);
    const mars = ctx.bodyById.get(MARS.id)!.placement.disc;
    expect(ctx.structures.map((s) => s.scale)).toEqual([1, mars / PLANET_SCALED_DISC]);
  });

  it("draws a furnace on a moon smaller than on a planet of the same size, by the moon's drawn disc", () => {
    const onMoon = megastructureSummary({ kind: "orbital_arc_furnace_1", planet: LUNA.id });
    const ctx = system([onMoon]);
    const luna = ctx.bodyById.get(LUNA.id)!.placement;
    const earth = ctx.bodyById.get(EARTH.id)!.placement;
    expect(luna.moon).toBe(true);
    expect(luna.disc).toBeLessThan(earth.disc);
    expect(only(ctx).scale).toBeCloseTo(luna.disc / PLANET_SCALED_DISC);
  });

  it("grows an orbital ring starbase with its planet, and a Dyson Swarm on its star not at all", () => {
    const ring = starbaseSummary({ level: ORBITAL_RING.key, at: [90, 0], planet: EARTH.id });
    const ctx = system([], [ring]);
    expect(only(ctx).scale).toBeCloseTo(
      ctx.bodyById.get(EARTH.id)!.placement.disc / PLANET_SCALED_DISC,
    );
    const swarm = megastructureTypeView("dyson_swarm_1");
    const onStar = megastructureSummary({ kind: "dyson_swarm_1", planet: SUN.id });
    const types = new Map([...TYPES, [swarm.key, swarm]]);
    expect(only(system([onStar], [], { megastructureTypes: types })).scale).toBe(1);
  });

  it("sizes the sprite from its placement once it lands, mirrored against the scene's axis flip", async () => {
    const textureFor = decodeByKey();
    textureFetch.model = () => PLACEMENT;
    const layer = new StructuresLayer();
    const furnace = megastructureSummary({ id: 2, kind: "orbital_arc_furnace_1", planet: MARS.id });
    const ctx = system([furnace]);
    layer.rebuild(ctx);
    viewport(layer, 2);
    const model = part(holder(layer, "megastructure:2"), "model");
    expect(model.visible).toBe(false);

    await answerFetch();
    await until(() => expect(model.visible).toBe(true));
    const { scale } = only(ctx);
    const texture = textureFor("model:mammalian_01:arc_furnace_entity");
    expect(model.texture).toBe(texture);
    expect(model.anchor.x).toBe(0.25);
    expect(model.anchor.y).toBe(0.5);
    expect(model.scale.x * texture.width).toBeCloseTo(SAVE_X_SIGN * PLACEMENT.width * scale);
    expect(model.scale.y * texture.height).toBeCloseTo(SAVE_Y_SIGN * PLACEMENT.height * scale);
    layer.destroy();
  });
});

describe("which model a megastructure or a starbase is drawn from", () => {
  it("asks for its type's model in the row's culture, else in the fallback culture", () => {
    const own = megastructureSummary({ id: 1, kind: "think_tank_3", culture: "avian_01" });
    const none = megastructureSummary({ id: 2, kind: "hyper_relay" });
    expect(system([own, none]).structures.map((s) => s.modelKey)).toEqual([
      "model:avian_01:thinktank_phase_03_entity",
      "model:mammalian_01:hyper_relay_entity",
    ]);
  });

  it("draws a stage with no model of its own as its construction model, at its construction scale", () => {
    const site = megastructureSummary({ kind: "orbital_arc_furnace_0" });
    expect(only(system([site]))).toMatchObject({
      modelKey: "model:mammalian_01:arc_furnace_construction_entity",
      scale: 1.02,
    });
  });

  it("draws a starbase as its level's station in its station ship's culture, and none for a level with an empty station", () => {
    const port = starbaseSummary({ id: 3, level: STARPORT.key, culture: "humanoid_01" });
    const marauder = starbaseSummary({ id: 4, level: MARAUDER.key });
    expect(system([], [port, marauder]).structures.map((s) => s.modelKey)).toEqual([
      "model:humanoid_01:starbase_starport_section_entity",
    ]);
  });

  it("draws nothing for an orbital ring row, whose ring is drawn as its starbase", () => {
    const row = megastructureSummary({ kind: "orbital_ring", planet: EARTH.id });
    expect(system([row]).structures).toEqual([]);
  });

  it("asks for every model and icon of the system in one batch", async () => {
    const { getTextures } = await import("../../../test/textures");
    getTextures.mockClear();
    const layer = new StructuresLayer();
    layer.rebuild(
      system(
        [megastructureSummary({ id: 1, kind: "hyper_relay" })],
        [starbaseSummary({ level: STARPORT.key })],
      ),
    );
    await answerFetch();
    expect(getTextures).toHaveBeenCalledTimes(1);
    expect(getTextures.mock.calls[0][0]).toEqual([
      "model:mammalian_01:hyper_relay_entity",
      MEGASTRUCTURE_ICON_KEY,
      "model:mammalian_01:starbase_starport_section_entity",
      "sprite:GFX_starbase_ship_size_small#2",
    ]);
    layer.destroy();
  });
});

describe("a megastructure the editor cannot draw", () => {
  it("keeps the map icon at the row's point for a type the game data does not define", () => {
    const modded = megastructureSummary({ kind: "giga_birch_world", at: [12, 34] });
    expect(only(system([modded]))).toMatchObject({
      modelKey: null,
      iconKeys: [MEGASTRUCTURE_ICON_KEY],
      x: 12,
      y: 34,
    });
  });

  it("shows the map icon in place of a model that could not be baked", async () => {
    decodeByKey();
    textureFetch.mode = "views";
    textureFetch.fails = (key) => key.startsWith("model:");
    const layer = new StructuresLayer();
    layer.rebuild(system([megastructureSummary({ id: 5, kind: "hyper_relay" })]));
    viewport(layer, 2);
    const drawn = holder(layer, "megastructure:5");
    await until(() => expect(part(drawn, "icon").visible).toBe(true));
    expect(part(drawn, "model").visible).toBe(false);
    layer.destroy();
  });
});

describe("clicking a megastructure", () => {
  const furnace = megastructureSummary({ id: 9, kind: "orbital_arc_furnace_1", planet: MARS.id });
  const relay = megastructureSummary({ id: 8, kind: "hyper_relay", at: [-168, 60] });

  it("picks the body under a structure drawn over it, and the structure where no body is", () => {
    const ctx = system([furnace, relay]);
    const cam = viewport(new StructuresLayer(), 2);
    const pick = (x: number, y: number) => pickTarget(ctx, cam, { x, y }, () => null, null);
    expect(pick(0, 130)).toEqual({ kind: "body", id: MARS.id });
    expect(pick(-168, 60)).toEqual({ kind: "megastructure", id: 8 });
  });

  it("picks a structure in the ellipse inside its landed model, and what lies under the model's empty corners", async () => {
    decodeByKey();
    textureFetch.model = () => PLACEMENT;
    const ctx = system([relay]);
    const layer = new StructuresLayer();
    layer.rebuild(ctx);
    const cam = viewport(layer, 2);
    await answerFetch();
    await until(() => expect(part(holder(layer, "megastructure:8"), "model").visible).toBe(true));
    // Screen-right is −save x: the model reaches three quarters of its width that way.
    const right = -168 + SAVE_X_SIGN * 0.7 * PLACEMENT.width;
    expect(pickTarget(ctx, cam, { x: right, y: 60 }, () => null, null)).toEqual({
      kind: "megastructure",
      id: 8,
    });
    // Inside the sprite's rectangle, outside its ellipse and the pick radius about its point.
    const corner = { x: -168 + SAVE_X_SIGN * 6.5, y: 60 + SAVE_Y_SIGN * 2.7 };
    expect(pickTarget(ctx, cam, corner, () => null, null)).toBeNull();
    layer.destroy();
  });
});

describe("a drag that moves a body a structure stands on", () => {
  it("moves the structure's sprite and keeps it, rebuilding nothing", () => {
    const furnace = megastructureSummary({ id: 9, kind: "orbital_arc_furnace_1", planet: MARS.id });
    const base = system([furnace]);
    const layer = new StructuresLayer();
    layer.rebuild(base);
    const before = holder(layer, "megastructure:9");
    const sprite = part(before, "model");
    const override = SAVE_GEOMETRY.preview(
      { kind: "move", system: SYSTEM, body: MARS.id, radius: 200, angle: 0 },
      base,
    );
    const moved = systemContext(base, { override, marks: null });
    layer.rebuild(moved);
    const after = holder(layer, "megastructure:9");
    expect(after).toBe(before);
    expect(part(after, "model")).toBe(sprite);
    expect([after.x, after.y]).toEqual([only(moved).x, only(moved).y]);
    layer.destroy();
  });
});

describe("the Megastructures and starbases switch", () => {
  it("leaves every structure out when it is off, and puts the megastructure back on its body's name", () => {
    const nexus = megastructureSummary({ kind: "think_tank_3", planet: EARTH.id });
    const port = starbaseSummary({ level: STARPORT.key });
    const earthIcons = (ctx: SystemContext) =>
      ctx.bodyById.get(EARTH.id)!.marks.slots.map((slot) => slot.kind);
    const on = system([nexus], [port]);
    expect(on.structures).toHaveLength(2);
    expect(earthIcons(on)).toEqual([]);

    const sceneLayers = { ...SAVE_SOURCES.sceneLayers, megastructures: false };
    const off = system([nexus], [port], { sceneLayers });
    expect(off.structures).toEqual([]);
    expect(earthIcons(off)).toEqual(["megastructures"]);
  });
});
