import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { SAVE_CAPABILITIES } from "../lib/capabilities";
import { fillSpacing } from "../lib/shapes/placement";
import { PLACEMENT_RULES } from "../lib/placement/rules";
import type { StarChoice } from "../lib/shapes/stars";
import { NO_EXTRAS } from "../lib/shapes/extras";
import { outlineStep } from "../lib/shapes/outline";
import { LEAST_SPACING } from "../lib/placement/limits";
import { centreOf, SHAPE_SPECS, specOf } from "../lib/shapes/specs";
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

function sizeOf(shape: Shape): number {
  return specOf(shape).size(shape);
}

/** Starts a move of the pending shape as the map does, which the map cancels when the tool changes. */
function moveUntilToolChanges(): () => void {
  const from = pending();
  tools().moveShape(from.shape, { x: 40, y: 0 });
  return useToolStore.subscribe((state, previous) => {
    if (state.tool !== previous.tool) tools().restoreShape(from);
  });
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
      purpose: { kind: "add" },
      shape: SHAPE_SPECS.circle.initial,
      fill: { kind: "outline", count: 24 },
      lanes: { follow: true, mode: "off" },
      extras: NO_EXTRAS,
      skipNear: true,
      stars: { kind: "random" },
      seed: expect.any(Number),
    });
  });

  it("is offered over a 4.x save and refused over a 3.x one", async () => {
    await openFixtureSave();
    expect(tools().setTool("shape")).toBe(true);
    tools().setTool("select");

    useFileSessionStore.setState({
      capabilities: { ...SAVE_CAPABILITIES, added_systems: false, bulk_add_systems: false },
    });
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

  it("keeps the shape dropped when another tool cancels a drag that would put it back", () => {
    tools().setTool("shape");
    const off = moveUntilToolChanges();
    tools().setTool("paint");
    off();
    expect(tools().pendingShape).toBeNull();
  });

  it("keeps the shape dropped when closing the document cancels a drag", async () => {
    tools().setTool("shape");
    const off = moveUntilToolChanges();
    await useFileSessionStore.getState().close();
    off();
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

  it("grow a shape larger than the galaxy, up to its fields' end", () => {
    tools().setTool("shape");
    tools().setShapeField("circle", "radius", 900);
    resizeBrush(1);
    const grown = sizeOf(pending().shape);
    expect(grown).toBeGreaterThan(999);
    expect(grown).toBeLessThanOrEqual(1000);
    resizeBrush(1);
    expect(sizeOf(pending().shape)).toBe(grown);
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
    tools().setFill({ kind: "scattered", spacing: 9000, edge: true });
    expect(pending().fill).toEqual({ kind: "scattered", spacing: 150, edge: true });
    expect(pending().lanes).toEqual({ follow: false, mode: "new" });
    tools().setShapeLanes({ mode: "nearby" });
    tools().setFill({ kind: "scattered", spacing: 40, edge: true });
    expect(pending().lanes).toEqual({ follow: false, mode: "nearby" });
    tools().setFill({ kind: "outline", count: 1 });
    expect(pending().fill).toEqual({ kind: "outline", count: 2 });
    expect(pending().lanes).toEqual({ follow: true, mode: "off" });
  });

  it("keeps an arc's fill, and refuses a line any fill but the outline", () => {
    tools().setFill({ kind: "grid", spacing: 30, lattice: "hex" });
    tools().setShapeField("circle", "sweep", 180);
    expect(pending().fill).toEqual({ kind: "grid", spacing: 30, lattice: "hex" });
    tools().setShapeKind("line");
    tools().setFill({ kind: "scattered", spacing: 30, edge: true });
    expect(pending().fill.kind).toBe("outline");
  });

  it("keeps the count, spacing or edge when the fill choice changes, and starts the rest as usual", () => {
    tools().setFillChoice("scattered");
    expect(pending().fill).toEqual({ kind: "scattered", spacing: 25, edge: true });
    tools().setFill({ kind: "scattered", spacing: 40, edge: false });
    tools().setFillChoice("scattered");
    expect(pending().fill).toEqual({ kind: "scattered", spacing: 40, edge: false });
    tools().setFillChoice("square");
    expect(pending().fill).toEqual({ kind: "grid", spacing: 40, lattice: "square" });
    tools().setFillChoice("hex");
    expect(pending().fill).toEqual({ kind: "grid", spacing: 40, lattice: "hex" });
    tools().setFillChoice("outline");
    expect(pending().fill).toEqual({ kind: "outline", count: 24 });
    expect(pending().lanes).toEqual({ follow: true, mode: "off" });
  });

  it("keeps the spacing chosen when the shape grows past it, so it returns as the shape shrinks", () => {
    tools().setFill({ kind: "scattered", spacing: 5, edge: true });
    const used = () => {
      const { shape, fill } = pending();
      return fill.kind === "outline"
        ? null
        : fillSpacing(shape, fill, tools().symmetry, PLACEMENT_RULES.statements);
    };
    tools().setShapeSize(30);
    expect(used()).toBe(5);
    tools().setShapeSize(500);
    expect(used()).toBeGreaterThan(5);
    expect(pending().fill).toMatchObject({ spacing: 5 });
    tools().setShapeSize(30);
    expect(used()).toBe(5);
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

  it("keeps a drag's settings in memory and saves them as the drag ends", () => {
    tools().setTool("shape");
    tools().drawShape({ x: 0, y: 0 }, { x: 120, y: 0 }, NO_MODS);
    expect(tools().shapeMemory.kinds.circle.shape).toMatchObject({ radius: 120 });
    expect(stored.has(PREF_KEYS.shapeMemory)).toBe(false);
    tools().settleShape();
    expect(JSON.parse(stored.get(PREF_KEYS.shapeMemory)!)).toEqual(tools().shapeMemory);
  });

  it("holds a stored field past its range, and keeps the kind's other settings", async () => {
    // Stored before shapes had a hollow centre.
    const older: Partial<CircleShape> = { ...SHAPE_SPECS.circle.initial };
    delete older.hollow;
    stored.set(
      PREF_KEYS.shapeMemory,
      JSON.stringify({
        kind: "rect",
        kinds: {
          circle: {
            shape: { ...older, rotation: 359.7, sweep: 180 },
            fill: { kind: "outline", count: 30 },
            lanes: { follow: false, mode: "nearby" },
            extras: { band: 9, gaps: 2.4, wobble: "lots", centre: "middle" },
          },
          rect: {
            shape: { ...SHAPE_SPECS.rect.initial, width: 1020 },
            fill: { kind: "grid", spacing: 400, lattice: "square" },
            lanes: { follow: false, mode: "new" },
          },
        },
        skipNear: false,
      }),
    );
    vi.resetModules();
    const { kind, kinds, skipNear } = (await import("./toolStore")).useToolStore.getState()
      .shapeMemory;
    expect(kind).toBe("rect");
    expect(skipNear).toBe(false);
    expect(kinds.circle).toEqual({
      shape: { ...SHAPE_SPECS.circle.initial, rotation: 0, sweep: 180 },
      fill: { kind: "outline", count: 30 },
      lanes: { follow: false, mode: "nearby" },
      extras: { ...NO_EXTRAS, band: 5, gaps: 2 },
    });
    expect(kinds.rect).toEqual({
      shape: { ...SHAPE_SPECS.rect.initial, width: 1000 },
      fill: { kind: "grid", spacing: 150, lattice: "square" },
      lanes: { follow: false, mode: "new" },
      extras: NO_EXTRAS,
    });
    expect(kinds.spiral.shape).toEqual(SHAPE_SPECS.spiral.initial);
    expect(kinds.star.shape).toEqual(SHAPE_SPECS.star.initial);
  });

  it("lines a stored scattered fill's edge when it was stored without saying", async () => {
    stored.set(
      PREF_KEYS.shapeMemory,
      JSON.stringify({
        kind: "circle",
        kinds: {
          circle: {
            shape: SHAPE_SPECS.circle.initial,
            fill: { kind: "scattered", spacing: 30 },
            lanes: { follow: false, mode: "new" },
          },
        },
      }),
    );
    vi.resetModules();
    const fresh = (await import("./toolStore")).useToolStore.getState();
    expect(fresh.shapeMemory.kinds.circle.fill).toEqual({
      kind: "scattered",
      spacing: 30,
      edge: true,
    });
  });

  it("remembers the stars for the pending shape and the next, and refuses a choice that is none", async () => {
    tools().setTool("shape");
    const mix: StarChoice = { kind: "mix", classes: ["sc_m", "sc_k", "sc_m"] };
    tools().setShapeStars(mix);
    expect(pending().stars).toEqual({ kind: "mix", classes: ["sc_m", "sc_k"] });
    expect(tools().shapeMemory.stars).toEqual(pending().stars);

    for (const none of [
      { kind: "mix", classes: [] },
      { kind: "one", class: "" },
      { kind: "some" },
    ] as unknown as StarChoice[]) {
      tools().setShapeStars(none);
    }
    expect(pending().stars).toEqual({ kind: "mix", classes: ["sc_m", "sc_k"] });

    tools().setShapeStars({ kind: "one", class: "sc_pulsar" });
    tools().setTool("select");
    tools().setTool("shape");
    expect(pending().stars).toEqual({ kind: "one", class: "sc_pulsar" });

    vi.resetModules();
    const fresh = (await import("./toolStore")).useToolStore.getState();
    expect(fresh.shapeMemory.stars).toEqual({ kind: "one", class: "sc_pulsar" });
  });

  it("starts with Random stars when the stored ones are malformed", async () => {
    stored.set(
      PREF_KEYS.shapeMemory,
      JSON.stringify({ kind: "circle", kinds: {}, stars: { kind: "mix", classes: [3] } }),
    );
    vi.resetModules();
    const fresh = (await import("./toolStore")).useToolStore.getState();
    expect(fresh.shapeMemory.stars).toEqual({ kind: "random" });
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
    tools().setShapeKind("star");
    tools().setShapeField("star", "points", 7);
    tools().setShapeField("circle", "sweep", 90);
    tools().setFill({ kind: "scattered", spacing: 40, edge: true });
    tools().setTool("select");
    tools().setTool("shape");
    expect(pending().shape).toMatchObject({ kind: "star", points: 7 });
    expect(pending().fill).toEqual({ kind: "scattered", spacing: 40, edge: true });
    expect(pending().lanes).toEqual({ follow: false, mode: "new" });
    expect(tools().shapeMemory.kinds.circle.shape.sweep).toBe(360);
  });
});

describe("setting the extras", () => {
  it("holds each to its range, and sets the pending shape's or else the remembered kind's", () => {
    tools().setShapeExtras({ band: 9, gaps: 2.4 });
    expect(tools().shapeMemory.kinds.circle.extras).toEqual({ ...NO_EXTRAS, band: 5, gaps: 2 });
    expect(tools().pendingShape).toBeNull();

    tools().setTool("shape");
    expect(pending().extras).toEqual({ ...NO_EXTRAS, band: 5, gaps: 2 });
    tools().setShapeExtras({ wobble: -10, centre: "spokes" });
    expect(pending().extras).toEqual({ ...NO_EXTRAS, band: 5, gaps: 2, centre: "spokes" });
    expect(tools().shapeMemory.kinds.circle.extras).toEqual(pending().extras);
  });

  it("grows an arranged shape when Wobble rises, as Arrange's start would size it", () => {
    expect(tools().startArrange([0, 1, 2, 3], { x: 0, y: 0 })).toBe(true);
    const before = sizeOf(pending().shape);
    const centre = centreOf(pending().shape);
    tools().setShapeExtras({ wobble: 80 });
    const { shape } = pending();
    expect(pending().extras.wobble).toBe(80);
    expect(sizeOf(shape)).toBeGreaterThan(before);
    expect(centreOf(shape)).toEqual(centre);
    // Neighbours each nudged up to 40% of the step stay a fifth of it apart, past the gap.
    const step = outlineStep(specOf(shape).outline(shape, 4));
    expect(0.2 * step).toBeGreaterThanOrEqual(LEAST_SPACING);
  });
});
