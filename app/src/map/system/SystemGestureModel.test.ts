import { describe, expect, it } from "vitest";
import {
  DRAG_HINTS,
  GEOMETRY_REASONS,
  NO_GEOMETRY,
  SAVE_GEOMETRY,
  toMoonHint,
  toStarHint,
} from "../../lib/details/orbitEdits";
import { polar } from "../../lib/details/orbits";
import type { Pt } from "../../lib/geometry/pt";
import type { ContextTarget } from "../../store/mapChromeStore";
import { orbitClasses, orbitSystem, saveBody } from "../../test/builders";
import {
  SCENE_SYSTEM as SYSTEM,
  sceneAt as at,
  sceneRecorder as recorder,
} from "../../test/mapIntent";
import type { DragStep } from "./bodyDrag";
import { systemContext, type SystemContext } from "./context";
import { drawnDisc } from "./geometry";
import { NO_SOURCES } from "./sources";
import { SystemGestureModel, type SystemInput, type SystemIntent } from "./SystemGestureModel";

const NEIGHBOUR = 9;

type Call = ReturnType<typeof recorder>["calls"][number];

function tap(model: SystemGestureModel, intent: SystemIntent, time: number, extra = {}): void {
  model.handle(at("down", 10, 10, { time, ...extra }), intent);
  model.handle(at("up", 10, 10, { time: time + 50, ...extra }), intent);
}

const without = (calls: Call[], name: keyof SystemIntent) => calls.filter(([n]) => n !== name);
const named = (calls: Call[], name: keyof SystemIntent) => calls.filter(([n]) => n === name);

describe("SystemGestureModel", () => {
  it("highlights the lane on a click on its arrow", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { exit: NEIGHBOUR });
    expect(without(intent.calls, "hover")).toEqual([["selectLane", NEIGHBOUR]]);
  });

  it("enters the neighbour on a double-click on the arrow", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { exit: NEIGHBOUR });
    tap(model, intent, 1250, { exit: NEIGHBOUR });
    expect(without(intent.calls, "hover")).toEqual([
      ["selectLane", NEIGHBOUR],
      ["enterSystem", NEIGHBOUR],
    ]);
  });

  it("enters nothing on two clicks on the arrow far apart in time", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { exit: NEIGHBOUR });
    tap(model, intent, 2000, { exit: NEIGHBOUR });
    expect(without(intent.calls, "hover")).toEqual([
      ["selectLane", NEIGHBOUR],
      ["selectLane", NEIGHBOUR],
    ]);
  });

  it("drops the lane and goes back to the system's page on a click on empty space", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { exit: NEIGHBOUR });
    tap(model, intent, 3000);
    expect(without(intent.calls, "hover")).toEqual([
      ["selectLane", NEIGHBOUR],
      ["selectLane", null],
      ["showSystem"],
    ]);
  });

  it("pans on a drag from empty space or with the middle button", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10), intent);
    expect(model.handle(at("move", 11, 11), intent)).toBe("consumed");
    expect(model.handle(at("move", 40, 40), intent)).toBe("pan");
    model.handle(at("up", 40, 40), intent);
    model.handle(at("down", 10, 10, { button: 1 }), intent);
    expect(model.handle(at("move", 11, 10), intent)).toBe("pan");
    model.handle(at("up", 11, 10, { button: 1 }), intent);
    expect(without(intent.calls, "hover")).toEqual([]);
  });

  it("hovers what is under the pointer while idle, and nothing while it pans", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    model.handle(at("move", 10, 10, { body: 3 }), intent);
    model.handle(at("move", 20, 10, { exit: NEIGHBOUR }), intent);
    model.handle(at("down", 30, 30), intent);
    model.handle(at("move", 60, 60, { body: 3 }), intent);
    expect(intent.calls).toEqual([
      ["hover", 3, null, null, null, 10, 10],
      ["hover", null, NEIGHBOUR, null, null, 20, 10],
      ["hover", null, null, null, null, 60, 60],
    ]);
  });

  it("opens the body menu on a right-click on a body, the belt menu on a belt's handle, and the space menu elsewhere", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { button: 2, body: 3 }), intent);
    model.handle(at("down", 50, 60, { button: 2, wx: 12.5, wy: -4 }), intent);
    const belt = { kind: "belt" as const, index: 1 };
    model.handle(at("down", 70, 80, { button: 2, handle: belt }), intent);
    const inner = { kind: "innerRadius" as const };
    model.handle(at("down", 90, 80, { button: 2, handle: inner, wx: 0, wy: -200 }), intent);
    const body: ContextTarget = { kind: "body", system: SYSTEM, id: 3 };
    const space: ContextTarget = { kind: "systemSpace", system: SYSTEM, x: 12.5, y: -4 };
    const onBelt: ContextTarget = { kind: "belt", system: SYSTEM, index: 1 };
    const onInner: ContextTarget = { kind: "systemSpace", system: SYSTEM, x: 0, y: -200 };
    expect(intent.calls).toEqual([
      ["contextMenu", body, 10, 10],
      ["contextMenu", space, 50, 60],
      ["contextMenu", onBelt, 70, 80],
      ["contextMenu", onInner, 90, 80],
    ]);
  });

  it("opens a body's page on a left click, each click alike", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    tap(model, intent, 1000, { body: 3 });
    tap(model, intent, 1100, { body: 3 });
    tap(model, intent, 3000, { body: 4 });
    expect(without(intent.calls, "hover")).toEqual([
      ["openBody", SYSTEM, 3],
      ["openBody", SYSTEM, 3],
      ["openBody", SYSTEM, 4],
    ]);
  });

  it("opens nothing on a drag that starts on a body that cannot move, or a middle click on one", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { body: 3 }), intent);
    expect(model.handle(at("move", 40, 40, { body: 3 }), intent)).toBe("pan");
    model.handle(at("up", 40, 40, { body: 3 }), intent);
    tap(model, intent, 2000, { body: 3, button: 1 });
    expect(without(intent.calls, "hover")).toEqual([]);
  });
});

const ORBITS = 140;
const [STAR, PLANET, MOON, LONE, ASTEROID, BESIDE] = [1, 2, 3, 5, 6, 7];

const cosd = (deg: number) => Math.cos((deg * Math.PI) / 180);
const sind = (deg: number) => Math.sin((deg * Math.PI) / 180);

function polarAt(radius: number, angle: number, about: Pt = { x: 0, y: 0 }): [number, number] {
  const p = polar(about.x, about.y, radius, angle);
  return [p.x, p.y];
}

/** `orbitSystem` with each body named `P<id>`, and planet 7 at 60 and 90°, beside planet 2. */
function orbitFrame(): SystemContext {
  const details = orbitSystem();
  const beside = saveBody(BESIDE, "pc_arid", polarAt(60, 90), 60, 12);
  const planets = [...details.planets, beside].map((p) => ({ ...p, name_key: `NAME_P${p.id}` }));
  return systemContext({
    ...NO_SOURCES,
    id: ORBITS,
    kind: "save",
    details: { ...details, planets },
    planetClasses: orbitClasses(),
    geometry: SAVE_GEOMETRY,
  });
}

function pointOf(frame: SystemContext, id: number): Pt {
  const body = frame.layout.bodies.find((b) => b.id === id);
  if (!body) throw new Error(`no body ${id}`);
  return { x: body.x, y: body.y };
}

/** An input at the scene point `p`, in the orbit system. */
function on(
  kind: SystemInput["kind"],
  p: Pt | [number, number],
  extra: Partial<SystemInput> = {},
): SystemInput {
  const [x, y] = Array.isArray(p) ? p : [p.x, p.y];
  return at(kind, x, y, { system: ORBITS, ...extra });
}

/** Presses body `id` where it stands and moves it by `nudge`, past the threshold, with `extra`. */
function grab(
  model: SystemGestureModel,
  intent: SystemIntent,
  id: number,
  nudge: Pt,
  extra: Partial<SystemInput> = {},
): void {
  const from = pointOf(intent.frame(), id);
  model.handle(on("down", from, { body: id, draggable: true }), intent);
  model.handle(on("move", { x: from.x + nudge.x, y: from.y + nudge.y }, extra), intent);
}

/** Four pixels out from the centre at `angle`, and four round it. */
const outward = (angle: number): Pt => ({ x: 4 * cosd(angle), y: 4 * sind(angle) });
const around = (angle: number): Pt => ({ x: -4 * sind(angle), y: 4 * cosd(angle) });

function lastStep(intent: ReturnType<typeof recorder>): DragStep | null {
  const previews = named(intent.calls, "preview");
  return (previews[previews.length - 1]?.[1] as DragStep | null | undefined) ?? null;
}

describe("a body dragged in the system scene", () => {
  it("does nothing under the threshold", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    const from = pointOf(intent.frame(), LONE);
    model.handle(on("down", from, { body: LONE, draggable: true }), intent);
    model.handle(on("move", { x: from.x + 2, y: from.y + 1 }), intent);
    expect(intent.calls).toEqual([]);
  });

  it("opens the body's page, then moves it freely in whole units and degrees", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, around(120));
    model.handle(on("move", polarAt(107.4, 133.4)), intent);
    expect(named(intent.calls, "openBody")).toEqual([["openBody", ORBITS, LONE]]);
    const step = lastStep(intent);
    expect(step?.intent).toEqual({
      kind: "move",
      system: ORBITS,
      body: LONE,
      radius: 107,
      angle: 133,
    });
    expect(step?.readout.text).toBe("orbit 100 → 107 · 133°");
    expect(step?.hint).toBe(DRAG_HINTS.free);
  });

  it("with Ctrl, moves it along its orbit at its radius in whole degrees", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, around(120));
    model.handle(on("move", polarAt(97, 133.4), { ctrl: true }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toEqual({
      kind: "move",
      system: ORBITS,
      body: LONE,
      radius: 100,
      angle: 133,
    });
    expect(step?.readout.text).toBe("orbit 100 · 133°");
    expect(step?.hint).toBe(DRAG_HINTS.along);
  });

  it("snaps to 15° with Shift, also when Shift changes with the pointer still", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, around(120));
    const there = polarAt(100, 128);
    model.handle(on("move", there), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ angle: 128 });
    model.handle(on("move", there, { shift: true }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ radius: 100, angle: 135 });
    model.handle(on("move", there), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ angle: 128 });
  });

  it("with Ctrl, moves it across orbits in whole units, its angle held", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, outward(120));
    model.handle(on("move", polarAt(107.4, 121), { ctrl: true }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toMatchObject({ kind: "move", body: LONE, radius: 107 });
    expect(step?.intent.kind === "move" && step.intent.angle).toBeCloseTo(120);
    expect(step?.readout.text).toBe("orbit 100 → 107 · 120°");
    expect(step?.hint).toBe(DRAG_HINTS.across);
  });

  it("holds it where it is when Ctrl goes down mid-drag, and frees it when Ctrl is released", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, outward(120));
    model.handle(on("move", polarAt(107.4, 121)), intent);
    const there = polarAt(107.4, 131);
    model.handle(on("move", there), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ radius: 107, angle: 131 });
    model.handle(on("move", there, { ctrl: true }), intent);
    const held = lastStep(intent);
    expect(held?.intent).toMatchObject({ radius: 107, angle: 131 });
    expect(held?.hint).toBe(DRAG_HINTS.along);
    model.handle(on("move", polarAt(97, 140), { ctrl: true }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ radius: 107, angle: 140 });
    model.handle(on("move", polarAt(97, 140)), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ radius: 97, angle: 140 });
    expect(lastStep(intent)?.hint).toBe(DRAG_HINTS.free);
  });

  it("with Ctrl pressed mid-drag, takes the axis from the travel so far and holds the angle it has reached", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, around(120));
    const there = polarAt(145.4, 123);
    model.handle(on("move", there), intent);
    model.handle(on("move", there, { ctrl: true }), intent);
    const held = lastStep(intent);
    expect(held?.intent).toMatchObject({ radius: 145, angle: 123 });
    expect(held?.hint).toBe(DRAG_HINTS.across);
    model.handle(on("move", polarAt(160.4, 110), { ctrl: true }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ radius: 160, angle: 123 });
  });

  it("with Ctrl, stays about the star over another planet and over one that refuses it", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, around(120), { ctrl: true });
    const planet = pointOf(intent.frame(), PLANET);
    model.handle(on("move", { x: planet.x + 3, y: planet.y }, { ctrl: true }), intent);
    const over = lastStep(intent);
    expect(over?.intent).toMatchObject({ kind: "move", body: LONE, radius: 100 });
    expect(over?.marks.host).toBeNull();
    expect(over?.hint).toBe(DRAG_HINTS.along);
    model.handle(on("move", pointOf(intent.frame(), MOON), { ctrl: true }), intent);
    const refusing = lastStep(intent);
    expect(refusing?.intent).toMatchObject({ kind: "move", body: LONE, radius: 100 });
    expect(refusing?.refused).toBeUndefined();
    expect(refusing?.marks.tone).not.toBe("refused");
  });

  it("takes another ring's radius exactly within a few pixels of it, at the pointer's angle", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, around(120));
    model.handle(on("move", polarAt(119, 150)), intent);
    const step = lastStep(intent);
    expect(step?.intent).toMatchObject({ radius: 124, angle: 150 });
    expect(step?.marks).toMatchObject({ tone: "shared", other: ASTEROID });
    expect(step?.readout.text).toBe("orbit 124 · shared with P6");
  });

  it("marks a body it would stand on top of, and still commits the move", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, PLANET, around(30));
    model.handle(on("move", polarAt(60, 90.3)), intent);
    const step = lastStep(intent);
    expect(step?.marks).toMatchObject({ tone: "overlap", other: BESIDE });
    expect(step?.readout).toEqual({ text: "overlaps P7", tone: "warn" });
    expect(step?.refused).toBeUndefined();
    model.handle(on("up", polarAt(60, 90.3)), intent);
    expect(named(intent.calls, "commit")).toHaveLength(1);
  });

  it("makes it a moon of a planet it is held over, and a plain move again once it leaves", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, around(120));
    const planet = pointOf(intent.frame(), PLANET);
    model.handle(on("move", { x: planet.x + 3, y: planet.y }), intent);
    const hosted = lastStep(intent);
    expect(hosted?.intent).toEqual({
      kind: "reparent",
      system: ORBITS,
      body: LONE,
      parent: PLANET,
      radius: 25,
      angle: 0,
    });
    expect(hosted?.marks.host).toBe(PLANET);
    expect(hosted?.readout.text).toBe("moon of P2 · orbit 25 · 0°");
    expect(hosted?.hint).toBe(toMoonHint("P2"));
    model.handle(on("move", polarAt(100, 150)), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ kind: "move", radius: 100, angle: 150 });
  });

  it("takes it as a moon within the ring it would land on, and holds it until half as far again", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, around(120));
    const planet = intent.frame().layout.bodies.find((b) => b.id === PLANET)!;
    const reach = Math.max(18, drawnDisc(planet.disc, 1) + 10, 25 + 8);
    const away = (px: number) => polarAt(px, 300, planet);
    model.handle(on("move", away(reach + 0.5)), intent);
    expect(lastStep(intent)?.marks.host).toBeNull();
    model.handle(on("move", away(reach - 0.5)), intent);
    expect(lastStep(intent)?.marks.host).toBe(PLANET);
    model.handle(on("move", away(reach * 1.4)), intent);
    expect(lastStep(intent)?.marks.host).toBe(PLANET);
    model.handle(on("move", away(reach * 1.6)), intent);
    expect(lastStep(intent)?.marks.host).toBeNull();
    expect(lastStep(intent)?.intent.kind).toBe("move");
  });

  it.each([
    ["a moon", MOON, GEOMETRY_REASONS.moonHost, "P3 is a moon"],
    ["an asteroid", ASTEROID, GEOMETRY_REASONS.asteroidHost, "P6 is an asteroid"],
    ["the star it orbits", STAR, GEOMETRY_REASONS.orbitsCentre, "P1 is the star it orbits"],
  ])(
    "refuses %s as a parent, held on its orbit, and says why on release",
    (_, id, reason, text) => {
      const model = new SystemGestureModel();
      const intent = recorder(orbitFrame());
      grab(model, intent, LONE, around(120));
      const over = pointOf(intent.frame(), id);
      model.handle(on("move", over), intent);
      const step = lastStep(intent);
      expect(step?.refused).toBe(reason);
      expect(step?.readout).toEqual({ text, tone: "warn" });
      expect(step?.intent).toMatchObject({ kind: "move" });
      const before = intent.calls.length;
      model.handle(on("up", over), intent);
      const after = intent.calls.slice(before);
      expect(after.map(([n]) => n)).toEqual(["preview", "hover", "refuse"]);
      expect(after[0]).toEqual(["preview", null]);
      expect(after[2]).toEqual(["refuse", reason]);
    },
  );

  it("refuses a ring world segment as a parent, saying why", () => {
    const model = new SystemGestureModel();
    const frame = orbitFrame();
    const planets = [
      ...frame.details!.planets,
      saveBody(8, "pc_ringworld_seam", [0, -160], 160, 10),
    ];
    const planetClasses = new Map(orbitClasses());
    const segment = { ...planetClasses.get("pc_arid")!, key: "pc_ringworld_seam", ringworld: true };
    planetClasses.set("pc_ringworld_seam", segment);
    const named8 = planets.map((p) => ({ ...p, name_key: `NAME_P${p.id}` }));
    const intent = recorder(
      systemContext({
        ...NO_SOURCES,
        id: ORBITS,
        kind: "save",
        details: { ...frame.details!, planets: named8 },
        planetClasses,
        geometry: SAVE_GEOMETRY,
      }),
    );
    grab(model, intent, LONE, around(120));
    model.handle(on("move", [0, -160]), intent);
    const step = lastStep(intent);
    expect(step?.refused).toBe(GEOMETRY_REASONS.ringworld);
    expect(step?.readout).toEqual({ text: "P8 is a ring world segment", tone: "warn" });
  });

  it("moves a companion star freely, and says a star can't become a moon over a planet", () => {
    const model = new SystemGestureModel();
    const details = orbitSystem();
    const companion = saveBody(8, "pc_g_star", [-240, 0], 240, 20);
    const planets = [...details.planets, companion].map((p) => ({
      ...p,
      name_key: `NAME_P${p.id}`,
    }));
    const intent = recorder(
      systemContext({
        ...NO_SOURCES,
        id: ORBITS,
        kind: "save",
        details: { ...details, planets },
        planetClasses: orbitClasses(),
        geometry: SAVE_GEOMETRY,
      }),
    );
    grab(model, intent, 8, around(180));
    model.handle(on("move", polarAt(250.3, 170.2)), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ kind: "move", radius: 250, angle: 170 });
    model.handle(on("move", pointOf(intent.frame(), LONE)), intent);
    const step = lastStep(intent);
    expect(step?.readout).toEqual({ text: "overlaps P5", tone: "warn" });
    expect(step?.marks.host).toBeNull();
    model.handle(on("move", polarAt(100, 125)), intent);
    expect(lastStep(intent)?.readout).toEqual({ text: GEOMETRY_REASONS.starMoon, tone: "warn" });
  });

  it("makes a moon a planet once it is dragged far from its planet", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    const planet = pointOf(intent.frame(), PLANET);
    grab(model, intent, MOON, outward(90));
    model.handle(on("move", { x: planet.x, y: planet.y + 30 }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ kind: "move", radius: 30 });
    const away = { x: planet.x, y: planet.y + 75 };
    model.handle(on("move", away), intent);
    const step = lastStep(intent);
    expect(step?.intent).toEqual({
      kind: "reparent",
      system: ORBITS,
      body: MOON,
      parent: null,
      radius: Math.round(Math.hypot(away.x, away.y)),
      angle: Math.round((Math.atan2(away.y, away.x) * 180) / Math.PI),
    });
    expect(step?.hint).toBe(DRAG_HINTS.toPlanet);
    expect(step?.readout.text).toMatch(/^planet · orbit \d+ · \d+°$/);
  });

  it("makes a moon whose planet is missing a planet of the star where it is dropped", () => {
    const model = new SystemGestureModel();
    const details = orbitSystem();
    const orphan = saveBody(58, "pc_barren", [100, 20], 10, 6, 57);
    const planets = [...details.planets, orphan].map((p) => ({ ...p, name_key: `NAME_P${p.id}` }));
    const intent = recorder(
      systemContext({
        ...NO_SOURCES,
        id: ORBITS,
        kind: "save",
        details: { ...details, planets },
        planetClasses: orbitClasses(),
        geometry: SAVE_GEOMETRY,
      }),
    );
    const from = Math.hypot(100, 20);
    grab(model, intent, 58, around((Math.atan2(20, 100) * 180) / Math.PI));
    model.handle(on("move", polarAt(from, 40), { ctrl: true }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toMatchObject({ kind: "reparent", body: 58, parent: null, angle: 40 });
    expect(step?.intent.kind === "reparent" && step.intent.radius).toBeCloseTo(from);
    expect(step?.changed).toBe(true);
    model.handle(on("up", polarAt(from, 40), { ctrl: true }), intent);
    expect(named(intent.calls, "commit")).toHaveLength(1);
  });

  it("ends the drag with no commit when the last button up is not the left", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, around(120));
    model.handle(on("move", polarAt(100, 140)), intent);
    model.handle(on("up", polarAt(100, 140), { button: 2 }), intent);
    expect(intent.calls[intent.calls.length - 1]).toEqual(["preview", null]);
    expect(named(intent.calls, "commit")).toEqual([]);
    expect(model.busy()).toBe(false);
  });

  it("ends a press or a pan on any button's release, clicking only on the left", () => {
    const model = new SystemGestureModel();
    const intent = recorder();
    model.handle(at("down", 10, 10, { body: 3 }), intent);
    model.handle(at("up", 10, 10, { button: 2 }), intent);
    expect(model.busy()).toBe(false);
    model.handle(at("down", 10, 10), intent);
    model.handle(at("move", 40, 40), intent);
    model.handle(at("up", 40, 40, { button: 2 }), intent);
    expect(model.busy()).toBe(false);
    expect(without(intent.calls, "hover")).toEqual([]);
  });

  it("keeps a locked planet about the star over another planet, and says what it is locked to", () => {
    const model = new SystemGestureModel();
    const intent = recorder({ ...orbitFrame(), lockedBodies: new Set([LONE]) });
    grab(model, intent, LONE, around(120));
    const planet = pointOf(intent.frame(), PLANET);
    model.handle(on("move", { x: planet.x + 3, y: planet.y }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toMatchObject({ kind: "move", body: LONE });
    expect(step?.marks.host).toBeNull();
    expect(step?.readout.text).toMatch(/^locked to the star · orbit 60 · shared with P\d$/);
  });

  it("says why a planet with moons cannot become a moon when held over a planet, and moves it on release", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, PLANET, around(30));
    const over = polarAt(100, 125);
    model.handle(on("move", over), intent);
    const step = lastStep(intent);
    expect(step?.readout).toEqual({ text: GEOMETRY_REASONS.hasMoons, tone: "warn" });
    expect(step?.marks.host).toBeNull();
    expect(step?.refused).toBeUndefined();
    expect(step?.intent).toMatchObject({ kind: "move", body: PLANET, radius: 100, angle: 125 });
    model.handle(on("up", over), intent);
    expect(named(intent.calls, "commit")).toEqual([["commit", step?.intent]]);
    expect(named(intent.calls, "refuse")).toEqual([]);
  });

  it("puts it back with no commit on Esc mid-drag", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, around(120));
    model.handle(on("move", polarAt(100, 140)), intent);
    model.cancel(intent);
    model.handle(on("up", polarAt(100, 140)), intent);
    expect(intent.calls[intent.calls.length - 1]).toEqual(["preview", null]);
    expect(named(intent.calls, "commit")).toEqual([]);
    expect(model.busy()).toBe(false);
  });

  it("commits once, on release, what it last showed", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    grab(model, intent, LONE, around(120));
    for (const angle of [125, 130, 140]) model.handle(on("move", polarAt(100, angle)), intent);
    model.handle(on("up", polarAt(100, 140)), intent);
    expect(named(intent.calls, "commit")).toEqual([
      ["commit", { kind: "move", system: ORBITS, body: LONE, radius: 100, angle: 140 }],
    ]);
  });

  it("pans when the frame lets nothing move, as a scenario's does", () => {
    const model = new SystemGestureModel();
    const frame = orbitFrame();
    const intent = recorder({ ...frame, editing: NO_GEOMETRY.editing(frame) });
    const from = pointOf(frame, LONE);
    model.handle(on("down", from, { body: LONE, draggable: true }), intent);
    expect(model.handle(on("move", { x: from.x + 10, y: from.y }), intent)).toBe("pan");
    model.handle(on("up", { x: from.x + 10, y: from.y }), intent);
    expect(without(intent.calls, "hover")).toEqual([]);
  });

  it("pans on a middle drag from a body that can move", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    const from = pointOf(intent.frame(), LONE);
    model.handle(on("down", from, { body: LONE, draggable: true, button: 1 }), intent);
    expect(model.handle(on("move", { x: from.x + 10, y: from.y }), intent)).toBe("pan");
    model.handle(on("up", { x: from.x + 10, y: from.y }, { button: 1 }), intent);
    expect(without(intent.calls, "hover")).toEqual([]);
  });
});

describe("a body dragged onto a companion star", () => {
  const COMPANION = 8;
  const ITS_PLANET = 9;
  const ITS_MOON = 10;
  const NEXT_PLANET = 11;
  const star = { x: -240, y: 0 };
  const itsPlanet = { x: -224, y: 0 };

  /**
   * `orbitFrame` with star 8 at 240 out on the left, and planet 9 orbiting it at 16; with `moons`,
   * also moon 10 orbiting planet 9 at 8, and planet 11 orbiting the star at 30 and 270°.
   */
  function binaryFrame(moons = false): SystemContext {
    const details = orbitSystem();
    const companion = saveBody(COMPANION, "pc_g_star", [-240, 0], 240, 20);
    const itsPlanet = saveBody(ITS_PLANET, "pc_arid", [-224, 0], 16, 10, COMPANION);
    const extra = moons
      ? [
          saveBody(ITS_MOON, "pc_barren", [-224, 8], 8, 5, ITS_PLANET),
          saveBody(NEXT_PLANET, "pc_arid", [-240, -30], 30, 10, COMPANION),
        ]
      : [];
    const planets = [...details.planets, companion, itsPlanet, ...extra].map((p) => ({
      ...p,
      name_key: `NAME_P${p.id}`,
    }));
    return systemContext({
      ...NO_SOURCES,
      id: ORBITS,
      kind: "save",
      details: { ...details, planets },
      planetClasses: orbitClasses(),
      geometry: SAVE_GEOMETRY,
    });
  }

  /** The least orbit about the companion: just past its drawn disc at one pixel a unit. */
  function starFloor(frame: SystemContext): number {
    const disc = frame.layout.bodies.find((b) => b.id === COMPANION)!.disc;
    return Math.max(10, Math.ceil(drawnDisc(disc, 1) + 5));
  }

  it("makes a planet with moons orbit it at the pointer's distance, never inside the star's disc", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame());
    grab(model, intent, PLANET, around(30));
    model.handle(on("move", polarAt(33.4, 90, star)), intent);
    expect(lastStep(intent)?.readout).toEqual({ text: "orbits P8 · orbit 33 · 90°" });
    model.handle(on("move", polarAt(2, 90, star)), intent);
    const floor = starFloor(intent.frame());
    const step = lastStep(intent);
    expect(step?.intent).toEqual({
      kind: "reparent",
      system: ORBITS,
      body: PLANET,
      parent: COMPANION,
      radius: floor,
      angle: 90,
    });
    expect(step?.marks.host).toBe(COMPANION);
    expect(step?.readout).toEqual({ text: `orbits P8 · orbit ${floor} · 90°` });
    expect(step?.hint).toBe(toStarHint("P8"));
    expect(step?.refused).toBeUndefined();
    model.handle(on("up", polarAt(2, 90, star)), intent);
    expect(named(intent.calls, "commit")).toEqual([["commit", step?.intent]]);
  });

  it("puts it on one of the star's orbits within a few pixels of it", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame());
    grab(model, intent, PLANET, around(30));
    model.handle(on("move", polarAt(20, 90, star)), intent);
    const step = lastStep(intent);
    expect(step?.intent).toMatchObject({ parent: COMPANION, radius: 16, angle: 90 });
    expect(step?.marks).toMatchObject({ tone: "shared", other: ITS_PLANET, host: COMPANION });
    expect(step?.readout.text).toBe("orbits P8 · orbit 16 · shared with P9");
  });

  it("takes a planet within 40 units of the star, and not beyond", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame());
    grab(model, intent, LONE, around(120));
    model.handle(on("move", polarAt(40.5, 180, star), { scale: 1 }), intent);
    expect(lastStep(intent)?.marks.host).toBeNull();
    model.handle(on("move", polarAt(39.5, 180, star), { scale: 1 }), intent);
    expect(lastStep(intent)?.marks.host).toBe(COMPANION);
    expect(lastStep(intent)?.intent).toMatchObject({ parent: COMPANION, radius: 40 });
  });

  it("keeps a moon about its planet beside the star until it is past its detach distance", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame(true));
    grab(model, intent, ITS_MOON, around(90));
    model.handle(on("move", polarAt(8, 180, itsPlanet)), intent);
    const round = lastStep(intent);
    expect(round?.intent).toEqual({
      kind: "move",
      system: ORBITS,
      body: ITS_MOON,
      radius: 8,
      angle: 180,
    });
    expect(round?.marks.host).toBeNull();
    model.handle(on("move", polarAt(38, 180, star)), intent);
    const away = lastStep(intent);
    expect(away?.intent).toMatchObject({
      kind: "reparent",
      parent: COMPANION,
      radius: 38,
      angle: 180,
    });
    expect(away?.marks.host).toBe(COMPANION);
    expect(away?.readout.text).toBe("orbits P8 · orbit 38 · 180°");
  });

  it("makes a moon a moon of a neighbouring planet nearer its own planet than its detach distance", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame(true));
    grab(model, intent, ITS_MOON, around(90));
    model.handle(on("move", { x: -240, y: -12 }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toEqual({
      kind: "reparent",
      system: ORBITS,
      body: ITS_MOON,
      parent: NEXT_PLANET,
      radius: 15,
      angle: 90,
    });
    expect(step?.marks.host).toBe(NEXT_PLANET);
    expect(step?.readout.text).toBe("moon of P11 · orbit 15 · 90°");
  });

  it("with Ctrl, keeps a moon about its planet over a neighbouring planet and over the star, and a planet off the star", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame(true));
    grab(model, intent, ITS_MOON, outward(90));
    model.handle(on("move", { x: -240, y: -12 }, { ctrl: true }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ kind: "move", body: ITS_MOON });
    expect(lastStep(intent)?.marks.host).toBeNull();
    model.handle(on("move", polarAt(38, 180, star), { ctrl: true }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ kind: "move", body: ITS_MOON, angle: 90 });
    expect(lastStep(intent)?.marks.host).toBeNull();
    model.handle(on("up", polarAt(38, 180, star), { ctrl: true }), intent);
    expect(named(intent.calls, "commit")[0]?.[1]).toMatchObject({ kind: "move", body: ITS_MOON });

    grab(model, intent, LONE, around(120), { ctrl: true });
    model.handle(on("move", polarAt(39.5, 180, star), { ctrl: true }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ kind: "move", body: LONE, radius: 100 });
    expect(lastStep(intent)?.marks.host).toBeNull();
  });

  it("keeps a locked moon about its planet over another planet, over the star and past its detach distance", () => {
    const model = new SystemGestureModel();
    const intent = recorder({ ...binaryFrame(true), lockedBodies: new Set([ITS_MOON]) });
    grab(model, intent, ITS_MOON, around(90));
    const aboutItsPlanet = (step: DragStep | null) => {
      expect(step?.intent).toMatchObject({ kind: "move", body: ITS_MOON });
      expect(step?.marks.host).toBeNull();
      expect(step?.readout.text).toMatch(/^locked to P9 · /);
      expect(step?.hint).toBe(`locked to P9 · ${DRAG_HINTS.free}`);
    };
    model.handle(on("move", { x: -240, y: -12 }), intent);
    aboutItsPlanet(lastStep(intent));
    expect(lastStep(intent)?.intent).toMatchObject({ radius: 20 });
    model.handle(on("move", polarAt(38, 180, star)), intent);
    aboutItsPlanet(lastStep(intent));
    model.handle(on("move", { x: 0, y: 3 }), intent);
    aboutItsPlanet(lastStep(intent));
    expect(lastStep(intent)?.intent).toMatchObject({ radius: 224 });
    model.handle(on("up", { x: 0, y: 3 }), intent);
    expect(named(intent.calls, "commit")[0]?.[1]).toMatchObject({ kind: "move", body: ITS_MOON });
  });

  it("keeps a locked planet about the companion star when dropped on the centre's star", () => {
    const model = new SystemGestureModel();
    const intent = recorder({ ...binaryFrame(), lockedBodies: new Set([ITS_PLANET]) });
    grab(model, intent, ITS_PLANET, outward(0));
    model.handle(on("move", { x: 0, y: 3 }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toMatchObject({ kind: "move", body: ITS_PLANET, radius: 240 });
    expect(step?.marks.host).toBeNull();
    expect(step?.readout.text).toMatch(/^locked to P8 · orbit 16 → 240 · \d+°$/);
  });

  it("makes its planet a planet of the centre past twice its outermost orbit", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame());
    grab(model, intent, ITS_PLANET, outward(0));
    model.handle(on("move", { x: -224, y: 30 }), intent);
    expect(lastStep(intent)?.intent).toMatchObject({ kind: "move", body: ITS_PLANET });
    model.handle(on("move", { x: -200, y: 60 }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toMatchObject({ kind: "reparent", body: ITS_PLANET, parent: null });
    expect(step?.hint).toBe(DRAG_HINTS.toPlanet);
    expect(step?.readout.text).toMatch(/^planet · orbit \d+ · \d+°$/);
  });

  it("makes its planet a planet of the centre where it stands when dropped on the centre's star", () => {
    const model = new SystemGestureModel();
    const intent = recorder(binaryFrame());
    grab(model, intent, ITS_PLANET, outward(0));
    model.handle(on("move", { x: 0, y: 3 }), intent);
    const step = lastStep(intent);
    expect(step?.intent).toEqual({
      kind: "reparent",
      system: ORBITS,
      body: ITS_PLANET,
      parent: null,
      radius: 224,
      angle: 180,
    });
    expect(step?.marks.host).toBe(STAR);
    expect(step?.readout.text).toBe("orbits P1 · orbit 224 · 180°");
    expect(step?.hint).toBe(DRAG_HINTS.toPlanet);
  });
});

describe("a handle dragged in the system scene", () => {
  it("moves a belt in whole units, snapping onto a body's ring", () => {
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    const belt = { kind: "belt" as const, index: 0 };
    model.handle(on("down", [0, -120], { handle: belt, draggable: true }), intent);
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
    const model = new SystemGestureModel();
    const intent = recorder(orbitFrame());
    const inner = { kind: "innerRadius" as const };
    model.handle(on("down", [0, -200], { handle: inner, draggable: true }), intent);
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
    model.handle(on("down", [0, 100], { wormhole: WORMHOLE, draggable: true }), intent);
    model.handle(on("move", [69.6, 20.2]), intent);
    const moved = { kind: "moveWormhole", system: ORBITS, wormhole: WORMHOLE, radius: 72 };
    expect(lastStep(intent)?.intent).toEqual({ ...moved, angle: 16 });
    expect(lastStep(intent)?.readout.text).toBe("r 100 → 72 · 16°");
    expect(lastStep(intent)?.hint).toBe(DRAG_HINTS.wormhole);
    model.handle(on("move", [69.6, 20.2], { shift: true }), intent);
    model.handle(on("up", [69.6, 20.2], { shift: true }), intent);
    expect(named(intent.calls, "commit")).toEqual([["commit", { ...moved, angle: 15 }]]);
    expect(named(intent.calls, "openBody")).toEqual([]);
  });

  it("pans from a shroud tunnel, which does not move", () => {
    const model = new SystemGestureModel();
    const intent = recorder(wormholeFrame());
    model.handle(on("down", [-100, 0], { wormhole: TUNNEL, draggable: true }), intent);
    expect(model.handle(on("move", [-60, 30]), intent)).toBe("pan");
    model.handle(on("up", [-60, 30]), intent);
    expect(named(intent.calls, "commit")).toEqual([]);
    expect(named(intent.calls, "preview")).toEqual([]);
  });
});
