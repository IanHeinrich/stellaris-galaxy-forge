import type { Graphics } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { ORIGIN_LANE_ALPHA } from "../../lib/visual/style";
import { LanesLayer, PREVENTED_LANE } from "./LanesLayer";
import type { MapLayer } from "./MapLayer";
import { childByLabel, type DrawOp, mapContext, mapNode, strokes } from "./fixture";

/** Every tile's graphics, the prevented pairs' under the lanes'. */
function tileGraphics(layer: MapLayer): Graphics[] {
  return layer.container.children.flatMap((group) => group.children as Graphics[]);
}

/** What the layer has told its graphics to draw, one entry per stroked path. */
function laneStrokes(layer: MapLayer): DrawOp[] {
  return tileGraphics(layer).flatMap((g) => strokes(g));
}

/** The dashes of the prevented pairs, which carry a style of their own. */
function dashes(layer: MapLayer): number[][] {
  return laneStrokes(layer)
    .filter((s) => s.color === PREVENTED_LANE.color && s.alpha === PREVENTED_LANE.alpha)
    .flatMap((s) => s.segments);
}

function prevented(id: number, x: number, from: number[]): SystemNode {
  return { ...mapNode(id, x, `S${id}`), prevented: from };
}

/** Sol and Alpha forbid a lane between them; Barnard and Sirius have one. */
const SOL = prevented(0, 0, [1]);
const ALPHA = prevented(1, 20, [0]);
const BARNARD: SystemNode = {
  ...mapNode(2, 40, "Barnard"),
  lanes: [{ to: 3, length: 20, bridge: false, stale: false }],
};
const SIRIUS: SystemNode = {
  ...mapNode(3, 60, "Sirius"),
  lanes: [{ to: 2, length: 20, bridge: false, stale: false }],
};

function drawn(nodes: readonly SystemNode[]): MapLayer {
  const layer = new LanesLayer();
  layer.rebuild(mapContext(nodes));
  return layer;
}

describe("a prevented pair", () => {
  it("is broken, dimmer than a lane, and drawn once though both ends name it", () => {
    const layer = drawn([SOL, ALPHA, BARNARD, SIRIUS]);

    const broken = dashes(layer);
    expect(broken).toHaveLength(5);
    expect(broken[0]).toEqual([0, 0, 2, 0]);
    expect(broken[4]).toEqual([16, 0, 18, 0]);

    const lane = laneStrokes(layer).find((s) => s.color !== PREVENTED_LANE.color);
    expect(lane?.segments).toEqual([[40, 0, 60, 0]]);
    expect(PREVENTED_LANE.alpha).toBeLessThan(lane!.alpha!);
  });

  it("draws nothing for an end the document no longer holds", () => {
    expect(dashes(drawn([prevented(0, 0, [9])]))).toEqual([]);
  });

  it("dims to a ghost while either end is being dragged", () => {
    const layer = drawn([SOL, ALPHA]);
    layer.setDragState?.({
      ghosts: [],
      byId: new Map([[ALPHA.id, { id: ALPHA.id, x: 40, y: 0 }]]),
    });

    expect(dashes(layer)).toEqual([]);
    const ghosted = laneStrokes(layer).find((s) => s.color === PREVENTED_LANE.color);
    expect(ghosted?.alpha).toBe(ORIGIN_LANE_ALPHA);
    expect(ghosted?.segments).toHaveLength(5);

    layer.setDragState?.(null);
    expect(dashes(layer)).toHaveLength(5);
  });

  it("follows the systems as a move re-projects them", () => {
    const layer = drawn([SOL, ALPHA]);
    const moved = prevented(ALPHA.id, 40, [0]);
    layer.rebuild(mapContext([SOL, moved]));
    layer.applyDelta({ systems: [moved] });

    const broken = dashes(layer);
    expect(broken).toHaveLength(10);
    expect(broken[9]).toEqual([36, 0, 38, 0]);
  });
});

describe("a delta", () => {
  it("redraws the lanes of the systems it touches and leaves a distant tile alone", () => {
    const far: SystemNode[] = [
      { ...mapNode(4, 1000, "Far"), lanes: [{ to: 5, length: 20, bridge: false, stale: false }] },
      { ...mapNode(5, 1020, "Farther"), lanes: [] },
    ];
    const layer = drawn([BARNARD, SIRIUS, ...far]);
    const distant = tileGraphics(layer).find((g) =>
      strokes(g).some((s) => s.segments.some((seg) => seg[0] === 1000)),
    )!;
    const cleared = vi.spyOn(distant, "clear");

    const moved = { ...SIRIUS, x: 80 };
    layer.rebuild(mapContext([BARNARD, moved, ...far]));
    layer.applyDelta({ systems: [moved] });

    expect(cleared).not.toHaveBeenCalled();
    const lanes = laneStrokes(layer).filter((s) => s.color !== PREVENTED_LANE.color);
    expect(lanes.flatMap((s) => s.segments)).toEqual(
      expect.arrayContaining([
        [40, 0, 80, 0],
        [1000, 0, 1020, 0],
      ]),
    );
    expect(lanes.flatMap((s) => s.segments)).not.toContainEqual([40, 0, 60, 0]);
  });

  it("drops the lanes of a removed system, and draws one again when its other end returns", () => {
    const layer = drawn([BARNARD, SIRIUS]);
    layer.rebuild(mapContext([BARNARD]));
    layer.applyDelta({ systems: [], removed: [SIRIUS.id] });
    expect(laneStrokes(layer)).toEqual([]);

    const back = { ...SIRIUS, lanes: [] };
    layer.rebuild(mapContext([BARNARD, back]));
    layer.applyDelta({ systems: [back] });
    expect(laneStrokes(layer).flatMap((s) => s.segments)).toEqual([[40, 0, 60, 0]]);
  });
});

describe("a bridge", () => {
  it("draws over every tile's plain lanes, wherever it lies", () => {
    const bridged: SystemNode[] = [
      { ...mapNode(4, 0, "A"), lanes: [{ to: 5, length: 20, bridge: true, stale: false }] },
      { ...mapNode(5, 20, "B"), lanes: [] },
      { ...mapNode(6, 400, "C"), lanes: [{ to: 7, length: 20, bridge: false, stale: false }] },
      { ...mapNode(7, 420, "D"), lanes: [] },
    ];
    const layer = drawn(bridged);
    const groups = layer.container.children.map((group) => group.label);
    expect(groups.indexOf("bridges")).toBeGreaterThan(groups.indexOf("lanes"));
    const segmentsIn = (label: string) =>
      childByLabel(layer.container, label).children.flatMap((g) =>
        strokes(g as Graphics).flatMap((s) => s.segments),
      );
    expect(segmentsIn("bridges")).toEqual([[0, 0, 20, 0]]);
    expect(segmentsIn("lanes")).toEqual([[400, 0, 420, 0]]);
  });
});

describe("a tile whose lanes are all gone", () => {
  it("takes its graphics with it", () => {
    const layer = drawn([BARNARD, SIRIUS]);
    layer.rebuild(mapContext([]));
    layer.applyDelta({ systems: [], removed: [BARNARD.id, SIRIUS.id] });
    expect(tileGraphics(layer)).toEqual([]);
  });
});
