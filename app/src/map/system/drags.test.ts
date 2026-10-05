import { describe, expect, it } from "vitest";
import { DRAG_HINTS } from "../../lib/details/orbitIntent";
import { sceneRecorder as recorder } from "../../test/mapIntent";
import { systemContext, type SystemContext } from "./context";
import { lastStep, named, on, ORBITS, orbitFrame, start, without } from "./dragFixture";
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
