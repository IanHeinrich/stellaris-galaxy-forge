import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");

import type { Op } from "../../generated/Op";
import { BrushStroke, type StrokeResult } from "../../lib/brush/brushStroke";
import type { BrushTool } from "../../lib/brush/brushTools";
import { stampsAlong } from "../../lib/brush/stroke";
import type { Pair } from "../../lib/geometry/pairs";
import type { Pt } from "../../lib/geometry/pt";
import { settingsFor } from "./brushStrokes";
import { mockedIpc } from "../../test/ipc";
import { editor, openFixtureScenario } from "../../store/editorFixture";
import { editResult, node } from "../../store/fixture";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useToolStore } from "../../store/toolStore";

const chrome = () => useMapChromeStore.getState();

/** A stroke of `tool` through `path`, under the tool options as they stand. */
function stroke(tool: BrushTool, path: Pt[], seed = 5): StrokeResult {
  const { systems, grid } = useGalaxyStore.getState();
  const s = new BrushStroke(settingsFor(tool, false), systems, grid!, seed, {
    systems,
    grid: grid!,
  });
  let prev: Pt | null = null;
  for (const next of path) {
    s.add(stampsAlong(prev, next, s.r));
    prev = next;
  }
  return s.result();
}

/** The lanes the last edit sent, as pairs in the order it named them. */
function sentLanes(): Pair[] {
  const calls = mockedIpc.applyOp.mock.calls;
  const op = calls[calls.length - 1][0];
  const ops: Op[] = op.type === "Batch" ? op.ops : [op];
  return ops.flatMap((o) =>
    o.type === "AddLanePairs" ? o.lanes.map(({ a, b }): Pair => [a, b]) : [],
  );
}

const PATH: Pt[] = [
  { x: 200, y: 200 },
  { x: 500, y: 220 },
  { x: 520, y: 480 },
  { x: 220, y: 500 },
];

beforeEach(async () => {
  await openFixtureScenario();
  mockedIpc.applyOp.mockResolvedValue(editResult());
  chrome().setLaneIslands(false);
});

describe("Generate lanes like the game", () => {
  it("reaches a paint stroke's lanes, and the stroke sends the lanes it shows", async () => {
    useToolStore.setState({ size: 120, spacing: 20, laneMode: "new" });
    const even = stroke("paint", PATH);
    chrome().setLaneIslands(true);
    const islands = stroke("paint", PATH);
    if (even.kind !== "paint" || islands.kind !== "paint") throw new Error("not a paint stroke");
    expect(islands.points).toEqual(even.points);
    expect(islands.pairs).not.toEqual(even.pairs);

    await editor().paintStroke(islands.points, islands.pairs);
    expect(sentLanes()).toHaveLength(islands.pairs.length);
  });

  it("reaches a hyperlane stroke over the systems it sweeps, and it sends the lanes it shows", async () => {
    const systems = Array.from({ length: 64 }, (_, k) =>
      node(
        100 + k,
        "NAME_Sol",
        210 + (k % 8) * 40 + (k % 3) * 7,
        210 + Math.floor(k / 8) * 40 + (k % 5) * 6,
        "sc_g",
      ),
    );
    useGalaxyStore.getState().applyDelta({ systems });
    useToolStore.setState({ size: 200 });
    const even = stroke("connect", PATH);
    chrome().setLaneIslands(true);
    const islands = stroke("connect", PATH);
    if (even.kind !== "connect" || islands.kind !== "connect")
      throw new Error("not a connect stroke");
    expect(islands.swept).toEqual(even.swept);
    expect(islands.pairs.length).toBeGreaterThan(0);
    expect(islands.pairs).not.toEqual(even.pairs);
    expect(stroke("connect", PATH)).toEqual(islands);

    await editor().connectStroke(islands.pairs);
    expect(sentLanes()).toEqual(islands.pairs);
  });
});
