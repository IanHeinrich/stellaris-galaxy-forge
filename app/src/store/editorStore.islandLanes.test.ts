import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { Op } from "../generated/Op";
import type { Pair } from "../lib/geometry/pairs";
import { mockedIpc } from "../test/ipc";
import { editor, openFixtureScenario } from "./editorFixture";
import { editResult } from "./fixture";
import { useMapChromeStore } from "./mapChromeStore";
import { shapePreview } from "./shapePreview";
import { useToolStore } from "./toolStore";

const tools = () => useToolStore.getState();
const chrome = () => useMapChromeStore.getState();

/** The lanes the last edit sent, as pairs in the order it named them. */
function sentLanes(): Pair[] {
  const calls = mockedIpc.applyOp.mock.calls;
  const op = calls[calls.length - 1][0];
  const ops: Op[] = op.type === "Batch" ? op.ops : [op];
  return ops.flatMap((o) =>
    o.type === "AddLanePairs" ? o.lanes.map(({ a, b }): Pair => [a, b]) : [],
  );
}

beforeEach(async () => {
  await openFixtureScenario();
  mockedIpc.applyOp.mockResolvedValue(editResult());
  chrome().setLaneIslands(false);
});

describe("Generate lanes like the game", () => {
  it("reaches a shape's lanes, is remembered per kind, and places the lanes it previews", async () => {
    tools().setTool("shape");
    tools().setFillChoice("scattered");
    const even = shapePreview()!;
    expect(tools().pendingShape!.lanes.islands).toBe(false);

    tools().setShapeLanes({ islands: true });
    const islands = shapePreview()!;
    expect(islands.points).toEqual(even.points);
    expect(islands.pairs).not.toEqual(even.pairs);

    tools().setShapeKind("rect");
    expect(tools().pendingShape!.lanes.islands).toBe(false);
    tools().setShapeKind("circle");
    expect(tools().pendingShape!.lanes.islands).toBe(true);
    expect(tools().shapeMemory.kinds.circle.lanes.islands).toBe(true);
    expect(tools().shapeMemory.kinds.rect.lanes.islands).toBe(false);

    const shown = shapePreview()!;
    expect(await editor().placePendingShape()).toBe(true);
    expect(sentLanes()).toHaveLength(shown.pairs.length);
  });
});
