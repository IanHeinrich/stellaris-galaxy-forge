import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/gamedata", () => import("../../test/textures"));

import type { GeometryIntent } from "../../lib/details/orbitIntent";
import { SAVE_GEOMETRY } from "../../lib/details/saveGeometry";
import {
  beltKind,
  bodyLayout,
  orbitClasses,
  orbitSystem,
  planetSummary,
  systemDetails,
} from "../../test/builders";
import { bodySpawn } from "../../test/spawn";
import { systemRoll } from "../../test/rolls";
import { systemContext } from "./context";
import { body, save, scenario, scenarioSun, sources, sun } from "./contextFixture";
import { context as fixtureContext, fixed, rollOf, SYSTEM } from "./fixture";
import { type SystemSources } from "./sources";

describe("what a scenario leaves to chance", () => {
  it("marks a class the core says is a draw with a question mark", () => {
    const planets = [
      scenarioSun,
      body(2, "rl_unhabitable_planets", { orbit: fixed(60) }, { drawn: true }),
      body(3, "ideal_planet_class", { orbit: fixed(90) }, { drawn: true }),
      body(4, "pc_barren", { orbit: fixed(120) }),
    ];
    const ctx = scenario(planets, rollOf(planets));
    expect(ctx.bodies.map((b) => b.chance.planetClass)).toEqual([false, true, true, false]);
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

describe("what a scenario may not place", () => {
  it("marks a body the core says may not spawn, and leaves a save's bodies and the rest unmarked", () => {
    const planets = [
      scenarioSun,
      body(
        2,
        "pc_barren",
        { orbit: fixed(60) },
        { spawn: bodySpawn({ always: false, copy: 3, count: { min: 2, max: 4 } }) },
      ),
      body(3, "pc_barren", { orbit: fixed(90) }, { spawn: bodySpawn() }),
    ];
    const ctx = scenario(planets, rollOf(planets));
    expect(ctx.bodies.map((b) => b.chance.mayNotSpawn)).toEqual([false, true, false]);
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

describe("a system shown under a preview", () => {
  const src: SystemSources = {
    ...sources,
    id: 140,
    details: orbitSystem(),
    planetClasses: orbitClasses(),
    geometry: SAVE_GEOMETRY,
  };

  function previewed(intent: GeometryIntent) {
    const base = systemContext(src);
    const override = SAVE_GEOMETRY.preview(intent, base);
    return { base, shown: systemContext(src, { override, marks: null }) };
  }

  it("draws the moved layout, each moved body keeping its art and the system what may be edited", () => {
    const { base, shown } = previewed({
      kind: "move",
      system: 140,
      body: 2,
      radius: 80,
      angle: 30,
    });
    const [was, now] = [base.bodyById.get(2)!, shown.bodyById.get(2)!];
    expect(now.placement.ring?.radius).toBe(80);
    expect(shown.bodyById.get(3)?.placement.ring?.cx).toBeCloseTo(now.placement.x);
    expect(now.readout?.text).toBe("80");
    expect(now).not.toBe(was);
    expect(now.look).toBe(was.look);
    expect(now.iconKeys).toBe(was.iconKeys);
    expect(now.largeIconKeys).toBe(was.largeIconKeys);
    expect(shown.editing).toBe(base.editing);
    expect(shown.belts).toBe(base.belts);
    expect(base.layout.bodies.find((b) => b.id === 2)?.ring?.radius).toBe(60);
  });

  it("puts six handles on each belt and on the inner radius, where the save lets them move", () => {
    const { base, shown } = previewed({
      kind: "setBeltRadius",
      system: 140,
      index: 1,
      radius: 180,
    });
    const first = { kind: "belt", index: 0 };
    const [c, s] = [120 * Math.cos(Math.PI / 3), 120 * Math.sin(Math.PI / 3)];
    const spots = base.handles.slice(0, 6).map((h) => [h.x, h.y]);
    const expected = [
      [0, -120],
      [-s, -c],
      [-s, c],
      [0, 120],
      [s, c],
      [s, -c],
    ];
    spots.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(expected[i][0]);
      expect(y).toBeCloseTo(expected[i][1]);
    });
    expect(base.handles.map((h) => h.ref)).toEqual([
      ...Array(6).fill(first),
      ...Array(6).fill({ kind: "belt", index: 1 }),
      ...Array(6).fill({ kind: "innerRadius" }),
    ]);
    expect(shown.handles.map((h) => h.radius)).toEqual([
      ...Array(6).fill(120),
      ...Array(6).fill(180),
      ...Array(6).fill(210),
    ]);
  });

  it("lets nothing of a scenario system be edited, with no handles", () => {
    const planets = [scenarioSun, body(2, "pc_barren", { orbit: fixed(60) })];
    const ctx = scenario(planets, rollOf(planets));
    expect(ctx.editing.bodies.size).toBe(0);
    expect([ctx.editing.belts, ctx.editing.innerRadius]).toEqual([false, false]);
    expect(ctx.handles).toEqual([]);
  });
});

describe("the belts of a system", () => {
  const belted = (beltKinds: SystemSources["beltKinds"]) =>
    systemContext({
      ...fixtureContext({
        belts: [
          { kind: "icy_asteroid_belt", inner_radius: 60 },
          { kind: "space_fauna_belt", inner_radius: 120 },
          { kind: "fx_unknown_belt", inner_radius: 180 },
        ],
      }),
      beltKinds,
    });

  it("draws each belt with its kind's look, widened and thinned as the kind says", () => {
    const kinds = new Map(
      [
        beltKind("icy_asteroid_belt", "Icy", { look: "icy", emissive: true }),
        beltKind("space_fauna_belt", "Fauna", { look: "fauna", width: 2, density: 0.2 }),
      ].map((k) => [k.key, k]),
    );
    const [icy, fauna, unknown] = belted(kinds).belts;
    expect([icy.look, icy.emissive, fauna.look, unknown.look]).toEqual([
      "icy",
      true,
      "fauna",
      "rocky",
    ]);
    const width = (b: typeof icy) => b.outer - b.inner;
    expect(width(fauna)).toBeCloseTo(2 * width(icy));
    expect(fauna.density).toBeCloseTo(0.4);
    expect(icy.radius - icy.inner).toBeCloseTo(icy.outer - icy.radius);
  });

  it("draws every belt as a plain rocky belt before the game data is in", () => {
    const belts = belted(new Map()).belts;
    expect(belts.map((b) => [b.look, b.emissive, b.density])).toEqual([
      ["rocky", false, 1],
      ["rocky", false, 1],
      ["rocky", false, 1],
    ]);
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

describe("a system's wormholes", () => {
  it("draws a save's where a drag's preview puts them, and a scenario's none", () => {
    const wormholes = [{ id: 30, bypass: 31, kind: "wormhole", partner: 6, x: 0, y: 100 }];
    const saved = systemContext({
      ...fixtureContext({ wormholes }),
      geometry: SAVE_GEOMETRY,
    });
    const intent: GeometryIntent = {
      kind: "moveWormhole",
      system: SYSTEM,
      wormhole: 30,
      radius: 50,
      angle: 0,
    };
    const override = SAVE_GEOMETRY.preview(intent, saved);
    const [shown] = systemContext(saved, { override, marks: null }).wormholes;
    expect(shown).toMatchObject({ x: 50, y: 0, saved: { x: 0, y: 100 }, movable: true });
    expect(shown.name).toBe("Wormhole to S6");
    expect(scenario([scenarioSun], rollOf([scenarioSun])).wormholes).toEqual([]);
  });
});
