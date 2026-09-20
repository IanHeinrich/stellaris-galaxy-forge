import type { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { SystemNode } from "../../generated/SystemNode";
import { ORIGIN_LANE_ALPHA } from "../../lib/visual/style";
import { LanesLayer, PREVENTED_LANE } from "./LanesLayer";
import type { MapLayer } from "./MapLayer";
import { type DrawOp, mapContext, mapNode, strokes } from "./fixture";

/** What the layer has told its graphics to draw, one entry per stroked path. */
function laneStrokes(layer: MapLayer): DrawOp[] {
  return strokes(layer.container as Graphics);
}

/** The dashes of the prevented pairs, which carry a style of their own. */
function dashes(layer: MapLayer): number[][] {
  const stroke = laneStrokes(layer).find(
    (s) => s.color === PREVENTED_LANE.color && s.alpha === PREVENTED_LANE.alpha,
  );
  return stroke?.segments ?? [];
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
