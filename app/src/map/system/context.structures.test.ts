import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/gamedata", () => import("../../test/textures"));

import type { MegastructureView } from "../../generated/MegastructureView";
import type { SpawnPlace } from "../../generated/SpawnPlace";
import type { StarbaseLevelView } from "../../generated/StarbaseLevelView";
import type { StructureSpawn } from "../../generated/StructureSpawn";
import type { SystemRoll } from "../../generated/SystemRoll";
import { facingYaw } from "../../lib/details/structures";
import {
  megastructureSummary,
  megastructureTypeView,
  planetClassView,
  starbaseLevelView,
  starbaseSummary,
} from "../../test/builders";
import { Camera } from "../Camera";
import { body, scenario, scenarioSun, sources } from "./contextFixture";
import { fixed, rollOf } from "./fixture";
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
  megastructureTypes: new Map<string, MegastructureView>(
    [ASSEMBLY, LGATE, GATEWAY].map((t) => [t.key, t]),
  ),
  starbaseLevels: new Map<string, StarbaseLevelView>([[CITADEL.key, CITADEL]]),
  planetClasses: new Map([...sources.planetClasses, [SEGMENT.key, SEGMENT]]),
  names: new Map([["gateway_ruined", "Ruined Gateway"]]),
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
  const ctx = scenario(PLANETS, roll, OVER);
  const details = ctx.details && {
    ...ctx.details,
    megastructures: rows.map((row) => megastructureSummary(row)),
    starbase,
  };
  return scenario(PLANETS, roll, { ...OVER, details });
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
