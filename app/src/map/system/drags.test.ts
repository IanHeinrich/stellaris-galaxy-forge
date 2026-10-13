import { describe, expect, it } from "vitest";
import { MEGASTRUCTURE_REFUSALS } from "../../lib/details/megastructureMoves";
import { DRAG_HINTS, type GeometryIntent } from "../../lib/details/orbitIntent";
import { polar, polarAbout } from "../../lib/details/orbits";
import type { Pt } from "../../lib/geometry/pt";
import { megastructureSummary, megastructureTypeView } from "../../test/builders";
import { sceneRecorder as recorder } from "../../test/mapIntent";
import { systemContext, type SystemContext } from "./context";
import { withStructures } from "./contextFixture";
import {
  BESIDE,
  lastStep,
  LONE,
  MOON,
  named,
  on,
  ORBITS,
  orbitFrame,
  PLANET,
  pointOf,
  STAR,
  start,
  without,
} from "./dragFixture";
import { grip, over } from "./fixture";
import { SystemGestureModel } from "./SystemGestureModel";

describe("a handle dragged in the system scene", () => {
  it("moves a belt in whole units, snapping onto a body's ring", () => {
    const { model, intent } = start();
    const belt = { kind: "belt" as const, index: 0 };
    model.handle(on("down", [0, -120], { target: grip(belt), draggable: true }), intent);
    model.handle(on("move", [0, -135.3]), intent);
    const step = lastStep(intent);
    expect(step?.intent).toEqual({ kind: "setBeltRadius", system: ORBITS, index: 0, radius: 135 });
    expect(step?.readout.text).toBe("Belt · rocky · r 120 → 135");
    expect(step?.hint).toBe(DRAG_HINTS.belt);
    model.handle(on("move", [0, -121]), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ radius: 124 });
    expect(named(intent.calls, "openBody")).toEqual([]);
  });

  it("moves the inner radius no lower than its floor", () => {
    const { model, intent } = start();
    const inner = { kind: "innerRadius" as const };
    model.handle(on("down", [0, -200], { target: grip(inner), draggable: true }), intent);
    model.handle(on("move", [0, -240]), intent);
    expect(lastStep(intent)?.readout.text).toBe("Inner radius 200 → 240");
    model.handle(on("move", [0, -40]), intent);
    const floor = intent.frame().editing.innerFloor;
    const clamped = { kind: "innerRadius", system: ORBITS, radius: floor };
    expect(lastStep(intent)?.intent).toEqual(clamped);
    model.handle(on("up", [0, -40]), intent);
    expect(named(intent.calls, "commit")).toEqual([["commit", clamped]]);
  });
});

describe("a wormhole dragged in the system scene", () => {
  const WORMHOLE = 30;
  const TUNNEL = 32;
  const hole = over("wormhole", WORMHOLE);
  const tunnel = over("wormhole", TUNNEL);
  function wormholeFrame(): SystemContext {
    const frame = orbitFrame();
    const wormholes = [
      { id: WORMHOLE, bypass: 31, kind: "wormhole", partner: 8, x: 0, y: 100 },
      { id: TUNNEL, bypass: 33, kind: "shroud_tunnel", partner: null, x: -100, y: 0 },
    ];
    return systemContext({ ...frame, details: { ...frame.details!, wormholes } });
  }

  it("moves freely about the centre in whole units and degrees, Shift snapping to 15°", () => {
    const model = new SystemGestureModel();
    const intent = recorder(wormholeFrame());
    model.handle(on("down", [0, 100], { target: hole, draggable: true }), intent);
    model.handle(on("move", [69.6, 20.2]), intent);
    const moved = { kind: "moveWormhole", system: ORBITS, wormhole: WORMHOLE, radius: 72 };
    expect(lastStep(intent)?.intent).toEqual({ ...moved, angle: 16 });
    expect(lastStep(intent)?.readout.text).toBe("r 100 → 72 · 16°");
    expect(lastStep(intent)?.hint).toBe(DRAG_HINTS.wormhole);
    model.handle(on("move", [69.6, 20.2], { shift: true }), intent);
    model.handle(on("up", [69.6, 20.2], { shift: true }), intent);
    expect(named(intent.calls, "commit")).toEqual([["commit", { ...moved, angle: 15 }]]);
    expect(named(intent.calls, "openBody")).toEqual([]);
    expect(named(intent.calls, "openWormhole")).toEqual([["openWormhole", ORBITS, WORMHOLE]]);
  });

  it("opens a wormhole's page on a click, a shroud tunnel's too, and moves neither", () => {
    const model = new SystemGestureModel();
    const intent = recorder(wormholeFrame());
    model.handle(on("down", [0, 100], { target: hole, draggable: true }), intent);
    model.handle(on("up", [0, 100], { target: hole }), intent);
    model.handle(on("down", [-100, 0], { target: tunnel }), intent);
    model.handle(on("up", [-100, 0], { target: tunnel }), intent);
    expect(without(intent.calls, "hover")).toEqual([
      ["openWormhole", ORBITS, WORMHOLE],
      ["openWormhole", ORBITS, TUNNEL],
    ]);
  });

  it("pans from a shroud tunnel, which does not move", () => {
    const model = new SystemGestureModel();
    const intent = recorder(wormholeFrame());
    model.handle(on("down", [-100, 0], { target: tunnel, draggable: true }), intent);
    expect(model.handle(on("move", [-60, 30]), intent)).toBe("pan");
    model.handle(on("up", [-60, 30]), intent);
    expect(named(intent.calls, "commit")).toEqual([]);
    expect(named(intent.calls, "preview")).toEqual([]);
  });
});

describe("a megastructure dragged in the system scene", () => {
  const GATEWAY = 40;
  const NEXUS = 41;
  const SPHERE = 42;
  const RING = 43;
  const FURNACE = 44;
  /** The second moon of planet 2, which the furnace stands at. */
  const FURNACE_MOON = 4;
  const structure = (id: number) => ({ kind: "megastructure" as const, id });
  const types = [
    megastructureTypeView("gateway_final", {
      bypass_type: "gateway",
      placement: { place: "free", outside_gravity_well: true },
    }),
    megastructureTypeView("think_tank_3"),
    megastructureTypeView("dyson_sphere_5", { placement: { place: "body", star_only: true } }),
    megastructureTypeView("orbital_ring_ruined", { scales_with_planet: true }),
    megastructureTypeView("orbital_arc_furnace_4", {
      planet_only: true,
      may_stand_on_star: true,
    }),
    megastructureTypeView("atmosphere_shredder_0", { planet_only: true }),
  ];

  /**
   * The scene's structures, the one at the furnace's moon of type `furnace`, and the star's
   * Dyson Sphere unless `sphere` is false.
   */
  function structureFrame({
    furnace = "orbital_arc_furnace_4",
    sphere = true,
  } = {}): SystemContext {
    const megastructures = [
      megastructureSummary({ id: GATEWAY, kind: "gateway_final", at: [0, 250] }),
      megastructureSummary({ id: NEXUS, kind: "think_tank_3", planet: LONE, at: null }),
      ...(sphere
        ? [megastructureSummary({ id: SPHERE, kind: "dyson_sphere_5", planet: STAR })]
        : []),
      megastructureSummary({ id: RING, kind: "orbital_ring_ruined", planet: PLANET, at: null }),
      megastructureSummary({ id: FURNACE, kind: furnace, planet: FURNACE_MOON, at: null }),
    ];
    return withStructures(orbitFrame(), megastructures, { types });
  }

  function press(id: number, from: Pt, frame: SystemContext = structureFrame()) {
    const model = new SystemGestureModel();
    const intent = recorder(frame);
    model.handle(on("down", from, { target: structure(id), draggable: true }), intent);
    return { model, intent };
  }

  it("moves a gateway freely in whole units and degrees, wherever it is put", () => {
    const { model, intent } = press(GATEWAY, { x: 0, y: 250 });
    model.handle(on("move", [0, 300]), intent);
    const step = lastStep(intent);
    expect(step?.intent).toMatchObject({ megastructure: GATEWAY, at: { place: "free" } });
    expect(step?.readout.text).toBe("r 250 → 300 · 90°");
    expect(step?.hint).toBe(DRAG_HINTS.megastructure);
    model.handle(on("move", [0, 211.3]), intent);
    expect(lastStep(intent)?.readout.text).toBe("r 250 → 211 · 90°");
    model.handle(on("up", [0, 211.3]), intent);
    const to = polar(0, 0, 211, 90);
    expect(named(intent.calls, "commit")).toEqual([
      [
        "commit",
        {
          kind: "moveMegastructure",
          system: ORBITS,
          megastructure: GATEWAY,
          at: { place: "free", x: to.x, y: to.y },
        },
      ],
    ]);
  });

  it("rings the bodies a structure tied to a body may land on, and moves it onto one", () => {
    const frame = structureFrame();
    const { model, intent } = press(NEXUS, pointOf(frame, LONE));
    model.handle(on("move", pointOf(frame, BESIDE)), intent);
    const step = lastStep(intent);
    const others = frame.bodies.map((b) => b.placement.id).filter((id) => id !== LONE);
    const taken = [PLANET, STAR, FURNACE_MOON];
    expect(step?.marks.targets).toEqual(others.filter((id) => !taken.includes(id)));
    expect(step?.marks.host).toBe(BESIDE);
    expect(step?.changed).toBe(true);
    model.handle(on("up", pointOf(frame, BESIDE)), intent);
    expect(named(intent.calls, "commit")).toEqual([
      [
        "commit",
        {
          kind: "moveMegastructure",
          system: ORBITS,
          megastructure: NEXUS,
          at: { place: "body", body: BESIDE },
        },
      ],
    ]);
  });

  it("says why a body that has a megastructure refuses it, and sends nothing", () => {
    const frame = structureFrame();
    const { model, intent } = press(NEXUS, pointOf(frame, LONE));
    model.handle(on("move", pointOf(frame, PLANET)), intent);
    const why = MEGASTRUCTURE_REFUSALS.taken(frame.bodyById.get(PLANET)!.name);
    expect(lastStep(intent)?.readout).toEqual({ text: why, tone: "warn" });
    expect(lastStep(intent)?.marks).toMatchObject({ tone: "refused", other: PLANET });
    model.handle(on("up", pointOf(frame, PLANET)), intent);
    expect(named(intent.calls, "commit")).toEqual([]);
    expect(named(intent.calls, "refuse")).toEqual([["refuse", why]]);
  });

  it("refuses a planet for a type built only around a star, which has no other star here", () => {
    const frame = structureFrame();
    const { model, intent } = press(SPHERE, pointOf(frame, STAR));
    model.handle(on("move", pointOf(frame, BESIDE)), intent);
    expect(lastStep(intent)?.marks.targets).toEqual([]);
    const sphere = frame.structures.find((s) => s.id === SPHERE)!.name;
    expect(lastStep(intent)?.refused).toBe(MEGASTRUCTURE_REFUSALS.starOnly(sphere));
  });

  it("says why the star refuses a type the game never builds on a star", () => {
    const frame = structureFrame({ furnace: "atmosphere_shredder_0" });
    const { model, intent } = press(FURNACE, pointOf(frame, FURNACE_MOON), frame);
    model.handle(on("move", pointOf(frame, STAR)), intent);
    const name = frame.structures.find((s) => s.id === FURNACE)!.name;
    const why = MEGASTRUCTURE_REFUSALS.planetOnly(name);
    expect(lastStep(intent)?.readout).toEqual({ text: why, tone: "warn" });
    expect(lastStep(intent)?.marks).toMatchObject({ tone: "refused", other: STAR });
    expect(lastStep(intent)?.marks.targets).not.toContain(STAR);
    model.handle(on("up", pointOf(frame, STAR)), intent);
    expect(named(intent.calls, "commit")).toEqual([]);
    expect(named(intent.calls, "refuse")).toEqual([["refuse", why]]);
  });

  it("moves an Arc Furnace onto a star, which it hides nothing of", () => {
    const frame = structureFrame({ sphere: false });
    const { model, intent } = press(FURNACE, pointOf(frame, FURNACE_MOON), frame);
    model.handle(on("move", pointOf(frame, STAR)), intent);
    expect(lastStep(intent)?.marks.targets).toContain(STAR);
    model.handle(on("up", pointOf(frame, STAR)), intent);
    expect(named(intent.calls, "commit")).toEqual([
      [
        "commit",
        {
          kind: "moveMegastructure",
          system: ORBITS,
          megastructure: FURNACE,
          at: { place: "body", body: STAR },
        },
      ],
    ]);
  });

  /** Where the scene draws structure `id` while `intent`'s last step is shown. */
  function drawnAt(intent: ReturnType<typeof recorder>, id: number): Pt {
    const frame = intent.frame();
    const step = lastStep(intent)!;
    const ctx = systemContext(frame, {
      override: frame.geometry.preview(step.intent, frame),
      marks: step.marks,
    });
    const shown = ctx.structures.find((s) => s.kind === "megastructure" && s.id === id)!;
    return { x: shown.x, y: shown.y };
  }

  it("draws a free structure under the pointer at each move", () => {
    const { model, intent } = press(GATEWAY, { x: 0, y: 250 });
    for (const [x, y] of [
      [0, 260],
      [40, 200],
      [-120, -80],
    ]) {
      model.handle(on("move", [x, y]), intent);
      const at = drawnAt(intent, GATEWAY);
      expect(Math.hypot(at.x - x, at.y - y)).toBeLessThan(2.5);
    }
  });

  it("draws a wrapping structure under the pointer, on a body that takes it, and back on its body when released elsewhere", () => {
    const frame = structureFrame();
    const home = pointOf(frame, PLANET);
    const { model, intent } = press(RING, home);
    for (const [x, y] of [
      [home.x + 30, home.y],
      [0, -160],
      [-140, 20],
    ]) {
      model.handle(on("move", [x, y]), intent);
      expect(drawnAt(intent, RING)).toEqual({ x, y });
    }
    model.handle(on("move", pointOf(frame, BESIDE)), intent);
    expect(drawnAt(intent, RING)).toEqual(pointOf(frame, BESIDE));
    model.handle(on("move", [-140, 20]), intent);
    model.handle(on("up", [-140, 20]), intent);
    expect(named(intent.calls, "commit")).toEqual([]);
    expect(lastStep(intent)).toBeNull();
  });

  it("keeps a wrapping structure the size of its planet while a drag holds it off it", () => {
    const frame = structureFrame();
    const home = pointOf(frame, PLANET);
    const before = frame.structures.find((s) => s.id === RING)!.scale;
    const { model, intent } = press(RING, home);
    model.handle(on("move", [-140, 20]), intent);
    const step = lastStep(intent)!;
    const shown = systemContext(frame, {
      override: frame.geometry.preview(step.intent, frame),
      marks: step.marks,
    }).structures.find((s) => s.id === RING)!;
    expect(shown.scale).toBe(before);
    expect(before).not.toBe(1);
  });

  it("leaves a floating structure where it is dropped, still tied to its planet, as a moon", () => {
    const frame = structureFrame();
    const home = pointOf(frame, LONE);
    const { model, intent } = press(NEXUS, home);
    model.handle(on("move", [-140.3, 20.4]), intent);
    const about = polarAbout({ x: -140.3, y: 20.4 }, home);
    const radius = Math.round(about.radius);
    const angle = Math.round(about.angle) % 360;
    const to = polar(home.x, home.y, radius, angle);
    expect(drawnAt(intent, NEXUS)).toEqual({ x: to.x, y: to.y });
    expect(lastStep(intent)?.hint).toBe(DRAG_HINTS.floating);
    expect(lastStep(intent)?.readout.text).toBe(
      `r 0 → ${radius} · ${angle}° about ${frame.bodyById.get(LONE)!.name}`,
    );
    model.handle(on("up", [-140.3, 20.4]), intent);
    expect(named(intent.calls, "commit")).toEqual([
      [
        "commit",
        {
          kind: "moveMegastructure",
          system: ORBITS,
          megastructure: NEXUS,
          at: { place: "beside", body: LONE, x: to.x, y: to.y },
        },
      ],
    ]);
  });

  it("lands a floating structure on the radius and angle a moon dragged the same way lands on", () => {
    const frame = structureFrame();
    const planet = pointOf(frame, PLANET);
    const to = polar(planet.x, planet.y, 37.4, 33.4);

    const moon = new SystemGestureModel();
    const moonIntent = recorder(frame);
    const moonAt = pointOf(frame, MOON);
    moon.handle(on("down", moonAt, { target: over("body", MOON), draggable: true }), moonIntent);
    moon.handle(on("move", [to.x, to.y], { shift: true }), moonIntent);
    const moved = lastStep(moonIntent)?.intent;
    expect(moved).toMatchObject({ kind: "move", body: MOON });

    const nexusOnPlanet = systemContext({
      ...frame,
      details: {
        ...frame.details!,
        megastructures: frame.details!.megastructures.map((row) =>
          row.id === NEXUS
            ? { ...row, planet: PLANET }
            : row.id === RING
              ? { ...row, planet: null }
              : row,
        ),
      },
    });
    const model = new SystemGestureModel();
    const intent = recorder(nexusOnPlanet);
    model.handle(on("down", planet, { target: structure(NEXUS), draggable: true }), intent);
    model.handle(on("move", [to.x, to.y], { shift: true }), intent);
    const step = lastStep(intent)!;
    const at = (step.intent as Extract<GeometryIntent, { kind: "moveMegastructure" }>).at;
    expect(at.place).toBe("beside");
    if (at.place !== "beside" || moved?.kind !== "move") return;
    const about = polarAbout(at, planet);
    expect(about.radius).toBeCloseTo(moved.radius as number, 6);
    expect(about.angle).toBeCloseTo(moved.angle as number, 6);
    expect(moved.angle).toBe(30);
    expect(step.hint).toBe(DRAG_HINTS.floating);
  });

  it("holds a floating structure's angle with Ctrl, as a moon's", () => {
    const frame = structureFrame();
    const home = pointOf(frame, LONE);
    const { model, intent } = press(NEXUS, home);
    model.handle(on("move", [home.x + 30, home.y]), intent);
    model.handle(on("move", [home.x + 34, home.y + 1], { ctrl: true }), intent);
    model.handle(on("move", [home.x + 10, home.y + 50], { ctrl: true }), intent);
    const step = lastStep(intent)!;
    const at = (step.intent as Extract<GeometryIntent, { kind: "moveMegastructure" }>).at;
    if (at.place !== "beside") throw new Error(`beside, not ${at.place}`);
    const about = polarAbout(at, home);
    expect(about.angle).toBeCloseTo(0, 6);
    expect(about.radius).toBe(51);
    expect(step.hint).toBe(DRAG_HINTS.across);
  });

  it("ties a floating structure dropped on another planet to that planet", () => {
    const frame = structureFrame();
    const { model, intent } = press(NEXUS, pointOf(frame, LONE));
    model.handle(on("move", pointOf(frame, BESIDE)), intent);
    expect(lastStep(intent)?.marks.host).toBe(BESIDE);
    model.handle(on("up", pointOf(frame, BESIDE)), intent);
    expect(named(intent.calls, "commit")).toEqual([
      [
        "commit",
        {
          kind: "moveMegastructure",
          system: ORBITS,
          megastructure: NEXUS,
          at: { place: "body", body: BESIDE },
        },
      ],
    ]);
  });
});
