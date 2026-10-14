import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { SHAPE_SPECS, specOf } from "../lib/shapes/specs";
import type { CircleShape, PendingShape, Shape } from "../lib/shapes/types";
import { resizeBrush, run } from "./commands";
import { openFixtureSave, openFixtureScenario } from "./editorFixture";
import { useFileSessionStore } from "./fileSessionStore";
import { PREF_KEYS } from "./prefKeys";
import { useToolStore } from "./toolStore";

const tools = () => useToolStore.getState();
const pending = (): PendingShape => tools().pendingShape!;
const effects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };
const esc = () => run("clearSelection", false, effects);
const NO_MODS = { snap: false, constrain: false };

const stored = new Map<string, string>();

function centreOf(shape: Shape) {
  return shape.kind === "line"
    ? { x: (shape.a.x + shape.b.x) / 2, y: (shape.a.y + shape.b.y) / 2 }
    : shape.centre;
}

function sizeOf(shape: Shape): number {
  return specOf(shape).size(shape);
}

beforeEach(async () => {
  await openFixtureScenario();
  stubPrefs(stored);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("picking the Shape tool", () => {
  it("starts the remembered circle at the galaxy's centre, with an outline that follows itself", () => {
    expect(tools().setTool("shape")).toBe(true);
    expect(pending()).toEqual({
      shape: SHAPE_SPECS.circle.initial,
      fill: { kind: "outline", count: 24 },
      lanes: { follow: true, mode: "off" },
      skipNear: true,
      seed: expect.any(Number),
    });
  });

  it("is refused over a save", async () => {
    await openFixtureSave();
    expect(tools().setTool("shape")).toBe(false);
    expect(tools().pendingShape).toBeNull();
  });

  it("drops the pending shape when another tool is picked", () => {
    tools().setTool("shape");
    tools().setTool("paint");
    expect(tools().pendingShape).toBeNull();
  });

  it("drops the pending shape when the document closes", async () => {
    tools().setTool("shape");
    await useFileSessionStore.getState().close();
    expect(tools().pendingShape).toBeNull();
    expect(tools().tool).toBe("select");
  });
});

describe("Esc", () => {
  it("drops the pending shape first, then returns to Select", () => {
    tools().setTool("shape");
    esc();
    expect(tools().pendingShape).toBeNull();
    expect(tools().tool).toBe("shape");
    esc();
    expect(tools().tool).toBe("select");
  });
});

describe("[ and ]", () => {
  it("resize the pending shape by 1.2 and leave the brush alone", () => {
    tools().setTool("shape");
    const brush = tools().size;
    const before = sizeOf(pending().shape);
    expect(resizeBrush(1)).toBe(true);
    expect(sizeOf(pending().shape)).toBeCloseTo(before * 1.2);
    resizeBrush(-1);
    resizeBrush(-1);
    expect(sizeOf(pending().shape)).toBeCloseTo(before / 1.2);
    expect(tools().size).toBe(brush);
  });
});

describe("the pending shape", () => {
  beforeEach(() => {
    tools().setTool("shape");
  });

  it("keeps its centre and size when its kind changes", () => {
    tools().moveShape(pending().shape, { x: 50, y: -20 });
    tools().setShapeSize(150);
    tools().setShapeKind("polygon");
    expect(pending().shape.kind).toBe("polygon");
    expect(centreOf(pending().shape)).toEqual({ x: 50, y: -20 });
    expect(sizeOf(pending().shape)).toBeCloseTo(150);
    tools().setShapeKind("line");
    expect(centreOf(pending().shape).x).toBeCloseTo(50);
    expect(centreOf(pending().shape).y).toBeCloseTo(-20);
    expect(sizeOf(pending().shape)).toBeCloseTo(150);
  });

  it("keeps its seed through one drag and rolls a new one from another press", () => {
    tools().drawShape({ x: 0, y: 0 }, { x: 100, y: 0 }, NO_MODS);
    const seed = pending().seed;
    tools().drawShape({ x: 0, y: 0 }, { x: 150, y: 0 }, NO_MODS);
    expect(pending().seed).toBe(seed);
    expect(sizeOf(pending().shape)).toBeCloseTo(150);
    tools().drawShape({ x: 10, y: 0 }, { x: 150, y: 0 }, NO_MODS);
    expect(pending().seed).not.toBe(seed);
  });

  it("moves from the shape the drag started with, and a cancelled drag puts it back", () => {
    const before = pending();
    tools().moveShape(before.shape, { x: 10, y: 0 });
    tools().moveShape(before.shape, { x: 30, y: 5 });
    expect(centreOf(pending().shape)).toEqual({ x: 30, y: 5 });
    tools().restoreShape(before);
    expect(pending()).toEqual(before);
  });

  it("stays inside the scenario's square when moved past its edge", () => {
    tools().moveShape(pending().shape, { x: 900, y: -40 });
    expect(centreOf(pending().shape)).toEqual({ x: 500, y: -40 });
  });

  it("holds a field to its range and to whole steps", () => {
    tools().setShapeKind("polygon");
    tools().setShapeField("polygon", "sides", 40);
    expect(pending().shape).toMatchObject({ sides: 12 });
    tools().setShapeField("polygon", "sides", 4.4);
    expect(pending().shape).toMatchObject({ sides: 4 });
    tools().setShapeField("circle", "sweep", 90);
    expect(pending().shape.kind).toBe("polygon");
  });

  it("takes a fill's lane defaults when the fill changes, and holds its numbers to their ranges", () => {
    tools().setFill({ kind: "scattered", spacing: 9000 });
    expect(pending().fill).toEqual({ kind: "scattered", spacing: 150 });
    expect(pending().lanes).toEqual({ follow: false, mode: "new" });
    tools().setShapeLanes({ mode: "nearby" });
    tools().setFill({ kind: "scattered", spacing: 40 });
    expect(pending().lanes).toEqual({ follow: false, mode: "nearby" });
    tools().setFill({ kind: "outline", count: 1 });
    expect(pending().fill).toEqual({ kind: "outline", count: 2 });
    expect(pending().lanes).toEqual({ follow: true, mode: "off" });
  });

  it("refuses a fill an arc cannot take, and an arc falls back to an outline", () => {
    tools().setFill({ kind: "grid", spacing: 30, lattice: "hex" });
    tools().setShapeField("circle", "sweep", 180);
    expect(pending().fill).toEqual({ kind: "outline", count: 24 });
    tools().setFill({ kind: "scattered", spacing: 30 });
    expect(pending().fill.kind).toBe("outline");
  });

  it("ignores lane settings that are not lane settings", () => {
    tools().setShapeLanes({ follow: "yes" as unknown as boolean, mode: "new" });
    expect(pending().lanes).toEqual({ follow: true, mode: "new" });
  });

  it("rolls a new seed on Shuffle and keeps the shape", () => {
    const before = pending();
    tools().shuffleShape();
    expect(pending().seed).not.toBe(before.seed);
    expect(pending().shape).toEqual(before.shape);
  });
});

describe("the memory", () => {
  it("starts the next shape from the last kind and its settings, on the next run too", async () => {
    tools().setTool("shape");
    tools().setShapeKind("star");
    tools().setFill({ kind: "grid", spacing: 30, lattice: "square" });
    tools().setSkipNear(false);
    const remembered = tools().shapeMemory;
    expect(JSON.parse(stored.get(PREF_KEYS.shapeMemory)!)).toEqual(remembered);

    vi.resetModules();
    const fresh = (await import("./toolStore")).useToolStore.getState();
    expect(fresh.shapeMemory).toEqual(remembered);
    expect(fresh.shapeMemory.kind).toBe("star");
    expect(fresh.shapeMemory.kinds.star.fill).toEqual({
      kind: "grid",
      spacing: 30,
      lattice: "square",
    });
  });

  it("falls back to the first settings when what is stored is malformed", async () => {
    const circle: CircleShape = {
      ...SHAPE_SPECS.circle.initial,
      radius: "big" as unknown as number,
    };
    stored.set(PREF_KEYS.shapeMemory, JSON.stringify({ kind: "circle", kinds: { circle } }));
    vi.resetModules();
    const fresh = (await import("./toolStore")).useToolStore.getState();
    expect(fresh.shapeMemory.kind).toBe("circle");
    expect(fresh.shapeMemory.kinds.circle.shape).toEqual(SHAPE_SPECS.circle.initial);
    expect(fresh.shapeMemory.skipNear).toBe(true);
  });

  it("changes the remembered kind's settings while nothing is pending", () => {
    tools().setTool("shape");
    tools().dropShape();
    tools().setFill({ kind: "scattered", spacing: 40 });
    tools().setTool("select");
    tools().setTool("shape");
    expect(pending().fill).toEqual({ kind: "scattered", spacing: 40 });
    expect(pending().lanes).toEqual({ follow: false, mode: "new" });
  });
});
