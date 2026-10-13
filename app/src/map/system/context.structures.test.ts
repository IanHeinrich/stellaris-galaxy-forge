import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/gamedata", () => import("../../test/textures"));

import type { SpawnPlace } from "../../generated/SpawnPlace";
import type { StructureSpawn } from "../../generated/StructureSpawn";
import type { SystemRoll } from "../../generated/SystemRoll";
import { MEGASTRUCTURE_ICON_KEY } from "../../lib/details/icons";
import { SAVE_GEOMETRY } from "../../lib/details/saveGeometry";
import { facingYaw, PLANET_SCALED_DISC } from "../../lib/details/structures";
import {
  megastructureSummary,
  megastructureTypeView,
  planetClassView,
  starbaseLevelView,
  starbaseSummary,
} from "../../test/builders";
import { Camera } from "../Camera";
import { systemContext, type SystemContext } from "./context";
import {
  ART,
  body,
  FURNACE,
  FURNACE_SITE,
  MARAUDER,
  NEXUS,
  onlyStructure,
  ORBITAL_RING,
  RELAY,
  RING_ROW,
  SAVE_TYPES,
  scenario,
  scenarioSun,
  sources,
  STARPORT,
  structuredSave,
  withStructures,
} from "./contextFixture";
import { EARTH, fixed, LUNA, MARS, rollOf, SUN, SYSTEM } from "./fixture";
import { pickTarget } from "./picking";
import type { SystemSources } from "./sources";

const ASSEMBLY = megastructureTypeView("interstellar_assembly_ruined");
const LGATE = megastructureTypeView("lgate_base");
const GATEWAY = megastructureTypeView("gateway_ruined");
const CITADEL = starbaseLevelView("starbase_level_citadel", {
  station_entity: "starbase_citadel_section_entity",
});
const SEGMENT = planetClassView("pc_ringworld_habitable", false, null, {
  flat_art: true,
  ringworld: true,
  body_model: "ringworld_seam_entity",
});

const OVER: Partial<SystemSources> = {
  planetClasses: new Map([...sources.planetClasses, [SEGMENT.key, SEGMENT]]),
};

/** What the initializer says of a structure placed by `place`, certain unless `always` is false. */
const spawn = (place: SpawnPlace, always = true): StructureSpawn => ({ always, place });

const PLANETS = [scenarioSun, body(2, "pc_barren", { orbit: fixed(80) })];
const ROLL = rollOf(PLANETS, { 2: 120 })!;

/** The scenario system of `PLANETS` in `roll`, with these rows and starbase. */
function system(
  rows: Parameters<typeof megastructureSummary>[0][],
  starbase: ReturnType<typeof starbaseSummary> | null = null,
  roll: SystemRoll = ROLL,
) {
  return withStructures(scenario(PLANETS, roll, OVER), rows.map(megastructureSummary), {
    types: [ASSEMBLY, LGATE, GATEWAY],
    levels: [CITADEL],
    names: { [GATEWAY.key]: "Ruined Gateway" },
    stations: starbase ? [starbase] : [],
  });
}

describe("a scenario's megastructures and starbase in its system view", () => {
  it("draws a row tied to a body where the roll lands the body, turned from there", () => {
    const planet = system([]).bodyById.get(2)!.placement;
    const rolled: SystemRoll = { ...ROLL, structures: [{ id: 7, at: [planet.x, planet.y] }] };
    const tied = {
      id: 7,
      kind: ASSEMBLY.key,
      planet: 2,
      at: [5, 5] as [number, number],
      spawn: spawn({ kind: "body", body: 2 }),
    };
    const [drawn] = system([tied], null, rolled).structures;
    const yaw = facingYaw(planet.x, planet.y);
    expect(yaw).not.toBe(facingYaw(5, 5));
    expect(drawn).toMatchObject({
      x: planet.x,
      y: planet.y,
      on: 2,
      modelKey: `model:none:${ASSEMBLY.entity}:yaw${yaw}`,
    });
  });

  it("draws a row about the centre at its point, turned to face the star", () => {
    const gate = {
      kind: LGATE.key,
      at: [21.2132, 21.2132] as [number, number],
      spawn: spawn({ kind: "orbit", distance: fixed(30), angle: fixed(225) }),
    };
    expect(system([gate]).structures[0]).toMatchObject({
      x: 21.2132,
      y: 21.2132,
      on: null,
      modelKey: `model:none:${LGATE.entity}:yaw315`,
    });
  });

  it("draws the starbase bare at (a, −a) beside the star", () => {
    const citadel = starbaseSummary({
      level: CITADEL.key,
      kind: "",
      at: [18.3, -18.3],
      owner: 3,
      spawn: spawn({ kind: "starbase", star_size: fixed(20) }),
    });
    expect(system([], citadel).structures[0]).toMatchObject({
      kind: "starbase",
      x: 18.3,
      y: -18.3,
      modelKey: "model:none:starbase_citadel_section_entity",
      chance: { mayNotSpawn: false, random: false },
    });
  });

  it("marks a row the game may not place, and leaves a certain one and a save's unmarked", () => {
    const at = [30, 0] as [number, number];
    const place: SpawnPlace = { kind: "centre" };
    const rows = [
      { id: 1, kind: LGATE.key, at, spawn: spawn(place, false) },
      { id: 2, kind: LGATE.key, at, spawn: spawn(place) },
      { id: 3, kind: LGATE.key, at },
    ];
    expect(system(rows).structures.map((s) => s.chance.mayNotSpawn)).toEqual([true, false, false]);
  });

  it("stands in for a gateway the game places at random, named so, which a click passes through", () => {
    const at = [-100, 100] as [number, number];
    const ctx = system([
      { id: 1, kind: GATEWAY.key, at, spawn: spawn({ kind: "random" }) },
      { id: 2, kind: LGATE.key, at: [100, 100], spawn: spawn({ kind: "centre" }) },
    ]);
    const [standIn, gate] = ctx.structures;
    expect(standIn).toMatchObject({
      x: -100,
      y: 100,
      name: "Ruined Gateway · placed at random",
      chance: { mayNotSpawn: false, random: true },
    });
    const cam = new Camera();
    cam.setViewport(800, 600);
    cam.scale = 2;
    const pick = (x: number, y: number) => pickTarget(ctx, cam, { x, y }, () => null, null);
    expect(pick(-100, 100)).toBeNull();
    expect(pick(gate.x, gate.y)).toEqual({ kind: "megastructure", id: 2 });
  });

  it("turns a ring world segment to face the star from where the roll lands it", () => {
    const planets = [scenarioSun, body(3, SEGMENT.key, { orbit: fixed(45) })];
    const ctx = scenario(planets, rollOf(planets, { 3: 90 }), OVER);
    const segment = ctx.bodyById.get(3)!;
    const yaw = facingYaw(segment.placement.x, segment.placement.y);
    expect(yaw).not.toBe(0);
    expect(segment.look.model).toBe(`model:none:ringworld_seam_entity:yaw${yaw}`);
  });
});

/** `base` with `body` moved out to 200 units from its parent, as a drag's preview draws it. */
const movedTo = (base: SystemContext, body: number) => {
  const override = SAVE_GEOMETRY.preview(
    { kind: "move", system: SYSTEM, body, radius: 200, angle: 0 },
    base,
  );
  return systemContext(base, { override, marks: null });
};

describe("where a save's megastructure or starbase is drawn", () => {
  it("draws a floating row at its own point plus its type's offset, and a wrapping one on its body", () => {
    const nexus = megastructureSummary({ id: 7, kind: NEXUS.key, planet: EARTH.id, at: [40, 40] });
    expect(onlyStructure(structuredSave([nexus]))).toMatchObject({ x: 40, y: 20 });
    const furnace = megastructureSummary({ kind: FURNACE.key, planet: MARS.id, at: [40, 40] });
    const mars = structuredSave([furnace]).bodyById.get(MARS.id)!.placement;
    expect(onlyStructure(structuredSave([furnace]))).toMatchObject({ x: mars.x, y: mars.y });
  });

  it("carries a floating row with its body while a drag moves the body", () => {
    const nexus = megastructureSummary({ id: 7, kind: NEXUS.key, planet: EARTH.id, at: [40, 40] });
    const base = structuredSave([nexus]);
    const was = base.bodyById.get(EARTH.id)!.placement;
    const moved = movedTo(base, EARTH.id);
    const earth = moved.bodyById.get(EARTH.id)!.placement;
    expect(onlyStructure(moved)).toMatchObject({
      x: 40 + earth.x - was.x,
      y: 20 + earth.y - was.y,
    });
  });

  it("puts a row drawn on its body under the body's plate, and one drawn off it under its own", () => {
    const nexus = megastructureSummary({ id: 7, kind: NEXUS.key, planet: EARTH.id });
    const furnace = megastructureSummary({ id: 9, kind: FURNACE.key, planet: MARS.id });
    const [off, on] = structuredSave([nexus, furnace]).structures;
    expect(off).toMatchObject({ id: 7, on: null });
    expect(on).toMatchObject({ id: 9, on: MARS.id });
  });

  it("carries a tied row with its body while a drag moves the body", () => {
    const furnace = megastructureSummary({ kind: FURNACE.key, planet: MARS.id });
    const moved = movedTo(structuredSave([furnace]), MARS.id);
    const mars = moved.bodyById.get(MARS.id)!.placement;
    expect(onlyStructure(moved)).toMatchObject({ x: mars.x, y: mars.y });
    expect([mars.x, mars.y]).not.toEqual([0, 130]);
  });

  it("draws a free row at its own point plus its type's offset, and a row whose body is missing the same way", () => {
    const relay = megastructureSummary({ id: 1, kind: RELAY.key, at: [-168, 0] });
    const art = megastructureSummary({ id: 3, kind: ART.key, at: [60, 60] });
    const lost = megastructureSummary({ id: 2, kind: NEXUS.key, planet: 99, at: [30, 30] });
    expect(structuredSave([relay, art, lost]).structures.map((s) => [s.x, s.y])).toEqual([
      [-168, 0],
      [33, 33],
      [30, 10],
    ]);
  });

  it("draws a starbase at its station's point, even where its fleet orbits a body", () => {
    const port = starbaseSummary({ id: 3, level: STARPORT.key, at: [21.6, -21.6], planet: SUN.id });
    expect(onlyStructure(structuredSave([], [port]))).toMatchObject({
      kind: "starbase",
      id: 3,
      x: 21.6,
      y: -21.6,
    });
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
    expect(structuredSave([], [ring, lost]).structures.map((s) => [s.id, s.x, s.y])).toEqual([
      [4, 90, 0],
      [5, 40, 40],
    ]);
  });

  it("draws nothing for a scenario's starbase, which has no point", () => {
    const synthesised = starbaseSummary({ level: STARPORT.key, at: null });
    expect(structuredSave([], [synthesised]).structures).toEqual([]);
  });

  it("keeps the map icon at the row's point for a type the game data does not define", () => {
    const modded = megastructureSummary({ kind: "giga_birch_world", at: [12, 34] });
    expect(onlyStructure(structuredSave([modded]))).toMatchObject({
      modelKey: null,
      iconKeys: [MEGASTRUCTURE_ICON_KEY],
      x: 12,
      y: 34,
    });
  });

  it("leaves every structure out while its switch is off, and puts the megastructure back on its body's name", () => {
    const nexus = megastructureSummary({ kind: NEXUS.key, planet: EARTH.id });
    const port = starbaseSummary({ level: STARPORT.key });
    const earthIcons = (ctx: SystemContext) =>
      ctx.bodyById.get(EARTH.id)!.marks.slots.map((slot) => slot.kind);
    const on = structuredSave([nexus], [port]);
    expect(on.structures).toHaveLength(2);
    expect(earthIcons(on)).toEqual([]);

    const sceneLayers = { ...sources.sceneLayers, megastructures: false };
    const off = structuredSave([nexus], [port], { sceneLayers });
    expect(off.structures).toEqual([]);
    expect(earthIcons(off)).toEqual(["megastructures"]);
  });
});

describe("how large a save's megastructure or starbase is drawn", () => {
  it("draws a plain model at its placement's size, and one that grows with its planet by the planet's disc", () => {
    const nexus = megastructureSummary({ id: 1, kind: NEXUS.key, planet: EARTH.id });
    const furnace = megastructureSummary({ id: 2, kind: FURNACE.key, planet: MARS.id });
    const ctx = structuredSave([nexus, furnace]);
    const mars = ctx.bodyById.get(MARS.id)!.placement.disc;
    expect(ctx.structures.map((s) => s.scale)).toEqual([1, mars / PLANET_SCALED_DISC]);
  });

  it("draws a furnace on a moon smaller than on a planet of the same size, by the moon's drawn disc", () => {
    const ctx = structuredSave([megastructureSummary({ kind: FURNACE.key, planet: LUNA.id })]);
    const luna = ctx.bodyById.get(LUNA.id)!.placement;
    const earth = ctx.bodyById.get(EARTH.id)!.placement;
    expect(luna.moon).toBe(true);
    expect(luna.disc).toBeLessThan(earth.disc);
    expect(onlyStructure(ctx).scale).toBeCloseTo(luna.disc / PLANET_SCALED_DISC);
  });

  it("grows an orbital ring starbase with its planet, and a Dyson Swarm on its star not at all", () => {
    const ring = starbaseSummary({ level: ORBITAL_RING.key, at: [90, 0], planet: EARTH.id });
    const ctx = structuredSave([], [ring]);
    expect(onlyStructure(ctx).scale).toBeCloseTo(
      ctx.bodyById.get(EARTH.id)!.placement.disc / PLANET_SCALED_DISC,
    );
    const swarm = megastructureTypeView("dyson_swarm_1");
    const onStar = megastructureSummary({ kind: swarm.key, planet: SUN.id });
    const swarmed = withStructures(structuredSave([]), [onStar], { types: [...SAVE_TYPES, swarm] });
    expect(onlyStructure(swarmed).scale).toBe(1);
  });
});

describe("which model a save's megastructure or starbase is drawn from", () => {
  it("asks for its type's model in the row's culture, else for the bare model of an unowned row", () => {
    const own = megastructureSummary({ id: 1, kind: NEXUS.key, culture: "avian_01" });
    const none = megastructureSummary({ id: 2, kind: RELAY.key });
    expect(structuredSave([own, none]).structures.map((s) => s.modelKey)).toEqual([
      "model:avian_01:thinktank_phase_03_entity",
      "model:none:hyper_relay_entity",
    ]);
  });

  it("turns a type to face the star from where the save puts the row, and leaves one that says not, or on the star, unturned", () => {
    const ruin = megastructureTypeView("ring_world_ruined");
    const swarm = megastructureTypeView("dyson_swarm_1", { rotate_to_center: false });
    const rows = [
      megastructureSummary({ id: 1, kind: ruin.key, at: [-45.2, 0] }),
      megastructureSummary({ id: 2, kind: ruin.key, at: [45.2, 0] }),
      megastructureSummary({ id: 3, kind: ruin.key, at: [0, 30] }),
      megastructureSummary({ id: 4, kind: swarm.key, at: [-45.2, 0] }),
      megastructureSummary({ id: 5, kind: ruin.key, at: [0, 0] }),
    ];
    const ctx = withStructures(structuredSave([]), rows, { types: [ruin, swarm] });
    // Model −Z, −save x at no turn, points from (45.2, 0) to the star: (−45.2, 0) turns half round.
    expect(ctx.structures.map((s) => s.modelKey)).toEqual([
      "model:none:ring_world_ruined_entity:yaw180",
      "model:none:ring_world_ruined_entity",
      "model:none:ring_world_ruined_entity:yaw270",
      "model:none:dyson_swarm_1_entity",
      "model:none:ring_world_ruined_entity",
    ]);
  });

  it("draws a stage with no model of its own as its construction model, at its construction scale", () => {
    const site = megastructureSummary({ kind: FURNACE_SITE.key });
    expect(onlyStructure(structuredSave([site]))).toMatchObject({
      modelKey: "model:none:arc_furnace_construction_entity",
      scale: 1.02,
    });
  });

  it("draws a starbase as its level's station in its station ship's culture, and none for a level with an empty station", () => {
    const port = starbaseSummary({ id: 3, level: STARPORT.key, culture: "humanoid_01" });
    const marauder = starbaseSummary({ id: 4, level: MARAUDER.key });
    expect(structuredSave([], [port, marauder]).structures.map((s) => s.modelKey)).toEqual([
      "model:humanoid_01:starbase_starport_section_entity",
    ]);
  });

  it("draws nothing for an orbital ring row, whose ring is drawn as its starbase", () => {
    const row = megastructureSummary({ kind: RING_ROW.key, planet: EARTH.id });
    expect(structuredSave([row]).structures).toEqual([]);
  });
});
