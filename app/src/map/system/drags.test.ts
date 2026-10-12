import { describe, expect, it } from "vitest";
import { MEGASTRUCTURE_REFUSALS } from "../../lib/details/megastructureMoves";
import { DRAG_HINTS } from "../../lib/details/orbitIntent";
import { polar } from "../../lib/details/orbits";
import type { Pt } from "../../lib/geometry/pt";
import { megastructureSummary, megastructureTypeView } from "../../test/builders";
import { sceneRecorder as recorder } from "../../test/mapIntent";
import { systemContext, type SystemContext } from "./context";
import {
  BESIDE,
  lastStep,
  LONE,
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
  const structure = (id: number) => ({ kind: "megastructure" as const, id });
  const types = new Map(
    [
      megastructureTypeView("gateway_final", {
        bypass_type: "gateway",
        placement: { place: "free", outside_gravity_well: true },
      }),
      megastructureTypeView("think_tank_3"),
      megastructureTypeView("dyson_sphere_5", { placement: { place: "body", star_only: true } }),
      megastructureTypeView("orbital_ring_ruined"),
    ].map((t) => [t.key, t]),
  );

  function structureFrame(): SystemContext {
    const frame = orbitFrame();
    const megastructures = [
      megastructureSummary({ id: GATEWAY, kind: "gateway_final", at: [0, 250] }),
      megastructureSummary({ id: NEXUS, kind: "think_tank_3", planet: LONE, at: null }),
      megastructureSummary({ id: SPHERE, kind: "dyson_sphere_5", planet: STAR }),
      megastructureSummary({ id: RING, kind: "orbital_ring_ruined", planet: PLANET, at: null }),
    ];
    return systemContext({
      ...frame,
      megastructureTypes: types,
      details: { ...frame.details!, megastructures },
    });
  }

  function press(id: number, from: Pt) {
    const model = new SystemGestureModel();
    const intent = recorder(structureFrame());
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
    expect(step?.marks.targets).toEqual(others.filter((id) => id !== PLANET && id !== STAR));
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
});
