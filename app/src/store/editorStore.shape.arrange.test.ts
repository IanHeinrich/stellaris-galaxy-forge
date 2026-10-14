import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { EditResult } from "../generated/EditResult";
import type { Op } from "../generated/Op";
import { PairSet } from "../lib/geometry/pairs";
import { provisionalIndex } from "../lib/placement/lanes";
import { ARRANGE_SYMMETRY, shapeStatus } from "../lib/shapes/shapeCopy";
import { specOf } from "../lib/shapes/specs";
import { flush } from "../test/flush";
import { mockedIpc } from "../test/ipc";
import { run } from "./commands";
import { deferred, editor, openFixtureSave, openFixtureScenario } from "./editorFixture";
import { editResult, SYSTEMS } from "./fixture";
import { useGalaxyStore } from "./galaxyStore";
import { shapePreview } from "./shapePreview";
import { useToolStore } from "./toolStore";

const tools = () => useToolStore.getState();
const effects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };
const esc = () => run("clearSelection", false, effects);

/** Sol, Alpha Centauri, Barnard and Sirius: joined Sol–Alpha, Alpha–Barnard and Alpha–Sirius. */
const PICKED = [0, 1, 2, 3];
const INNER: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [1, 3],
];

/** The Batch the one edit sent. */
function sentBatch(): Extract<Op, { type: "Batch" }> {
  expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
  const [[op]] = mockedIpc.applyOp.mock.calls;
  if (op.type !== "Batch") throw new Error(`sent ${op.type}`);
  return op;
}

/** The op of `type` in `batch`. */
function opOf<T extends Op["type"]>(batch: Extract<Op, { type: "Batch" }>, type: T) {
  return batch.ops.find((o): o is Extract<Op, { type: T }> => o.type === type);
}

/** Starts arranging `PICKED` from the Select tool, centred on `at`. */
function arrange(at = { x: 200, y: 200 }): void {
  expect(tools().tool).toBe("select");
  expect(tools().startArrange(PICKED, at)).toBe(true);
}

beforeEach(async () => {
  await openFixtureScenario();
  mockedIpc.applyOp.mockImplementation(async () => editResult());
});

describe("arranging a selection", () => {
  it("opens the Shape tool with a circle centred where asked, sized to fit, previewing one point per system", () => {
    arrange();
    const pending = tools().pendingShape!;
    expect(tools().tool).toBe("shape");
    expect(pending.purpose).toEqual({
      kind: "arrange",
      ids: PICKED,
      lanes: "keep",
      alsoOuter: false,
    });
    expect(pending.shape).toMatchObject({ kind: "circle", centre: { x: 200, y: 200 } });
    const preview = shapePreview()!;
    expect(preview.points).toHaveLength(PICKED.length);
    expect(preview.arranged).toMatchObject({ count: 4, cut: [], added: [], refusal: null });
  });

  it("moves each system to its point as one Batch, keeping the lanes, and puts the tool back", async () => {
    arrange();
    const preview = shapePreview()!;
    expect(await editor().placePendingShape()).toBe(true);

    const batch = sentBatch();
    expect(batch.description).toBe("Arranged 4 systems in a ring");
    expect(batch.ops.map((o) => o.type)).toEqual(["MoveSystems"]);
    const moves = opOf(batch, "MoveSystems")!.moves;
    expect(moves.map((m) => m.system).sort()).toEqual(PICKED);
    expect(moves.map(({ x, y }) => ({ x, y }))).toEqual(preview.points);
    expect(tools().tool).toBe("select");
    expect(tools().pendingShape).toBeNull();
  });

  it("sends each system to the nearest free point, so a ring far off keeps their order round it", async () => {
    arrange({ x: 200, y: 200 });
    tools().setShapeField("circle", "radius", 100);
    await editor().placePendingShape();
    const moves = opOf(sentBatch(), "MoveSystems")!.moves;
    const angleOf = (id: number) => {
      const m = moves.find((move) => move.system === id)!;
      return Math.atan2(m.y - 200, m.x - 200);
    };
    // Sirius is east of the middle and Barnard north of it; Sol and Alpha share the west.
    expect(Math.abs(angleOf(3))).toBeLessThan(Math.PI / 4);
    expect(angleOf(2)).toBeGreaterThan(Math.PI / 4);
  });

  it("rebuilds the lanes between them round the ring, keeping a lane it would lay again", async () => {
    arrange();
    tools().setArrangeLanes("rebuild");
    expect(tools().pendingShape!.purpose).toMatchObject({ lanes: "rebuild" });
    expect(await editor().placePendingShape()).toBe(true);

    const batch = sentBatch();
    expect(batch.ops.map((o) => o.type)).toEqual([
      "RemoveLanePairs",
      "MoveSystems",
      "AddLanePairs",
    ]);
    const cut = opOf(batch, "RemoveLanePairs")!.lanes;
    const added = opOf(batch, "AddLanePairs")!.lanes.map(({ a, b }): [number, number] => [a, b]);
    const after = new PairSet();
    for (const [a, b] of INNER) after.add(a, b);
    for (const [a, b] of cut) {
      expect(after.has(a, b)).toBe(true);
      after.delete(a, b);
    }
    for (const [a, b] of added) after.add(a, b);
    expect(after.size).toBe(4);
    for (const id of PICKED) {
      expect([...after.values()].filter(([a, b]) => a === id || b === id)).toHaveLength(2);
    }
  });

  it("clears the lanes between them, leaving the lane out to Vega", async () => {
    arrange();
    tools().setArrangeLanes("clear");
    const status = shapeStatus(tools().pendingShape!, shapePreview()!, "statements");
    expect(status.summary).toBe("Circle · Arrange 4 systems · 3 lanes out");
    await editor().placePendingShape();
    const batch = sentBatch();
    expect(batch.ops.map((o) => o.type)).toEqual(["RemoveLanePairs", "MoveSystems"]);
    expect(opOf(batch, "RemoveLanePairs")!.lanes).toEqual(INNER);
    expect(shapePreview()).toBeNull();
  });

  it("also cuts the lanes out to other systems when asked, and says so", async () => {
    arrange();
    tools().setArrangeLanes("clear");
    tools().setArrangeAlsoOuter(true);
    const status = shapeStatus(tools().pendingShape!, shapePreview()!, "statements");
    expect(status.summary).toBe("Circle · Arrange 4 systems · 4 lanes out (1 to other systems)");
    await editor().placePendingShape();
    const batch = sentBatch();
    expect(batch.description).toBe(
      "Arranged 4 systems in a ring and cut 4 lanes (1 to other systems)",
    );
    expect(opOf(batch, "RemoveLanePairs")!.lanes).toEqual([...INNER, [1, 4]]);
    arrange();
    expect(tools().pendingShape!.purpose).toMatchObject({ lanes: "clear", alsoOuter: true });
  });

  it("says the lanes are kept under Keep, with no count of none", () => {
    arrange();
    const status = shapeStatus(tools().pendingShape!, shapePreview()!, "statements");
    expect(status.summary).toBe("Circle · Arrange 4 systems · lanes kept");
  });

  it("names the kept lanes that would lie along another or pass through a system on a line", () => {
    arrange();
    tools().setShapeKind("line");
    const { points, arranged } = shapePreview()!;
    expect(points.every((p) => Math.abs(p.y - points[0].y) < 1e-6)).toBe(true);
    const systemOf = (id: number) => (id < 0 ? arranged!.moves[provisionalIndex(id)].system : id);
    const named = arranged!.crossing.map(([a, b]) => [systemOf(a), systemOf(b)].sort());
    // Alpha's lanes to Barnard and Sirius lie along each other, and the one to Sirius passes Barnard.
    expect(named).toEqual(
      expect.arrayContaining([
        [1, 2],
        [1, 3],
      ]),
    );
    expect(named).not.toContainEqual([0, 1]);
  });

  it("is refused while a point lands on a system left where it is", async () => {
    arrange({ x: 0, y: 0 });
    const { shape } = tools().pendingShape!;
    const first = specOf(shape).outline(shape, 4).points[0];
    const vega = useGalaxyStore.getState().systems.get(4)!;
    tools().moveShape(shape, { x: vega.x - first.x, y: vega.y - first.y });
    expect(shapePreview()!.arranged!.refusal).toBe(
      "Only 3 of 4 systems fit: 1 too close to other systems. Move or resize the shape.",
    );
    expect(await editor().placePendingShape()).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("is built on the galaxy as it is when its turn comes, after an edit queued ahead", async () => {
    arrange();
    const ahead = deferred<EditResult>();
    mockedIpc.applyOp.mockReturnValueOnce(ahead.promise);
    const deleting = editor().applyOp({ type: "RemoveSystems", systems: [3] });
    const placing = editor().placePendingShape();
    await flush();
    ahead.resolve(editResult({ delta: { systems: [], removed: [3] } }));
    await deleting;
    expect(await placing).toBe(true);
    const [, [op]] = mockedIpc.applyOp.mock.calls;
    if (op.type !== "Batch") throw new Error(`sent ${op.type}`);
    expect(op.description).toBe("Arranged 3 systems in a ring");
    const moved = opOf(op, "MoveSystems")!.moves.map((m) => m.system);
    expect(moved.sort()).toEqual([0, 1, 2]);
  });

  it("keeps a shape drawn while the arrange was landing, and the Shape tool", async () => {
    arrange();
    const landing = deferred<EditResult>();
    mockedIpc.applyOp.mockReturnValueOnce(landing.promise);
    const placing = editor().placePendingShape();
    tools().drawShape({ x: 0, y: 0 }, { x: 50, y: 0 }, { snap: false, constrain: false });
    const drawn = tools().pendingShape;
    expect(drawn!.purpose).toEqual({ kind: "add" });
    await flush();
    landing.resolve(editResult());
    expect(await placing).toBe(true);
    expect(tools().pendingShape).toBe(drawn);
    expect(tools().tool).toBe("shape");
  });

  it("is dropped when another document opens, and the tool put back", async () => {
    arrange();
    await openFixtureScenario();
    expect(tools().pendingShape).toBeNull();
    expect(tools().tool).toBe("select");
  });

  it("is one undo step", async () => {
    arrange();
    await editor().placePendingShape();
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    await editor().undo();
    expect(mockedIpc.undo).toHaveBeenCalledTimes(1);
  });

  it("moves nothing on Esc, and puts the tool back", () => {
    arrange();
    esc();
    expect(tools().pendingShape).toBeNull();
    expect(tools().tool).toBe("select");
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("remembers the last shape arranged into apart from the shape tool's own", () => {
    arrange();
    tools().setShapeKind("polygon");
    esc();
    arrange();
    expect(tools().pendingShape!.shape.kind).toBe("polygon");
    esc();
    tools().setTool("shape");
    expect(tools().pendingShape!.shape.kind).toBe("circle");
    expect(tools().pendingShape!.purpose).toEqual({ kind: "add" });
  });

  it("spreads a fill's points evenly to exactly one per system", () => {
    arrange();
    tools().setFillChoice("hex");
    expect(shapePreview()!.points).toHaveLength(4);
    tools().setFillChoice("scattered");
    expect(shapePreview()!.points).toHaveLength(4);
  });

  it("is refused under symmetry, where the shape's images have no systems to move", async () => {
    arrange();
    tools().setSymmetry({ kind: "rotate", n: 4 });
    expect(shapePreview()!.arranged!.refusal).toBe(ARRANGE_SYMMETRY);
    expect(await editor().placePendingShape()).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});

describe("arranging in a save", () => {
  beforeEach(async () => {
    await openFixtureSave();
    mockedIpc.applyOp.mockImplementation(async () => editResult());
  });

  it("moves the systems with an op, as a scenario does", async () => {
    arrange({ x: 0, y: 0 });
    expect(await editor().placePendingShape()).toBe(true);
    expect(mockedIpc.addRandomSystems).not.toHaveBeenCalled();
    expect(opOf(sentBatch(), "MoveSystems")!.moves).toHaveLength(4);
  });

  it("is refused while a point sits within the spawn gap of a system left where it is", async () => {
    arrange({ x: 0, y: 0 });
    const { shape } = tools().pendingShape!;
    const first = specOf(shape).outline(shape, 4).points[0];
    const vega = useGalaxyStore.getState().systems.get(4)!;
    tools().moveShape(shape, { x: vega.x - first.x, y: vega.y - first.y });
    expect(shapePreview()!.arranged!.refusal).toBe(
      "Only 3 of 4 systems fit: 1 too close to other systems. Move or resize the shape.",
    );
    expect(await editor().placePendingShape()).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(tools().pendingShape).not.toBeNull();
    expect(SYSTEMS.map((s) => useGalaxyStore.getState().systems.get(s.id)?.x)).toEqual(
      SYSTEMS.map((s) => s.x),
    );
  });
});
