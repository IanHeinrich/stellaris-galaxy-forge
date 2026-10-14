import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { EditResult } from "../generated/EditResult";
import type { Op } from "../generated/Op";
import { mockedIpc } from "../test/ipc";
import { flush } from "../test/flush";
import { run } from "./commands";
import { editor, openFixtureSave, openFixtureScenario, sessionError } from "./editorFixture";
import { editResult, node, SYSTEMS } from "./fixture";
import { loadGameData } from "./gameDataFixture";
import { useGalaxyStore } from "./galaxyStore";
import { useGeneratorStore } from "./generatorStore";
import { useSceneStore } from "./sceneStore";
import { SHAPE_NEEDS_GAME_DATA, shapePreview } from "./shapePreview";
import { useToolStore } from "./toolStore";

const tools = () => useToolStore.getState();
const effects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };
const ids = () => [...useGalaxyStore.getState().systems.keys()].sort((a, b) => a - b);

/** The ids of the systems a placing Batch adds. */
function addedIds(op: Op): number[] {
  if (op.type !== "Batch") return [];
  return op.ops.flatMap((o) => (o.type === "AddSystems" ? o.systems.map((s) => s.system) : []));
}

/** The core's answer to `op`: the systems it adds, as a delta. */
function landed(op: Op): EditResult {
  const added = op.type === "Batch" ? op.ops.find((o) => o.type === "AddSystems") : undefined;
  const systems =
    added?.type === "AddSystems"
      ? added.systems.map((s) => node(s.system, "", s.x, s.y, "sc_g", []))
      : [];
  return editResult({ delta: { systems } });
}

beforeEach(async () => {
  await openFixtureScenario();
  mockedIpc.applyOp.mockImplementation(async (op) => landed(op));
  tools().setTool("shape");
});

describe("placing a shape", () => {
  it("sends one Batch of its systems and its ring of lanes, numbered from the next free id", async () => {
    const shown = shapePreview()!;
    expect(await editor().placePendingShape()).toBe(true);

    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    const [[op]] = mockedIpc.applyOp.mock.calls;
    expect(op).toMatchObject({
      type: "Batch",
      description: "Placed a ring of 24 systems and 24 lanes",
      ops: [{ type: "AddSystems" }, { type: "AddLanePairs" }],
    });
    expect(addedIds(op)).toEqual(Array.from({ length: 24 }, (_, i) => 6 + i));
    if (op.type === "Batch" && op.ops[0].type === "AddSystems") {
      expect(op.ops[0].systems.map(({ x, y }) => ({ x, y }))).toEqual(shown.points);
    }
    expect(tools().pendingShape).toBeNull();
    expect(tools().tool).toBe("shape");
    expect(ids()).toHaveLength(SYSTEMS.length + 24);
  });

  it("holds the preview it placed until the edit lands", async () => {
    let land: (result: EditResult) => void = () => undefined;
    mockedIpc.applyOp.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const shown = shapePreview();
    const placing = editor().placePendingShape();
    expect(tools().pendingShape).toBeNull();
    expect(tools().placingShape).toBe(shown);
    await flush();
    land(editResult());
    await placing;
    expect(tools().placingShape).toBeNull();
  });

  it("behind a queued paint stroke, takes ids after the stroke's", async () => {
    let land: (result: EditResult) => void = () => undefined;
    mockedIpc.applyOp.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const painting = editor().paintStroke([{ x: 300, y: 300 }], []);
    const placing = editor().placePendingShape();
    await flush();

    land(editResult({ delta: { systems: [node(6, "", 300, 300, "sc_g", [])] } }));
    expect(await placing).toBe(true);
    await painting;

    const [, [shape]] = mockedIpc.applyOp.mock.calls;
    expect(addedIds(shape)[0]).toBe(7);
    expect(sessionError()).toBeNull();
  });

  it("is taken back by one undo", async () => {
    await editor().placePendingShape();
    const added = ids().filter((id) => id >= SYSTEMS.length);
    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [], removed: added }, history: { undo: [], redo: [] } }),
    );
    await editor().undo();
    expect(ids()).toEqual(SYSTEMS.map((s) => s.id));
  });

  it("gives the shape back when the edit is refused", async () => {
    mockedIpc.applyOp.mockRejectedValueOnce(new Error("refused"));
    const before = tools().pendingShape;
    expect(await editor().placePendingShape()).toBe(false);
    expect(tools().pendingShape).toBe(before);
    expect(tools().placingShape).toBeNull();
  });

  it("keeps a shape drawn while a refused edit waited", async () => {
    let refuse: (e: Error) => void = () => undefined;
    mockedIpc.applyOp.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
    const placing = editor().placePendingShape();
    tools().drawShape({ x: 0, y: 0 }, { x: 50, y: 0 }, { snap: false, constrain: false });
    const drawn = tools().pendingShape;
    await flush();
    refuse(new Error("refused"));
    expect(await placing).toBe(false);
    expect(tools().pendingShape).toBe(drawn);
  });

  it("sends nothing with no shape pending", async () => {
    tools().dropShape();
    expect(await editor().placePendingShape()).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});

describe("placing a shape in a save", () => {
  beforeEach(async () => {
    await openFixtureSave();
    await loadGameData();
    useGeneratorStore.setState({
      starClasses: [
        { key: "sc_g", label: "G", odds: 10, randomOdds: 10 },
        { key: "sc_m", label: "M", odds: 20, randomOdds: 20 },
      ],
    });
    mockedIpc.addRandomSystems.mockImplementation(async ({ systems }) =>
      editResult({
        delta: {
          systems: systems.map((s, i) => node(6 + i, "", s.x, s.y, s.star_class, [])),
        },
      }),
    );
    tools().setTool("shape");
    tools().drawShape({ x: 0, y: 0 }, { x: 50, y: 0 }, { snap: false, constrain: false });
  });

  it("rolls the preview's systems with their stars and lanes as one edit, and sends no op", async () => {
    const pending = tools().pendingShape!;
    const shown = shapePreview()!;
    expect(shown.classes).toHaveLength(shown.points.length);
    expect(await editor().placePendingShape()).toBe(true);

    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(mockedIpc.addRandomSystems).toHaveBeenCalledTimes(1);
    const [[args]] = mockedIpc.addRandomSystems.mock.calls;
    const end = (id: number) =>
      id < 0 ? { kind: "new", index: -id - 1 } : { kind: "held", system: id };
    expect(args).toEqual({
      seed: pending.seed,
      systems: shown.points.map((p, i) => ({ x: p.x, y: p.y, star_class: shown.classes![i] })),
      lanes: shown.pairs.map(([a, b]) => [end(a), end(b)]),
      description: `Placed a ring of ${shown.points.length} systems and ${shown.pairs.length} lanes`,
    });
    expect(args.lanes.some(([a]) => a.kind === "new")).toBe(true);
    expect(ids()).toHaveLength(SYSTEMS.length + shown.points.length);
  });

  it("rolls a swirl as one edit, and one undo takes it back", async () => {
    tools().setShapeKind("spiral");
    tools().setShapeSize(150);
    const shown = shapePreview()!;
    const n = shown.points.length;
    expect(n).toBeGreaterThan(10);
    expect(await editor().placePendingShape()).toBe(true);

    const [[args]] = mockedIpc.addRandomSystems.mock.calls;
    expect(args.description).toBe(`Placed a swirl of ${n} systems and ${shown.pairs.length} lanes`);
    expect(args.systems.map((s) => s.star_class)).toEqual(shown.classes);
    const added = ids().filter((id) => id >= SYSTEMS.length);
    expect(added).toHaveLength(n);

    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [], removed: added }, history: { undo: [], redo: [] } }),
    );
    await editor().undo();
    expect(ids()).toEqual(SYSTEMS.map((s) => s.id));
  });

  it("previews and places the points out to half again the galaxy's radius, and leaves out those beyond", async () => {
    // The fixture's radius is 60, so a system may stand up to 90 out; this ring reaches 100.
    tools().drawShape({ x: 60, y: 0 }, { x: 100, y: 0 }, { snap: false, constrain: false });
    const shown = shapePreview()!;
    const out = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
    expect(shown.points.some((p) => out(p) > 60)).toBe(true);
    expect(shown.points.every((p) => out(p) <= 90)).toBe(true);
    expect(shown.outside.length).toBeGreaterThan(0);
    expect(shown.outside.every((p) => out(p) > 90)).toBe(true);

    expect(await editor().placePendingShape()).toBe(true);
    const [[args]] = mockedIpc.addRandomSystems.mock.calls;
    expect(args.systems.map(({ x, y }) => ({ x, y }))).toEqual(shown.points);
  });

  it("gives the shape back when the save refuses it", async () => {
    mockedIpc.addRandomSystems.mockRejectedValueOnce(new Error("Too close"));
    const before = tools().pendingShape;
    expect(await editor().placePendingShape()).toBe(false);
    expect(tools().pendingShape).toBe(before);
    expect(sessionError()).toBe("Too close");
  });

  it("is refused without the star classes game data gives, and keeps the shape", async () => {
    useGeneratorStore.setState({ starClasses: null });
    const before = tools().pendingShape;
    expect(await editor().placePendingShape()).toBe(false);
    expect(mockedIpc.addRandomSystems).not.toHaveBeenCalled();
    expect(sessionError()).toBe(SHAPE_NEEDS_GAME_DATA);
    expect(tools().pendingShape).toBe(before);
  });
});

describe("Enter", () => {
  /** A focused element inside whatever `selector` names, and nothing else. */
  class Element {
    constructor(private readonly inside: string | null = null) {}
    closest(selector: string) {
      return selector === this.inside ? this : null;
    }
  }
  class Canvas extends Element {}
  const BODY = {};
  const focus = (active: object) =>
    vi.stubGlobal("document", { activeElement: active, body: BODY });

  beforeEach(() => {
    vi.stubGlobal("HTMLElement", Element);
    vi.stubGlobal("HTMLCanvasElement", Canvas);
    focus(BODY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves a focused menu or another control its own", () => {
    focus(new Element('[role="menu"]'));
    expect(run("enterSystem", false, effects)).toBe(false);
    focus(new Element(".top-bar"));
    expect(run("enterSystem", false, effects)).toBe(false);
    expect(tools().pendingShape).not.toBeNull();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("places from the shape's options, so Enter after Shuffle still places", async () => {
    focus(new Element(".shape-options"));
    expect(run("enterSystem", false, effects)).toBe(true);
    await flush();
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
  });

  it("places from the map's canvas", async () => {
    focus(new Canvas(".map-host"));
    expect(run("enterSystem", false, effects)).toBe(true);
    await flush();
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
  });

  it("places the pending shape, and with none pending shows the selected system", async () => {
    expect(run("enterSystem", false, effects)).toBe(true);
    await flush();
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    expect(useSceneStore.getState().scene).toEqual({ kind: "galaxy" });

    await editor().select(1);
    expect(run("enterSystem", false, effects)).toBe(true);
    expect(useSceneStore.getState().scene).toMatchObject({ kind: "system", id: 1 });
  });
});
