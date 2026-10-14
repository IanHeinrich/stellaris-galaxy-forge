import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { EditResult } from "../generated/EditResult";
import type { Op } from "../generated/Op";
import { mockedIpc } from "../test/ipc";
import { flush } from "../test/flush";
import { run } from "./commands";
import { editor, openFixtureScenario, sessionError } from "./editorFixture";
import { editResult, node, SYSTEMS } from "./fixture";
import { useGalaxyStore } from "./galaxyStore";
import { useSceneStore } from "./sceneStore";
import { shapePreview } from "./shapePreview";
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

  it("sends nothing with no shape pending", async () => {
    tools().dropShape();
    expect(await editor().placePendingShape()).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});

describe("Enter", () => {
  class Element {
    closest(selector: string) {
      return selector === '[role="menu"]' ? this : null;
    }
  }
  const BODY = {};

  beforeEach(() => {
    vi.stubGlobal("HTMLElement", Element);
    vi.stubGlobal("HTMLCanvasElement", class {});
    vi.stubGlobal("document", { activeElement: BODY, body: BODY });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves a focused menu its own", () => {
    vi.stubGlobal("document", { activeElement: new Element(), body: BODY });
    expect(run("enterSystem", false, effects)).toBe(false);
    expect(tools().pendingShape).not.toBeNull();
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
