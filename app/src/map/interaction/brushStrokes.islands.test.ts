import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
// One seed for every stroke, so a stroke laid twice places the same systems.
vi.mock("../../lib/random", async (actual) => ({
  ...(await actual<object>()),
  newSeed: () => 5,
}));

import type { Pair } from "../../lib/geometry/pairs";
import type { Pt } from "../../lib/geometry/pt";
import type { BrushTool } from "../../lib/brush/brushTools";
import { openFixtureScenario } from "../../store/editorFixture";
import { useEditorStore } from "../../store/editorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useToolStore } from "../../store/toolStore";
import { systemNode } from "../../test/builders";
import { installControllerHooks, mapOver } from "./controllerHarness";

installControllerHooks();

const chrome = () => useMapChromeStore.getState();

/** A drag of `tool` through `path` on the map, as the player makes it. */
function drag(tool: BrushTool, path: Pt[], map: ReturnType<typeof mapOver>): void {
  useToolStore.setState({ tool });
  const [first, ...rest] = path.map((p) => map.cam.worldToScreen(p.x, p.y));
  map.surface.fire("pointerdown", first.x, first.y);
  for (const p of rest) map.surface.fire("pointermove", p.x, p.y, { buttons: 1 });
  const last = rest[rest.length - 1];
  map.surface.fire("pointerup", last.x, last.y);
}

const PATH: Pt[] = [
  { x: -150, y: -150 },
  { x: 150, y: -140 },
  { x: 160, y: 150 },
  { x: -140, y: 150 },
];

beforeEach(async () => {
  await openFixtureScenario();
  chrome().setLaneIslands(false);
});

describe("Generate lanes like the game, from the brushes", () => {
  it("reaches the lanes a paint stroke sends", () => {
    const paintStroke = vi.fn<(points: readonly Pt[], pairs: readonly Pair[]) => Promise<boolean>>(
      async () => true,
    );
    useEditorStore.setState({ paintStroke });
    useToolStore.setState({ size: 120, spacing: 20, laneMode: "new", symmetry: { kind: "off" } });
    const map = mapOver([systemNode({ id: 1, x: 900, y: 900 })]);
    drag("paint", PATH, map);
    chrome().setLaneIslands(true);
    drag("paint", PATH, map);

    expect(paintStroke).toHaveBeenCalledTimes(2);
    const [[evenPoints, even], [islandPoints, islands]] = paintStroke.mock.calls;
    expect(islandPoints).toEqual(evenPoints);
    expect(evenPoints.length).toBeGreaterThan(20);
    expect(islands.length).toBeGreaterThan(0);
    expect(islands.length).toBeLessThan(even.length);
  });

  it("reaches the lanes a hyperlane stroke sends over the systems it sweeps", () => {
    const connectStroke = vi.fn<(pairs: readonly Pair[]) => Promise<boolean>>(async () => true);
    useEditorStore.setState({ connectStroke });
    useToolStore.setState({ size: 160, symmetry: { kind: "off" } });
    const map = mapOver(
      Array.from({ length: 64 }, (_, k) =>
        systemNode({
          id: 100 + k,
          x: -160 + (k % 8) * 40 + (k % 3) * 7,
          y: -160 + Math.floor(k / 8) * 40 + (k % 5) * 6,
        }),
      ),
    );
    drag("connect", PATH, map);
    chrome().setLaneIslands(true);
    drag("connect", PATH, map);

    expect(connectStroke).toHaveBeenCalledTimes(2);
    const [[even], [islands]] = connectStroke.mock.calls;
    expect(islands.length).toBeGreaterThan(0);
    expect(islands.length).toBeLessThan(even.length);
  });
});
